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
  const header = (name: string) =>
    headers.find((h) => h.name?.toLowerCase() === name)?.value ?? '';

  // Outlook stamps a Content-ID on real attachments too, so an explicit
  // attachment disposition has to win over that header. A 2 MB offer PDF was
  // being dropped as a "signature image" because of it.
  if (/^\s*attachment/i.test(header('content-disposition'))) {
    return true;
  }

  const isImage = /^image\//.test(part.mimeType ?? '');
  const isEmbedded =
    /inline/i.test(header('content-disposition')) ||
    header('content-id') !== '';

  if (isEmbedded) {
    return !isImage;
  }

  const isSmallImage =
    isImage && (part.body.size ?? 0) < INLINE_IMAGE_MAX_SIZE_IN_BYTES;

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
