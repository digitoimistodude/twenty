import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { isDefined } from 'twenty-shared/utils';
import { In, Repository } from 'typeorm';

import { OnCustomBatchEvent } from 'src/engine/api/graphql/graphql-query-runner/decorators/on-custom-batch-event.decorator';
import { FeatureFlagService } from 'src/engine/core-modules/feature-flag/services/feature-flag.service';
import { ObjectMetadataEntity } from 'src/engine/metadata-modules/object-metadata/object-metadata.entity';
import { InjectObjectMetadataRepository } from 'src/engine/object-metadata-repository/object-metadata-repository.decorator';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { CustomWorkspaceEventBatch } from 'src/engine/workspace-event-emitter/types/custom-workspace-batch-event.type';
import { type MessageParticipantWorkspaceEntity } from 'src/modules/messaging/common/standard-objects/message-participant.workspace-entity';
import { type OpportunityWorkspaceEntity } from 'src/modules/opportunity/standard-objects/opportunity.workspace-entity';
import { type PersonWorkspaceEntity } from 'src/modules/person/standard-objects/person.workspace-entity';
import { TimelineActivityRepository } from 'src/modules/timeline/repositories/timeline-activity.repository';
import { type TimelineActivityPayload } from 'src/modules/timeline/types/timeline-activity-payload';
import { TimelineActivityWorkspaceEntity } from 'src/modules/timeline/standard-objects/timeline-activity.workspace-entity';

// Match on the person record, not the message handle: a colleague's contact can
// carry personal or former-employer addresses that no domain test would catch.
const INTERNAL_EMAIL = /@dude\.fi$/i;

@Injectable()
export class MessageParticipantListener {
  private readonly logger = new Logger(MessageParticipantListener.name);

  constructor(
    @InjectObjectMetadataRepository(TimelineActivityWorkspaceEntity)
    private readonly timelineActivityRepository: TimelineActivityRepository,
    @InjectRepository(ObjectMetadataEntity)
    private readonly objectMetadataRepository: Repository<ObjectMetadataEntity>,
    private readonly featureFlagService: FeatureFlagService,
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
  ) {}

  @OnCustomBatchEvent('messageParticipant_matched')
  public async handleMessageParticipantMatched(
    batchEvent: CustomWorkspaceEventBatch<{
      workspaceMemberId: string;
      participants: MessageParticipantWorkspaceEntity[];
    }>,
  ): Promise<void> {
    if (!isDefined(batchEvent.workspaceId)) {
      return;
    }

    const messageObjectMetadata =
      await this.objectMetadataRepository.findOneOrFail({
        where: {
          nameSingular: 'message',
          workspaceId: batchEvent.workspaceId,
        },
      });

    const timelineActivityPayloads = batchEvent.events.flatMap((event) => {
      const messageParticipants = event.participants ?? [];

      const messageParticipantsWithPersonId = messageParticipants.filter(
        (participant) => isDefined(participant.personId),
      );

      if (messageParticipantsWithPersonId.length === 0) {
        return;
      }

      return messageParticipantsWithPersonId
        .map((participant) => {
          if (!isDefined(participant.personId)) {
            return;
          }

          return {
            name: 'message.linked',
            properties: {},
            objectSingularName: 'person',
            recordId: participant.personId,
            workspaceMemberId: event.workspaceMemberId,
            linkedObjectMetadataId: messageObjectMetadata.id,
            linkedRecordId: participant.messageId,
            linkedRecordCachedName: '',
          };
        })
        .filter(isDefined);
    });

    const personPayloads = timelineActivityPayloads.filter(isDefined);

    await this.timelineActivityRepository.upsertTimelineActivities({
      objectSingularName: 'person',
      workspaceId: batchEvent.workspaceId,
      payloads: personPayloads,
    });

    // Mirroring onto opportunities is an extra: never let it take the person
    // timeline down with it.
    try {
      await this.upsertOpportunityTimelineActivities({
        workspaceId: batchEvent.workspaceId,
        personPayloads,
      });
    } catch (error) {
      this.logger.warn(
        `Could not mirror message timeline onto opportunities: ${error.message}`,
      );
    }
  }

  // A message only ever links to a person, so an opportunity's timeline stays
  // empty of email. Mirror each entry onto the opportunities that person is
  // point of contact for, which is the relation that makes the mail relevant.
  private async upsertOpportunityTimelineActivities({
    workspaceId,
    personPayloads,
  }: {
    workspaceId: string;
    personPayloads: TimelineActivityPayload[];
  }): Promise<void> {
    const personIds = [
      ...new Set(personPayloads.map((payload) => payload.recordId)),
    ];

    if (personIds.length === 0) {
      return;
    }

    const opportunities =
      await this.globalWorkspaceOrmManager.executeInWorkspaceContext(
        async () => {
          // A deal whose contact is a colleague would otherwise collect every
          // internal thread that colleague takes part in.
          const personRepository =
            await this.globalWorkspaceOrmManager.getRepository<PersonWorkspaceEntity>(
              workspaceId,
              'person',
              { shouldBypassPermissionChecks: true },
            );

          const people = await personRepository.find({
            where: { id: In(personIds) },
          });

          const externalPersonIds = people
            .filter(
              (person) =>
                !INTERNAL_EMAIL.test(person.emails?.primaryEmail ?? ''),
            )
            .map((person) => person.id);

          if (externalPersonIds.length === 0) {
            return [];
          }

          const opportunityRepository =
            await this.globalWorkspaceOrmManager.getRepository<OpportunityWorkspaceEntity>(
              workspaceId,
              'opportunity',
              { shouldBypassPermissionChecks: true },
            );

          return opportunityRepository.find({
            where: { pointOfContactId: In(externalPersonIds) },
            select: { id: true, pointOfContactId: true },
          });
        },
        buildSystemAuthContext(workspaceId),
      );

    if (opportunities.length === 0) {
      return;
    }

    const payloads = personPayloads.flatMap((payload) =>
      opportunities
        .filter(
          (opportunity) => opportunity.pointOfContactId === payload.recordId,
        )
        .map((opportunity) => ({
          ...payload,
          objectSingularName: 'opportunity',
          recordId: opportunity.id,
        })),
    );

    await this.timelineActivityRepository.upsertTimelineActivities({
      objectSingularName: 'opportunity',
      workspaceId,
      payloads,
    });
  }
}
