export const STANDARD_TIMELINE_ACTIVITY_RENDERER_UNIVERSAL_IDENTIFIERS = {
  message: '8b4da8ed-4a87-480d-bcad-a791262cb890',
  calendarEvent: '3c70dd28-42f3-41da-8f41-22013d65ff50',
  // recordComment is our own object, so this identifier is ours too
  comment: 'b7c2f1a4-5e63-4d02-9f18-2ac47d6e8b31',
} as const;

export type StandardTimelineActivityRendererUniversalIdentifier =
  (typeof STANDARD_TIMELINE_ACTIVITY_RENDERER_UNIVERSAL_IDENTIFIERS)[keyof typeof STANDARD_TIMELINE_ACTIVITY_RENDERER_UNIVERSAL_IDENTIFIERS];

export const isStandardTimelineActivityRendererUniversalIdentifier = (
  value: string,
): value is StandardTimelineActivityRendererUniversalIdentifier =>
  Object.values(
    STANDARD_TIMELINE_ACTIVITY_RENDERER_UNIVERSAL_IDENTIFIERS,
  ).includes(value as StandardTimelineActivityRendererUniversalIdentifier);
