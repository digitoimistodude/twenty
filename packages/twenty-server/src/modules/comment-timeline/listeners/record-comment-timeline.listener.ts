import { Injectable, Logger } from '@nestjs/common';

import {
  type ObjectRecordCreateEvent,
  type ObjectRecordDeleteEvent,
} from 'twenty-shared/database-events';
import { isDefined } from 'twenty-shared/utils';
import { In } from 'typeorm';

import { OnDatabaseBatchEvent } from 'src/engine/api/graphql/graphql-query-runner/decorators/on-database-batch-event.decorator';
import { DatabaseEventAction } from 'src/engine/api/graphql/graphql-query-runner/enums/database-event-action';
import { WorkspaceOrmManager } from 'src/engine/twenty-orm/workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { WorkspaceEventBatch } from 'src/engine/workspace-event-emitter/types/workspace-event-batch.type';
import { TimelineActivityRepository } from 'src/modules/timeline/repositories/timeline-activity.repository';
import { findFlatEntityByUniversalIdentifier } from 'src/engine/metadata-modules/flat-entity/utils/find-flat-entity-by-universal-identifier.util';
import { WorkspaceManyOrAllFlatEntityMapsCacheService } from 'src/engine/metadata-modules/flat-entity/services/workspace-many-or-all-flat-entity-maps-cache.service';
import { type TimelineActivityPayload } from 'src/modules/timeline/types/timeline-activity-payload';
import { WorkspaceMemberWorkspaceEntity } from 'src/modules/workspace-member/standard-objects/workspace-member.workspace-entity';

type RecordCommentRecord = {
  id: string;
  body?: { markdown?: string } | null;
  opportunityId?: string | null;
  personId?: string | null;
  companyId?: string | null;
};

const RECORD_COMMENT_TARGETS = ['opportunity', 'person', 'company'] as const;

const COMMENT_SNIPPET_MAX_LENGTH = 50;

// recordComment is our own object, so its timeline type is registered per
// workspace rather than shipped in the standard definitions.
const COMMENT_TIMELINE_TYPE_UNIVERSAL_IDENTIFIER =
  'c4f8a2d1-9b37-4e56-8a0c-5d1e7f3b62a9';

const buildCommentSnippet = (markdown?: string | null): string => {
  if (!isDefined(markdown)) {
    return 'Comment';
  }

  const plainText = markdown
    .replace(/[#*_>`~-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (plainText === '') {
    return 'Comment';
  }

  return plainText.length > COMMENT_SNIPPET_MAX_LENGTH
    ? `${plainText.slice(0, COMMENT_SNIPPET_MAX_LENGTH).trimEnd()}...`
    : plainText;
};

@Injectable()
export class RecordCommentTimelineListener {
  private readonly logger = new Logger(RecordCommentTimelineListener.name);

  constructor(
    private readonly timelineActivityRepository: TimelineActivityRepository,
    private readonly flatEntityMapsCacheService: WorkspaceManyOrAllFlatEntityMapsCacheService,
    private readonly workspaceOrmManager: WorkspaceOrmManager,
  ) {}

  @OnDatabaseBatchEvent('recordComment', DatabaseEventAction.CREATED)
  async handleCreatedEvent(
    payload: WorkspaceEventBatch<ObjectRecordCreateEvent<RecordCommentRecord>>,
  ): Promise<void> {
    const { workspaceId, events, objectMetadata } = payload;

    if (!isDefined(workspaceId) || events.length === 0) {
      return;
    }

    const timelineActivityType = await this.resolveCommentActivityType(
      workspaceId,
    );

    if (!isDefined(timelineActivityType)) {
      return;
    }

    const workspaceMemberIdByUserId = await this.resolveWorkspaceMemberIds(
      workspaceId,
      events.map((event) => event.userId).filter(isDefined),
    );

    const payloadsByTarget: Record<string, TimelineActivityPayload[]> = {};

    for (const event of events) {
      const comment = event.properties.after;
      const workspaceMemberId = isDefined(event.userId)
        ? workspaceMemberIdByUserId.get(event.userId)
        : undefined;
      const linkedRecordCachedName = buildCommentSnippet(comment.body?.markdown);

      for (const target of RECORD_COMMENT_TARGETS) {
        const targetRecordId = comment[`${target}Id`];

        if (!isDefined(targetRecordId)) {
          continue;
        }

        payloadsByTarget[target] = [
          ...(payloadsByTarget[target] ?? []),
          {
            happensAt: new Date(),
            timelineActivityTypeId: timelineActivityType.id,
            timelineActivityTypeSnapshot: timelineActivityType.snapshot,
            // An empty but present diff makes the frontend treat this as a
            // field change with nothing readable and drop the row. Linked
            // events (messages, notes) carry no diff key at all.
            properties: {},
            objectSingularName: target,
            recordId: targetRecordId,
            workspaceMemberId,
            linkedObjectMetadataId: objectMetadata.id,
            linkedRecordId: comment.id,
            linkedRecordCachedName,
          },
        ];
      }
    }

    for (const [objectSingularName, payloads] of Object.entries(
      payloadsByTarget,
    )) {
      await this.timelineActivityRepository.upsertTimelineActivities({
        objectSingularName,
        workspaceId,
        payloads,
      });
    }
  }

  @OnDatabaseBatchEvent('recordComment', DatabaseEventAction.DELETED)
  async handleDeletedEvent(
    payload: WorkspaceEventBatch<ObjectRecordDeleteEvent<RecordCommentRecord>>,
  ): Promise<void> {
    const { workspaceId, events } = payload;

    if (!isDefined(workspaceId) || events.length === 0) {
      return;
    }

    const commentIds = events.map((event) => event.recordId).filter(isDefined);

    if (commentIds.length === 0) {
      return;
    }

    const timelineActivityType = await this.resolveCommentActivityType(
      workspaceId,
    );

    if (!isDefined(timelineActivityType)) {
      return;
    }

    const authContext = buildSystemAuthContext(workspaceId);

    await this.workspaceOrmManager.executeInWorkspaceContext(async () => {
      const timelineActivityRepository =
        await this.workspaceOrmManager.getRepository('timelineActivity', {
          shouldBypassPermissionChecks: true,
        });

      await timelineActivityRepository.softDelete({
        timelineActivityTypeId: timelineActivityType.id,
        linkedRecordId: In(commentIds),
      });
    }, authContext);
  }

  // Read the type straight from the flat maps instead of the shared resolver:
  // the resolver drops a type whose owning application differs from the
  // object's, which is always true for a custom object like recordComment.
  private async resolveCommentActivityType(workspaceId: string) {
    const { flatTimelineActivityTypeMaps } =
      await this.flatEntityMapsCacheService.getOrRecomputeManyOrAllFlatEntityMaps(
        { workspaceId, flatMapsKeys: ['flatTimelineActivityTypeMaps'] },
      );

    const timelineActivityType = findFlatEntityByUniversalIdentifier({
      flatEntityMaps: flatTimelineActivityTypeMaps,
      universalIdentifier: COMMENT_TIMELINE_TYPE_UNIVERSAL_IDENTIFIER,
    });

    if (!isDefined(timelineActivityType) || !timelineActivityType.isActive) {
      this.logger.warn(
        `No active comment timeline activity type in workspace ${workspaceId}`,
      );

      return undefined;
    }

    return {
      id: timelineActivityType.id,
      snapshot: {
        id: timelineActivityType.id,
        icon: timelineActivityType.icon,
        name: timelineActivityType.name,
        label: timelineActivityType.label,
        action: timelineActivityType.action,
        universalIdentifier: timelineActivityType.universalIdentifier,
        objectUniversalIdentifier:
          timelineActivityType.objectUniversalIdentifier,
        frontComponentUniversalIdentifier:
          timelineActivityType.frontComponentUniversalIdentifier,
      },
    };
  }

  private async resolveWorkspaceMemberIds(
    workspaceId: string,
    userIds: string[],
  ): Promise<Map<string, string>> {
    const workspaceMemberIdByUserId = new Map<string, string>();

    if (userIds.length === 0) {
      return workspaceMemberIdByUserId;
    }

    const authContext = buildSystemAuthContext(workspaceId);

    await this.workspaceOrmManager.executeInWorkspaceContext(async () => {
      const workspaceMemberRepository =
        await this.workspaceOrmManager.getRepository(
          WorkspaceMemberWorkspaceEntity,
          {
            shouldBypassPermissionChecks: true,
          },
        );

      const workspaceMembers = await workspaceMemberRepository.findBy({
        userId: In(userIds),
      });

      for (const workspaceMember of workspaceMembers) {
        if (isDefined(workspaceMember.userId)) {
          workspaceMemberIdByUserId.set(
            workspaceMember.userId,
            workspaceMember.id,
          );
        }
      }
    }, authContext);

    return workspaceMemberIdByUserId;
  }
}
