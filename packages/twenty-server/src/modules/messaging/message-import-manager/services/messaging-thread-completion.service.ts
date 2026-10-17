import { Injectable, Logger } from '@nestjs/common';

import { google } from 'googleapis';
import { ILike, In } from 'typeorm';
import { MessageFolderImportPolicy } from 'twenty-shared/types';
import { isDefined } from 'twenty-shared/utils';

import { type ConnectedAccountEntity } from 'src/engine/metadata-modules/connected-account/entities/connected-account.entity';
import { type MessageChannelEntity } from 'src/engine/metadata-modules/message-channel/entities/message-channel.entity';
import { WorkspaceOrmManager } from 'src/engine/twenty-orm/workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { GoogleOAuth2ClientProvider } from 'src/modules/connected-account/oauth2-client-manager/drivers/google/google-oauth2-client.provider';
import { type MessageChannelMessageAssociationWorkspaceEntity } from 'src/modules/messaging/common/standard-objects/message-channel-message-association.workspace-entity';
import { type MessageParticipantWorkspaceEntity } from 'src/modules/messaging/common/standard-objects/message-participant.workspace-entity';
import { type MessageWorkspaceEntity } from 'src/modules/messaging/common/standard-objects/message.workspace-entity';
import { GmailGetMessagesService } from 'src/modules/messaging/message-import-manager/drivers/gmail/services/gmail-get-messages.service';
import { MessagingSaveMessagesAndEnqueueContactCreationService } from 'src/modules/messaging/message-import-manager/services/messaging-save-messages-and-enqueue-contact-creation.service';

export type ThreadDiscoveryResult = {
  discoveredThreads: number;
  errors: number;
};

export type ThreadCompletionResult = {
  scannedThreads: number;
  threadsWithMissingMessages: number;
  missingMessages: number;
  importedMessages: number;
  errors: number;
};

// The first few Message-IDs of a thread are the original enquiry and its first
// replies, which both mailboxes received; later ones may exist in only one.
const DISCOVERY_MESSAGE_IDS_PER_THREAD = 3;
const FIND_CHUNK_SIZE = 500;

// Gmail labels the messages that exist when the label is applied, so a reply
// sent afterwards never carries it and never reaches the CRM. If a thread is
// already in the CRM the whole conversation belongs there, so pull in whatever
// the folder policy filtered out.
@Injectable()
export class MessagingThreadCompletionService {
  private readonly logger = new Logger(MessagingThreadCompletionService.name);

  constructor(
    private readonly googleOAuth2ClientProvider: GoogleOAuth2ClientProvider,
    private readonly workspaceOrmManager: WorkspaceOrmManager,
    private readonly gmailGetMessagesService: GmailGetMessagesService,
    private readonly saveMessagesService: MessagingSaveMessagesAndEnqueueContactCreationService,
  ) {}

  async completeThreads({
    workspaceId,
    messageChannel,
    connectedAccount,
    threadExternalIds,
    dryRun,
  }: {
    workspaceId: string;
    messageChannel: MessageChannelEntity;
    connectedAccount: ConnectedAccountEntity;
    threadExternalIds: string[];
    dryRun: boolean;
  }): Promise<ThreadCompletionResult> {
    const result: ThreadCompletionResult = {
      scannedThreads: 0,
      threadsWithMissingMessages: 0,
      missingMessages: 0,
      importedMessages: 0,
      errors: 0,
    };

    const oAuth2Client = await this.googleOAuth2ClientProvider.getClient(
      connectedAccount.id,
    );
    const gmailClient = google.gmail({ version: 'v1', auth: oAuth2Client });

    for (const threadExternalId of threadExternalIds) {
      try {
        const thread = await gmailClient.users.threads.get({
          userId: 'me',
          id: threadExternalId,
          format: 'minimal',
        });

        result.scannedThreads++;

        const externalIdsInGmail = (thread.data.messages ?? [])
          .map((message) => message.id)
          .filter(isDefined);

        if (externalIdsInGmail.length === 0) {
          continue;
        }

        const alreadyImported = await this.findImportedExternalIds({
          workspaceId,
          messageChannelId: messageChannel.id,
          externalIds: externalIdsInGmail,
        });

        const missingExternalIds = externalIdsInGmail.filter(
          (externalId) => !alreadyImported.has(externalId),
        );

        if (missingExternalIds.length === 0) {
          continue;
        }

        result.threadsWithMissingMessages++;
        result.missingMessages += missingExternalIds.length;

        if (dryRun) {
          continue;
        }

        // ALL_FOLDERS short-circuits the folder filter, which is the whole
        // point here: these messages are missing precisely because they do
        // not carry the synced label.
        const messages = await this.gmailGetMessagesService.getMessages(
          missingExternalIds,
          connectedAccount,
          {
            ...messageChannel,
            messageFolderImportPolicy: MessageFolderImportPolicy.ALL_FOLDERS,
          },
        );

        if (messages.length === 0) {
          continue;
        }

        // A message already in the CRM from the other mailbox must come before
        // the reply that follows it, or the reply starts a thread of its own.
        messages.sort(
          (a, b) =>
            new Date(a.receivedAt).getTime() - new Date(b.receivedAt).getTime(),
        );

        await this.saveMessagesService.saveMessagesAndEnqueueContactCreation(
          messages,
          messageChannel,
          connectedAccount,
          workspaceId,
        );

        result.importedMessages += messages.length;
      } catch (error) {
        result.errors++;
        this.logger.warn(
          `Thread completion failed for ${threadExternalId}: ${error.message}`,
        );
      }
    }

    return result;
  }

  // A reply sent from the other mailbox sits in a Gmail thread this channel has
  // never seen: thread ids are per mailbox. The RFC Message-ID is shared, so
  // the conversation can be looked up here by it.
  async discoverThreadExternalIds({
    workspaceId,
    messageChannel,
    connectedAccount,
    limit,
  }: {
    workspaceId: string;
    messageChannel: MessageChannelEntity;
    connectedAccount: ConnectedAccountEntity;
    limit: number;
  }): Promise<{ threadExternalIds: string[]; result: ThreadDiscoveryResult }> {
    const result: ThreadDiscoveryResult = { discoveredThreads: 0, errors: 0 };
    const threadExternalIds: string[] = [];

    const candidates = await this.findThreadsMissingFromChannel({
      workspaceId,
      messageChannelId: messageChannel.id,
      handles: [
        connectedAccount.handle,
        ...(connectedAccount.handleAliases ?? []),
      ],
      limit,
    });

    if (candidates.length === 0) {
      return { threadExternalIds, result };
    }

    const oAuth2Client = await this.googleOAuth2ClientProvider.getClient(
      connectedAccount.id,
    );
    const gmailClient = google.gmail({ version: 'v1', auth: oAuth2Client });

    for (const candidate of candidates) {
      try {
        for (const headerMessageId of candidate.headerMessageIds) {
          const response = await gmailClient.users.messages.list({
            userId: 'me',
            q: `rfc822msgid:${headerMessageId.replace(/^<|>$/g, '')}`,
            maxResults: 1,
          });
          const threadExternalId = response.data.messages?.[0]?.threadId;

          if (isDefined(threadExternalId)) {
            threadExternalIds.push(threadExternalId);
            result.discoveredThreads++;
            break;
          }
        }
      } catch (error) {
        result.errors++;
        this.logger.warn(
          `Thread discovery failed for ${candidate.messageThreadId}: ${error.message}`,
        );
      }
    }

    return { threadExternalIds: [...new Set(threadExternalIds)], result };
  }

  // CRM threads the account took part in that this channel holds no copy of,
  // newest first, each with a few Message-IDs to look the thread up by.
  private async findThreadsMissingFromChannel({
    workspaceId,
    messageChannelId,
    handles,
    limit,
  }: {
    workspaceId: string;
    messageChannelId: string;
    handles: string[];
    limit: number;
  }): Promise<{ messageThreadId: string; headerMessageIds: string[] }[]> {
    return this.workspaceOrmManager.executeInWorkspaceContext(async () => {
      const participantRepository =
        await this.workspaceOrmManager.getRepository<MessageParticipantWorkspaceEntity>(
          'messageParticipant',
          { shouldBypassPermissionChecks: true },
        );
      const messageRepository =
        await this.workspaceOrmManager.getRepository<MessageWorkspaceEntity>(
          'message',
          { shouldBypassPermissionChecks: true },
        );
      const associationRepository =
        await this.workspaceOrmManager.getRepository<MessageChannelMessageAssociationWorkspaceEntity>(
          'messageChannelMessageAssociation',
          { shouldBypassPermissionChecks: true },
        );

      const participants = await participantRepository.find({
        where: handles.map((handle) => ({ handle: ILike(handle) })),
        select: { id: true, messageId: true },
      });
      const ownMessages = await this.findMessagesByIds(
        messageRepository,
        participants.map((participant) => participant.messageId),
      );

      const associations = await associationRepository.find({
        where: { messageChannelId },
        select: { id: true, messageId: true },
      });
      const coveredThreadIds = new Set(
        (
          await this.findMessagesByIds(
            messageRepository,
            associations.map((association) => association.messageId),
          )
        ).map((message) => message.messageThreadId),
      );

      const messagesByThreadId = new Map<string, MessageWorkspaceEntity[]>();

      for (const message of ownMessages) {
        if (
          !isDefined(message.messageThreadId) ||
          coveredThreadIds.has(message.messageThreadId)
        ) {
          continue;
        }

        const threadMessages =
          messagesByThreadId.get(message.messageThreadId) ?? [];

        threadMessages.push(message);
        messagesByThreadId.set(message.messageThreadId, threadMessages);
      }

      const receivedAt = (message: MessageWorkspaceEntity) =>
        new Date(message.receivedAt ?? 0).getTime();

      return [...messagesByThreadId.entries()]
        .map(([messageThreadId, threadMessages]) => ({
          messageThreadId,
          latestReceivedAt: Math.max(...threadMessages.map(receivedAt)),
          headerMessageIds: threadMessages
            .sort((a, b) => receivedAt(a) - receivedAt(b))
            .map((message) => message.headerMessageId)
            .filter(isDefined)
            .slice(0, DISCOVERY_MESSAGE_IDS_PER_THREAD),
        }))
        .filter((candidate) => candidate.headerMessageIds.length > 0)
        .sort((a, b) => b.latestReceivedAt - a.latestReceivedAt)
        .slice(0, limit)
        .map(({ messageThreadId, headerMessageIds }) => ({
          messageThreadId,
          headerMessageIds,
        }));
    }, buildSystemAuthContext(workspaceId));
  }

  private async findMessagesByIds(
    messageRepository: Awaited<
      ReturnType<WorkspaceOrmManager['getRepository']>
    >,
    messageIds: (string | null)[],
  ): Promise<MessageWorkspaceEntity[]> {
    const ids = [...new Set(messageIds.filter(isDefined))];
    const messages: MessageWorkspaceEntity[] = [];

    for (let index = 0; index < ids.length; index += FIND_CHUNK_SIZE) {
      messages.push(
        ...((await messageRepository.find({
          where: { id: In(ids.slice(index, index + FIND_CHUNK_SIZE)) },
          select: {
            id: true,
            messageThreadId: true,
            headerMessageId: true,
            receivedAt: true,
          },
        })) as MessageWorkspaceEntity[]),
      );
    }

    return messages;
  }

  private async findImportedExternalIds({
    workspaceId,
    messageChannelId,
    externalIds,
  }: {
    workspaceId: string;
    messageChannelId: string;
    externalIds: string[];
  }): Promise<Set<string>> {
    const associations =
      await this.workspaceOrmManager.executeInWorkspaceContext(
        async () => {
          const associationRepository =
            await this.workspaceOrmManager.getRepository(
              'messageChannelMessageAssociation',
              { shouldBypassPermissionChecks: true },
            );

          return associationRepository.find({
            where: {
              messageChannelId,
              messageExternalId: In(externalIds),
            },
            select: { id: true, messageExternalId: true },
          });
        },
        buildSystemAuthContext(workspaceId),
      );

    return new Set(
      associations
        .map((association) => association.messageExternalId)
        .filter(isDefined),
    );
  }
}
