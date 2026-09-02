import { InjectRepository } from '@nestjs/typeorm';
import { Command, CommandRunner, Option } from 'nest-commander';

import { In, Repository } from 'typeorm';
import { isDefined } from 'twenty-shared/utils';

import { MessageChannelEntity } from 'src/engine/metadata-modules/message-channel/entities/message-channel.entity';
import { WorkspaceOrmManager } from 'src/engine/twenty-orm/workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import {
  type MessageAttachmentImportCandidate,
  MessagingAttachmentImportService,
} from 'src/modules/messaging/message-import-manager/services/messaging-attachment-import.service';

type MessagingImportAttachmentsOptions = {
  workspaceId: string;
  dryRun?: boolean;
  limit?: number;
};

@Command({
  name: 'messaging:import-attachments',
  description:
    'Import email attachments from already synced messages onto their opportunities',
})
export class MessagingImportAttachmentsCommand extends CommandRunner {
  constructor(
    private readonly messagingAttachmentImportService: MessagingAttachmentImportService,
    private readonly workspaceOrmManager: WorkspaceOrmManager,
    @InjectRepository(MessageChannelEntity)
    private readonly messageChannelRepository: Repository<MessageChannelEntity>,
  ) {
    super();
  }

  @Option({
    flags: '-w, --workspace-id [workspace_id]',
    required: true,
    description: 'Workspace to import attachments for',
  })
  parseWorkspaceId(value: string): string {
    return value;
  }

  @Option({
    flags: '-d, --dry-run',
    description: 'Report what would be imported without downloading anything',
  })
  parseDryRun(): boolean {
    return true;
  }

  @Option({
    flags: '-l, --limit [limit]',
    description: 'Maximum number of messages to scan',
  })
  parseLimit(value: string): number {
    return Number(value);
  }

  async run(
    _passedParams: string[],
    options: MessagingImportAttachmentsOptions,
  ): Promise<void> {
    const dryRun = options.dryRun === true;

    const messageChannels = await this.messageChannelRepository.find({
      select: ['id', 'connectedAccountId'],
      where: { workspaceId: options.workspaceId },
    });

    const connectedAccountIdByChannelId = new Map(
      messageChannels.map((channel) => [
        channel.id,
        channel.connectedAccountId,
      ]),
    );

    const associations =
      await this.workspaceOrmManager.executeInWorkspaceContext(
        async () => {
          const associationRepository =
            await this.workspaceOrmManager.getRepository(
              options.workspaceId,
              'messageChannelMessageAssociation',
              { shouldBypassPermissionChecks: true },
            );

          return associationRepository.find({
            where: {
              messageChannelId: In([...connectedAccountIdByChannelId.keys()]),
            },
            select: {
              id: true,
              messageId: true,
              messageExternalId: true,
              messageChannelId: true,
            },
            // Newest first, so a nightly run with a small --limit covers the
            // day's mail instead of rescanning the whole mailbox.
            order: { createdAt: 'DESC' },
            ...(options.limit ? { take: Number(options.limit) } : {}),
          });
        },
        buildSystemAuthContext(options.workspaceId),
      );

    const candidates: MessageAttachmentImportCandidate[] = associations
      .map((association) => {
        const connectedAccountId = connectedAccountIdByChannelId.get(
          association.messageChannelId,
        );

        if (
          !isDefined(connectedAccountId) ||
          !isDefined(association.messageExternalId)
        ) {
          return undefined;
        }

        return {
          messageId: association.messageId,
          messageExternalId: association.messageExternalId,
          connectedAccountId,
        };
      })
      .filter(isDefined);

    const result =
      await this.messagingAttachmentImportService.importAttachments({
        workspaceId: options.workspaceId,
        candidates,
        dryRun,
      });

    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify(
        {
          dryRun,
          candidates: candidates.length,
          ...result,
          totalMegabytes: Number((result.totalBytes / 1048576).toFixed(1)),
        },
        null,
        2,
      ),
    );
  }
}
