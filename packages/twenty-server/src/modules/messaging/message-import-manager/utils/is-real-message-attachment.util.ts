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

  const isImage = /^image\//.test(part.mimeType ?? '');

  // Size is the only reliable signal for images: Outlook marks signature logos
  // as attachments, and a real photo can carry a Content-ID. Everything else
  // that names a file and is not body-embedded is a document worth keeping.
  if (isImage) {
    const isEmbedded =
      /inline/i.test(header('content-disposition')) || header('content-id') !== '';

    return (
      !isEmbedded && (part.body.size ?? 0) >= INLINE_IMAGE_MAX_SIZE_IN_BYTES
    );
  }

  if (/^\s*attachment/i.test(header('content-disposition'))) {
    return true;
  }

  return !/inline/i.test(header('content-disposition'));
};

export const collectMessageParts = (
  part: gmailV1.Schema$MessagePart | undefined,
): gmailV1.Schema$MessagePart[] => {
  if (!part) {
    return [];
  }

  return [part, ...(part.parts ?? []).flatMap(collectMessageParts)];
};
