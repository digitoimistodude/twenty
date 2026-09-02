import { lazy, type ComponentType } from 'react';
import {
  isStandardTimelineActivityRendererUniversalIdentifier,
  STANDARD_TIMELINE_ACTIVITY_RENDERER_UNIVERSAL_IDENTIFIERS,
  type StandardTimelineActivityRendererUniversalIdentifier,
} from 'twenty-shared/timeline';
import { isDefined } from 'twenty-shared/utils';

import { type StandardTimelineActivityRendererProps } from '@/activities/timeline-activities/rows/components/TimelineActivityRenderer';
import { isTimelineActivityWithLinkedRecord } from '@/activities/timeline-activities/types/TimelineActivity';

const EventCardCalendarEvent = lazy(() =>
  import('@/activities/timeline-activities/rows/calendar/components/EventCardCalendarEvent').then(
    (module) => ({ default: module.EventCardCalendarEvent }),
  ),
);

const EventCardComment = lazy(() =>
  import('@/activities/timeline-activities/rows/comment/components/EventCardComment').then(
    (module) => ({ default: module.EventCardComment }),
  ),
);

const EventCardMessage = lazy(() =>
  import('@/activities/timeline-activities/rows/message/components/EventCardMessage').then(
    (module) => ({ default: module.EventCardMessage }),
  ),
);

type MessageTimelineActivityRendererProps =
  StandardTimelineActivityRendererProps;

const MessageTimelineActivityRenderer = ({
  event,
  authorFullName,
}: MessageTimelineActivityRendererProps) =>
  isTimelineActivityWithLinkedRecord(event) ? (
    <EventCardMessage
      messageId={event.linkedRecordId}
      authorFullName={authorFullName}
    />
  ) : null;

type CalendarEventTimelineActivityRendererProps =
  StandardTimelineActivityRendererProps;

const CalendarEventTimelineActivityRenderer = ({
  event,
}: CalendarEventTimelineActivityRendererProps) =>
  isTimelineActivityWithLinkedRecord(event) ? (
    <EventCardCalendarEvent calendarEventId={event.linkedRecordId} />
  ) : null;

type CommentTimelineActivityRendererProps =
  StandardTimelineActivityRendererProps;

const CommentTimelineActivityRenderer = ({
  event,
  authorFullName,
}: CommentTimelineActivityRendererProps) =>
  isTimelineActivityWithLinkedRecord(event) ? (
    <EventCardComment
      recordCommentId={event.linkedRecordId}
      authorFullName={authorFullName}
    />
  ) : null;

const STANDARD_TIMELINE_ACTIVITY_RENDERERS: Record<
  StandardTimelineActivityRendererUniversalIdentifier,
  ComponentType<StandardTimelineActivityRendererProps>
> = {
  [STANDARD_TIMELINE_ACTIVITY_RENDERER_UNIVERSAL_IDENTIFIERS.message]:
    MessageTimelineActivityRenderer,
  [STANDARD_TIMELINE_ACTIVITY_RENDERER_UNIVERSAL_IDENTIFIERS.calendarEvent]:
    CalendarEventTimelineActivityRenderer,
  [STANDARD_TIMELINE_ACTIVITY_RENDERER_UNIVERSAL_IDENTIFIERS.comment]:
    CommentTimelineActivityRenderer,
};

export const getStandardTimelineActivityRenderer = (
  universalIdentifier: string | null | undefined,
): ComponentType<StandardTimelineActivityRendererProps> | null => {
  if (
    !isDefined(universalIdentifier) ||
    !isStandardTimelineActivityRendererUniversalIdentifier(universalIdentifier)
  ) {
    return null;
  }

  return STANDARD_TIMELINE_ACTIVITY_RENDERERS[universalIdentifier];
};
