import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { type gmail_v1 as gmailV1, google } from 'googleapis';
import { In, Repository } from 'typeorm';
import { isDefined } from 'twenty-shared/utils';

import { FilesFieldService } from 'src/engine/core-modules/file/files-field/services/files-field.service';
import { FieldMetadataType } from 'twenty-shared/types';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { FieldMetadataEntity } from 'src/engine/metadata-modules/field-metadata/field-metadata.entity';
import { ObjectMetadataEntity } from 'src/engine/metadata-modules/object-metadata/object-metadata.entity';
import { GoogleOAuth2ClientProvider } from 'src/modules/connected-account/oauth2-client-manager/drivers/google/google-oauth2-client.provider';
import { type AttachmentWorkspaceEntity } from 'src/modules/attachment/standard-objects/attachment.workspace-entity';
import { type OpportunityWorkspaceEntity } from 'src/modules/opportunity/standard-objects/opportunity.workspace-entity';
import {
  collectMessageParts,
  isRealMessageAttachment,
} from 'src/modules/messaging/message-import-manager/utils/is-real-message-attachment.util';

export type MessageAttachmentImportCandidate = {
  messageId: string;
  messageExternalId: string;
  connectedAccountId: string;
};

export type MessageAttachmentImportResult = {
  scannedMessages: number;
  messagesWithAttachments: number;
  attachmentFilesFound: number;
  attachmentFilesWithoutOpportunity: number;
  attachmentFiles: number;
  totalBytes: number;
  createdAttachments: number;
  skippedAlreadyImported: number;
  errors: number;
};

// Twenty parses Gmail attachment metadata only to filter calendar invites and
// then discards it, so an opportunity never shows the files a client sent.
@Injectable()
export class MessagingAttachmentImportService {
  private readonly logger = new Logger(MessagingAttachmentImportService.name);

  constructor(
    private readonly googleOAuth2ClientProvider: GoogleOAuth2ClientProvider,
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
    private readonly filesFieldService: FilesFieldService,
    @InjectRepository(FieldMetadataEntity)
    private readonly fieldMetadataRepository: Repository<FieldMetadataEntity>,
    @InjectRepository(ObjectMetadataEntity)
    private readonly objectMetadataRepository: Repository<ObjectMetadataEntity>,
  ) {}

  async importAttachments({
    workspaceId,
    candidates,
    dryRun,
  }: {
    workspaceId: string;
    candidates: MessageAttachmentImportCandidate[];
    dryRun: boolean;
  }): Promise<MessageAttachmentImportResult> {
    const result: MessageAttachmentImportResult = {
      scannedMessages: 0,
      messagesWithAttachments: 0,
      attachmentFilesFound: 0,
      attachmentFilesWithoutOpportunity: 0,
      attachmentFiles: 0,
      totalBytes: 0,
      createdAttachments: 0,
      skippedAlreadyImported: 0,
      errors: 0,
    };

    const gmailClientByAccount = new Map<string, gmailV1.Gmail>();
    const authContext = buildSystemAuthContext(workspaceId);

    await this.globalWorkspaceOrmManager.executeInWorkspaceContext(async () => {
      for (const candidate of candidates) {
        try {
          const gmailClient = await this.getGmailClient(
            gmailClientByAccount,
            candidate.connectedAccountId,
          );

          const message = await gmailClient.users.messages.get({
            userId: 'me',
            id: candidate.messageExternalId,
            format: 'full',
          });

          result.scannedMessages++;

          const attachmentParts = collectMessageParts(
            message.data.payload ?? undefined,
          ).filter(isRealMessageAttachment);

          if (attachmentParts.length === 0) {
            continue;
          }

          result.messagesWithAttachments++;
          result.attachmentFilesFound += attachmentParts.length;

          const opportunityIds = await this.findOpportunityIds({
            workspaceId,
            messageId: candidate.messageId,
          });

          if (opportunityIds.length === 0) {
            result.attachmentFilesWithoutOpportunity += attachmentParts.length;
            continue;
          }

          for (const part of attachmentParts) {
            result.attachmentFiles++;
            result.totalBytes += part.body?.size ?? 0;

            if (dryRun) {
              continue;
            }

            await this.createAttachments({
              workspaceId,
              gmailClient,
              messageExternalId: candidate.messageExternalId,
              part,
              opportunityIds,
              result,
            });
          }
        } catch (error) {
          result.errors++;
          this.logger.warn(
            `Attachment scan failed for ${candidate.messageExternalId}: ${error.message}`,
          );
        }
      }
    }, authContext);

    return result;
  }

  private async getGmailClient(
    cache: Map<string, gmailV1.Gmail>,
    connectedAccountId: string,
  ): Promise<gmailV1.Gmail> {
    const cached = cache.get(connectedAccountId);

    if (isDefined(cached)) {
      return cached;
    }

    const oAuth2Client =
      await this.googleOAuth2ClientProvider.getClient(connectedAccountId);
    const gmailClient = google.gmail({ version: 'v1', auth: oAuth2Client });

    cache.set(connectedAccountId, gmailClient);

    return gmailClient;
  }

  // Anchor on the same relation the timeline and the Slack relay use, so a file
  // lands on the deal the correspondent is actually the contact for.
  private async findOpportunityIds({
    workspaceId,
    messageId,
  }: {
    workspaceId: string;
    messageId: string;
  }): Promise<string[]> {
    const participantRepository =
      await this.globalWorkspaceOrmManager.getRepository(
        workspaceId,
        'messageParticipant',
        { shouldBypassPermissionChecks: true },
      );

    const participants = await participantRepository.find({
      where: { messageId },
      select: { id: true, personId: true },
    });

    const personIds = [
      ...new Set(
        participants
          .map((participant) => participant.personId)
          .filter(isDefined),
      ),
    ];

    if (personIds.length === 0) {
      return [];
    }

    const opportunityRepository =
      await this.globalWorkspaceOrmManager.getRepository<OpportunityWorkspaceEntity>(
        workspaceId,
        'opportunity',
        { shouldBypassPermissionChecks: true },
      );

    const opportunities = await opportunityRepository.find({
      where: { pointOfContactId: In(personIds) },
      select: { id: true },
    });

    return opportunities.map((opportunity) => opportunity.id);
  }

  private async createAttachments({
    workspaceId,
    gmailClient,
    messageExternalId,
    part,
    opportunityIds,
    result,
  }: {
    workspaceId: string;
    gmailClient: gmailV1.Gmail;
    messageExternalId: string;
    part: gmailV1.Schema$MessagePart;
    opportunityIds: string[];
    result: MessageAttachmentImportResult;
  }): Promise<void> {
    const attachmentRepository =
      await this.globalWorkspaceOrmManager.getRepository<AttachmentWorkspaceEntity>(
        workspaceId,
        'attachment',
        { shouldBypassPermissionChecks: true },
      );

    const filename = part.filename ?? 'attachment';

    // Re-running the backfill must not duplicate what is already there.
    const alreadyImported = await attachmentRepository.find({
      where: {
        name: filename,
        targetOpportunityId: In(opportunityIds),
      },
      select: { id: true, targetOpportunityId: true },
    });

    const missingOpportunityIds = opportunityIds.filter(
      (opportunityId) =>
        !alreadyImported.some(
          (attachment) => attachment.targetOpportunityId === opportunityId,
        ),
    );

    result.skippedAlreadyImported +=
      opportunityIds.length - missingOpportunityIds.length;

    if (missingOpportunityIds.length === 0) {
      return;
    }

    const attachmentData = await gmailClient.users.messages.attachments.get({
      userId: 'me',
      messageId: messageExternalId,
      id: part.body?.attachmentId ?? '',
    });

    const base64 = attachmentData.data.data;

    if (!isDefined(base64)) {
      return;
    }

    const fileBuffer = Buffer.from(base64, 'base64url');

    const fileFieldMetadataId =
      await this.getAttachmentFileFieldMetadataId(workspaceId);

    const extension = filename.includes('.')
      ? filename.slice(filename.lastIndexOf('.') + 1)
      : '';

    for (const opportunityId of missingOpportunityIds) {
      // A file may only belong to one files field, so a document sent to
      // someone who is contact on several deals needs its own upload per deal.
      const uploadedFile = await this.filesFieldService.uploadFile({
        file: fileBuffer,
        filename,
        workspaceId,
        fieldMetadataId: fileFieldMetadataId,
      });

      await attachmentRepository.insert({
        name: filename,
        targetOpportunityId: opportunityId,
        file: [{ fileId: uploadedFile.id, label: filename, extension }],
      });

      result.createdAttachments++;
    }
  }

  private async getAttachmentFileFieldMetadataId(
    workspaceId: string,
  ): Promise<string> {
    const attachmentObject = await this.objectMetadataRepository.findOne({
      select: ['id'],
      where: { nameSingular: 'attachment', workspaceId },
    });

    if (!isDefined(attachmentObject)) {
      throw new Error('Attachment object metadata not found');
    }

    const fileField = await this.fieldMetadataRepository.findOne({
      select: ['id'],
      where: {
        name: 'file',
        type: FieldMetadataType.FILES,
        workspaceId,
        objectMetadataId: attachmentObject.id,
      },
    });

    if (!isDefined(fileField)) {
      throw new Error('Attachment file field metadata not found');
    }

    return fileField.id;
  }
}
