import { InjectRepository } from '@nestjs/typeorm';
import { Command, CommandRunner, Option } from 'nest-commander';

import { Repository } from 'typeorm';
import { isDefined } from 'twenty-shared/utils';

import { ConnectedAccountEntity } from 'src/engine/metadata-modules/connected-account/entities/connected-account.entity';
import { MessageChannelEntity } from 'src/engine/metadata-modules/message-channel/entities/message-channel.entity';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import {
  type ThreadCompletionResult,
  MessagingThreadCompletionService,
} from 'src/modules/messaging/message-import-manager/services/messaging-thread-completion.service';

type MessagingCompleteThreadsOptions = {
  workspaceId: string;
  dryRun?: boolean;
  limit?: number;
};

@Command({
  name: 'messaging:complete-threads',
  description:
    'Import messages missing from threads already in the CRM, such as replies that never carried the label',
})
export class MessagingCompleteThreadsCommand extends CommandRunner {
  constructor(
    private readonly messagingThreadCompletionService: MessagingThreadCompletionService,
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
    @InjectRepository(MessageChannelEntity)
    private readonly messageChannelRepository: Repository<MessageChannelEntity>,
    @InjectRepository(ConnectedAccountEntity)
    private readonly connectedAccountRepository: Repository<ConnectedAccountEntity>,
  ) {
    super();
  }

  @Option({
    flags: '-w, --workspace-id [workspace_id]',
    required: true,
    description: 'Workspace to complete threads for',
  })
  parseWorkspaceId(value: string): string {
    return value;
  }

  @Option({
    flags: '-d, --dry-run',
    description: 'Report what is missing without importing anything',
  })
  parseDryRun(): boolean {
    return true;
  }

  @Option({
    flags: '-l, --limit [limit]',
    description: 'Maximum number of threads to scan per channel',
  })
  parseLimit(value: string): number {
    return Number(value);
  }

  async run(
    _passedParams: string[],
    options: MessagingCompleteThreadsOptions,
  ): Promise<void> {
    const dryRun = options.dryRun === true;

    const messageChannels = await this.messageChannelRepository.find({
      where: { workspaceId: options.workspaceId },
      relations: ['messageFolders'],
    });

    const totals: ThreadCompletionResult = {
      scannedThreads: 0,
      threadsWithMissingMessages: 0,
      missingMessages: 0,
      importedMessages: 0,
      errors: 0,
    };

    for (const messageChannel of messageChannels) {
      const connectedAccount = await this.connectedAccountRepository.findOne({
        where: { id: messageChannel.connectedAccountId },
      });

      if (
        !isDefined(connectedAccount) ||
        connectedAccount.provider !== 'google'
      ) {
        continue;
      }

      const threadExternalIds = await this.findThreadExternalIds({
        workspaceId: options.workspaceId,
        messageChannelId: messageChannel.id,
        limit: options.limit,
      });

      const result =
        await this.messagingThreadCompletionService.completeThreads({
          workspaceId: options.workspaceId,
          messageChannel,
          connectedAccount,
          threadExternalIds,
          dryRun,
        });

      for (const key of Object.keys(
        totals,
      ) as (keyof ThreadCompletionResult)[]) {
        totals[key] += result[key];
      }
    }

    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ dryRun, ...totals }, null, 2));
  }

  private async findThreadExternalIds({
    workspaceId,
    messageChannelId,
    limit,
  }: {
    workspaceId: string;
    messageChannelId: string;
    limit?: number;
  }): Promise<string[]> {
    const associations =
      await this.globalWorkspaceOrmManager.executeInWorkspaceContext(
        async () => {
          const associationRepository =
            await this.globalWorkspaceOrmManager.getRepository(
              workspaceId,
              'messageChannelMessageAssociation',
              { shouldBypassPermissionChecks: true },
            );

          return associationRepository.find({
            where: { messageChannelId },
            select: {
              id: true,
              messageThreadExternalId: true,
              createdAt: true,
            },
            order: { createdAt: 'DESC' },
          });
        },
        buildSystemAuthContext(workspaceId),
      );

    const uniqueThreadExternalIds = [
      ...new Set(
        associations
          .map((association) => association.messageThreadExternalId)
          .filter(isDefined),
      ),
    ];

    return limit
      ? uniqueThreadExternalIds.slice(0, Number(limit))
      : uniqueThreadExternalIds;
  }
}
