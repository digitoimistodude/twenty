import { type gmail_v1 as gmailV1 } from 'googleapis';

// Signature logos and embedded images are attachment parts too, so importing
// every part would bury the real documents under a pile of 1 KB logos.
const INLINE_IMAGE_MAX_SIZE_IN_BYTES = 20_000;

export const isRealMessageAttachment = (
  part: gmailV1.Schema$MessagePart,
): boolean => {
  if (!part.filename || !part.body?.attachmentId) {
    return false;
  }

  const headers = part.headers ?? [];
  const disposition =
    headers.find((header) => header.name?.toLowerCase() === 'content-disposition')
      ?.value ?? '';

  const isReferencedInTheBody = headers.some(
    (header) => header.name?.toLowerCase() === 'content-id',
  );

  if (/inline/i.test(disposition) || isReferencedInTheBody) {
    return false;
  }

  const isSmallImage =
    /^image\//.test(part.mimeType ?? '') &&
    (part.body.size ?? 0) < INLINE_IMAGE_MAX_SIZE_IN_BYTES;

  return !isSmallImage;
};

export const collectMessageParts = (
  part: gmailV1.Schema$MessagePart | undefined,
): gmailV1.Schema$MessagePart[] => {
  if (!part) {
    return [];
  }

  return [part, ...(part.parts ?? []).flatMap(collectMessageParts)];
};
