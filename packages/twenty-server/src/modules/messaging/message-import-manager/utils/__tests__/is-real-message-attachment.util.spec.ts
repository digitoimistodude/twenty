import { type gmail_v1 as gmailV1 } from 'googleapis';

import { isRealMessageAttachment } from 'src/modules/messaging/message-import-manager/utils/is-real-message-attachment.util';

const part = (
  overrides: Partial<gmailV1.Schema$MessagePart> & {
    disposition?: string;
    contentId?: boolean;
  },
): gmailV1.Schema$MessagePart => {
  const { disposition, contentId, ...rest } = overrides;
  const headers: gmailV1.Schema$MessagePartHeader[] = [];

  if (disposition) {
    headers.push({ name: 'Content-Disposition', value: disposition });
  }
  if (contentId) {
    headers.push({ name: 'Content-ID', value: '<x@y>' });
  }

  return {
    filename: 'file.bin',
    mimeType: 'application/octet-stream',
    body: { attachmentId: 'att', size: 1000 },
    headers,
    ...rest,
  };
};

describe('isRealMessageAttachment', () => {
  it('should keep a PDF marked attachment even when Outlook adds a Content-ID', () => {
    const pdf = part({
      filename: 'Paivitetty tarjous.pdf',
      mimeType: 'application/pdf',
      body: { attachmentId: 'att', size: 2185647 },
      disposition: 'attachment; filename="Paivitetty tarjous.pdf"',
      contentId: true,
    });

    expect(isRealMessageAttachment(pdf)).toBe(true);
  });

  it('should drop a signature logo even when Outlook marks it as an attachment', () => {
    const logo = part({
      filename: 'Duden logo',
      mimeType: 'image/png',
      body: { attachmentId: 'att', size: 1511 },
      disposition: 'attachment; filename="Duden logo"',
      contentId: true,
    });

    expect(isRealMessageAttachment(logo)).toBe(false);
  });

  it('should keep a large image someone genuinely attached', () => {
    const photo = part({
      filename: 'pohjapiirros.png',
      mimeType: 'image/png',
      body: { attachmentId: 'att', size: 4920449 },
      disposition: 'attachment; filename="pohjapiirros.png"',
    });

    expect(isRealMessageAttachment(photo)).toBe(true);
  });

  it('should drop an inline signature image referenced from the body', () => {
    const logo = part({
      filename: 'image001.png',
      mimeType: 'image/png',
      body: { attachmentId: 'att', size: 242204 },
      disposition: 'inline; filename="image001.png"',
      contentId: true,
    });

    expect(isRealMessageAttachment(logo)).toBe(false);
  });

  it('should drop a tiny image with no disposition', () => {
    const pixel = part({
      filename: 'pixel.png',
      mimeType: 'image/png',
      body: { attachmentId: 'att', size: 900 },
    });

    expect(isRealMessageAttachment(pixel)).toBe(false);
  });

  it('should drop parts without a filename or attachment id', () => {
    expect(isRealMessageAttachment(part({ filename: '' }))).toBe(false);
    expect(isRealMessageAttachment(part({ body: { size: 10 } }))).toBe(false);
  });
});
