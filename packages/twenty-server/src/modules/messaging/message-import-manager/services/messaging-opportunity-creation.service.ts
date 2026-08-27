import { Injectable, Logger } from '@nestjs/common';

import { In, MoreThan, type ObjectLiteral } from 'typeorm';
import { MessageParticipantRole } from 'twenty-shared/types';
import { isDefined } from 'twenty-shared/utils';

import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { type MessageParticipantWorkspaceEntity } from 'src/modules/messaging/common/standard-objects/message-participant.workspace-entity';
import { type MessageWorkspaceEntity } from 'src/modules/messaging/common/standard-objects/message.workspace-entity';
import { type OpportunityWorkspaceEntity } from 'src/modules/opportunity/standard-objects/opportunity.workspace-entity';
import { type PersonWorkspaceEntity } from 'src/modules/person/standard-objects/person.workspace-entity';

export type OpportunityCandidate = {
  messageThreadId: string;
  messageId: string;
  personId: string;
  companyId: string | null;
  subject: string;
  handle: string;
  bodyPreview: string;
  receivedAt: string;
};

export type OpportunityCreationResult = {
  createdOpportunities: number;
  skipped: number;
  errors: number;
  created: { threadId: string; opportunityId: string; name: string }[];
};

const OPPORTUNITY_STAGE_FOR_NEW_LEAD = 'LIIDIT';
const BODY_PREVIEW_LENGTH = 700;

// A reply or a forward continues a conversation that already exists somewhere,
// so it can never be the start of a new deal.
const REPLY_OR_FORWARD_SUBJECT = /^\s*(re|vs|fwd|fw|vastaus|sv|aw)\s*:/i;

@Injectable()
export class MessagingOpportunityCreationService {
  private readonly logger = new Logger(
    MessagingOpportunityCreationService.name,
  );

  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
  ) {}

  // Deliberately only reports. Whether a mail is actually an inbound enquiry is
  // a judgement call that lives outside this service.
  async findCandidates({
    workspaceId,
    internalDomain,
    sinceDays,
  }: {
    workspaceId: string;
    internalDomain: string;
    sinceDays: number;
  }): Promise<OpportunityCandidate[]> {
    const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);

    return this.globalWorkspaceOrmManager.executeInWorkspaceContext(
      async () => {
        const messageRepository =
          await this.getRepository<MessageWorkspaceEntity>(
            workspaceId,
            'message',
          );
        const participantRepository =
          await this.getRepository<MessageParticipantWorkspaceEntity>(
            workspaceId,
            'messageParticipant',
          );
        const personRepository =
          await this.getRepository<PersonWorkspaceEntity>(
            workspaceId,
            'person',
          );
        const opportunityRepository =
          await this.getRepository<OpportunityWorkspaceEntity>(
            workspaceId,
            'opportunity',
          );

        const messages = await messageRepository.find({
          where: { receivedAt: MoreThan(since) },
          select: {
            id: true,
            subject: true,
            text: true,
            receivedAt: true,
            messageThreadId: true,
          },
          order: { receivedAt: 'ASC' },
        });

        // One opportunity per conversation, so only the message that opened
        // the thread can qualify.
        const firstMessageByThreadId = new Map<string, (typeof messages)[0]>();

        for (const message of messages) {
          const threadId = message.messageThreadId;

          if (isDefined(threadId) && !firstMessageByThreadId.has(threadId)) {
            firstMessageByThreadId.set(threadId, message);
          }
        }

        if (firstMessageByThreadId.size === 0) {
          return [];
        }

        const allParticipants = await participantRepository.find({
          where: { messageId: In(messages.map((message) => message.id)) },
          select: {
            id: true,
            personId: true,
            handle: true,
            messageId: true,
            role: true,
          },
        });

        const threadIdByMessageId = new Map(
          messages.map((message) => [message.id, message.messageThreadId]),
        );

        // Any participant of the thread already holding a deal means this
        // conversation is filed, whoever happens to have written first.
        const personIdsByThreadId = new Map<string, Set<string>>();

        for (const participant of allParticipants) {
          const threadId = threadIdByMessageId.get(participant.messageId ?? '');

          if (!isDefined(threadId) || !isDefined(participant.personId)) {
            continue;
          }

          const set = personIdsByThreadId.get(threadId) ?? new Set<string>();

          set.add(participant.personId);
          personIdsByThreadId.set(threadId, set);
        }

        const everyPersonId = [
          ...new Set(
            [...personIdsByThreadId.values()].flatMap((set) => [...set]),
          ),
        ];

        const existingOpportunities =
          everyPersonId.length > 0
            ? await opportunityRepository.find({
                where: { pointOfContactId: In(everyPersonId) },
                select: { id: true, pointOfContactId: true },
              })
            : [];

        const personIdsWithOpportunity = new Set(
          existingOpportunities
            .map((opportunity) => opportunity.pointOfContactId)
            .filter(isDefined),
        );

        const people = await personRepository.find({
          where: { id: In(everyPersonId.length > 0 ? everyPersonId : ['']) },
          select: { id: true, companyId: true },
        });

        const companyIdByPersonId = new Map(
          people.map((person) => [person.id, person.companyId ?? null]),
        );

        const candidates: OpportunityCandidate[] = [];

        for (const [threadId, firstMessage] of firstMessageByThreadId) {
          const subject = (firstMessage.subject ?? '').trim();

          if (REPLY_OR_FORWARD_SUBJECT.test(subject)) {
            continue;
          }

          const threadPersonIds = personIdsByThreadId.get(threadId);

          if (
            isDefined(threadPersonIds) &&
            [...threadPersonIds].some((personId) =>
              personIdsWithOpportunity.has(personId),
            )
          ) {
            continue;
          }

          const sender = allParticipants.find(
            (participant) =>
              participant.messageId === firstMessage.id &&
              participant.role === MessageParticipantRole.FROM,
          );

          const handle = sender?.handle ?? '';

          if (
            !isDefined(sender?.personId) ||
            handle.toLowerCase().endsWith(`@${internalDomain}`)
          ) {
            continue;
          }

          candidates.push({
            messageThreadId: threadId,
            messageId: firstMessage.id,
            personId: sender.personId,
            companyId: companyIdByPersonId.get(sender.personId) ?? null,
            subject,
            handle,
            bodyPreview: (firstMessage.text ?? '')
              .replace(/\s+/g, ' ')
              .trim()
              .slice(0, BODY_PREVIEW_LENGTH),
            receivedAt: firstMessage.receivedAt?.toISOString() ?? '',
          });
        }

        return candidates;
      },
      buildSystemAuthContext(workspaceId),
    );
  }

  async createForCandidates({
    workspaceId,
    candidates,
  }: {
    workspaceId: string;
    candidates: OpportunityCandidate[];
  }): Promise<OpportunityCreationResult> {
    const result: OpportunityCreationResult = {
      createdOpportunities: 0,
      skipped: 0,
      errors: 0,
      created: [],
    };

    await this.globalWorkspaceOrmManager.executeInWorkspaceContext(async () => {
      const opportunityRepository =
        await this.getRepository<OpportunityWorkspaceEntity>(
          workspaceId,
          'opportunity',
        );

      for (const candidate of candidates) {
        try {
          // Re-check at write time: an earlier candidate in this same batch
          // may have just filed this contact.
          const existing = await opportunityRepository.find({
            where: { pointOfContactId: candidate.personId },
            select: { id: true },
          });

          if (existing.length > 0) {
            result.skipped++;
            continue;
          }

          const name =
            candidate.subject !== ''
              ? candidate.subject
              : `Yhteydenotto: ${candidate.handle}`;

          const inserted = await opportunityRepository.insert({
            name,
            stage: OPPORTUNITY_STAGE_FOR_NEW_LEAD,
            pointOfContactId: candidate.personId,
            ...(isDefined(candidate.companyId)
              ? { companyId: candidate.companyId }
              : {}),
          });

          const opportunityId = inserted.identifiers?.[0]?.id;

          result.createdOpportunities++;
          result.created.push({
            threadId: candidate.messageThreadId,
            opportunityId: opportunityId ?? '',
            name,
          });
        } catch (error) {
          result.errors++;
          this.logger.warn(
            `Could not create opportunity for ${candidate.handle}: ${error.message}`,
          );
        }
      }
    }, buildSystemAuthContext(workspaceId));

    return result;
  }

  private async getRepository<T extends ObjectLiteral>(
    workspaceId: string,
    objectName: string,
  ) {
    return this.globalWorkspaceOrmManager.getRepository<T>(
      workspaceId,
      objectName,
      { shouldBypassPermissionChecks: true },
    );
  }
}
