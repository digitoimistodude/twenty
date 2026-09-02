import { Injectable, Logger } from '@nestjs/common';

import { google } from 'googleapis';
import { In } from 'typeorm';
import { MessageFolderImportPolicy } from 'twenty-shared/types';
import { isDefined } from 'twenty-shared/utils';

import { type ConnectedAccountEntity } from 'src/engine/metadata-modules/connected-account/entities/connected-account.entity';
import { type MessageChannelEntity } from 'src/engine/metadata-modules/message-channel/entities/message-channel.entity';
import { WorkspaceOrmManager } from 'src/engine/twenty-orm/workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { GoogleOAuth2ClientProvider } from 'src/modules/connected-account/oauth2-client-manager/drivers/google/google-oauth2-client.provider';
import { GmailGetMessagesService } from 'src/modules/messaging/message-import-manager/drivers/gmail/services/gmail-get-messages.service';
import { MessagingSaveMessagesAndEnqueueContactCreationService } from 'src/modules/messaging/message-import-manager/services/messaging-save-messages-and-enqueue-contact-creation.service';

export type ThreadCompletionResult = {
  scannedThreads: number;
  threadsWithMissingMessages: number;
  missingMessages: number;
  importedMessages: number;
  errors: number;
};

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
