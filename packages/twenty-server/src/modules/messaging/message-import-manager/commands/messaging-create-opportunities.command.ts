import { Command, CommandRunner, Option } from 'nest-commander';

import { isDefined } from 'twenty-shared/utils';

import { MessagingOpportunityCreationService } from 'src/modules/messaging/message-import-manager/services/messaging-opportunity-creation.service';

type MessagingCreateOpportunitiesOptions = {
  workspaceId: string;
  internalDomain?: string;
  sinceDays?: number;
  threadIds?: string;
};

const DEFAULT_SINCE_DAYS = 7;

// Listing and creating are separate on purpose: whether a mail is really an
// inbound enquiry is judged outside, and only approved threads are passed back.
@Command({
  name: 'messaging:create-opportunities',
  description:
    'List threads that look like unfiled inbound enquiries, or create opportunities for approved thread ids',
})
export class MessagingCreateOpportunitiesCommand extends CommandRunner {
  constructor(
    private readonly messagingOpportunityCreationService: MessagingOpportunityCreationService,
  ) {
    super();
  }

  @Option({
    flags: '-w, --workspace-id [workspace_id]',
    required: true,
    description: 'Workspace to work in',
  })
  parseWorkspaceId(value: string): string {
    return value;
  }

  @Option({
    flags: '--internal-domain [domain]',
    description: 'Domain treated as internal, senders on it are ignored',
  })
  parseInternalDomain(value: string): string {
    return value;
  }

  @Option({
    flags: '-s, --since-days [days]',
    description: `Only consider mail received in the last N days (default ${DEFAULT_SINCE_DAYS})`,
  })
  parseSinceDays(value: string): number {
    return Number(value);
  }

  @Option({
    flags: '-t, --thread-ids [ids]',
    description:
      'Comma separated thread ids to create opportunities for. Without this nothing is created.',
  })
  parseThreadIds(value: string): string {
    return value;
  }

  async run(
    _passedParams: string[],
    options: MessagingCreateOpportunitiesOptions,
  ): Promise<void> {
    const candidates =
      await this.messagingOpportunityCreationService.findCandidates({
        workspaceId: options.workspaceId,
        internalDomain: options.internalDomain ?? '',
        sinceDays: Number(options.sinceDays ?? DEFAULT_SINCE_DAYS),
      });

    if (!isDefined(options.threadIds)) {
      // eslint-disable-next-line no-console
      console.log(JSON.stringify({ candidates }, null, 2));

      return;
    }

    const approvedThreadIds = new Set(
      options.threadIds
        .split(',')
        .map((threadId) => threadId.trim())
        .filter((threadId) => threadId !== ''),
    );

    const approved = candidates.filter((candidate) =>
      approvedThreadIds.has(candidate.messageThreadId),
    );

    const result =
      await this.messagingOpportunityCreationService.createForCandidates({
        workspaceId: options.workspaceId,
        candidates: approved,
      });

    // eslint-disable-next-line no-console
    console.log(JSON.stringify(result, null, 2));
  }
}
