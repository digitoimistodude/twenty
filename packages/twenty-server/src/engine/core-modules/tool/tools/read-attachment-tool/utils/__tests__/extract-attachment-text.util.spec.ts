import { extractAttachmentText } from 'src/engine/core-modules/tool/tools/read-attachment-tool/utils/extract-attachment-text.util';

// Tiny Office files, zipped once with Python: archiver stalls under Jest.
const DOCX_BASE64 =
  'UEsDBBQAAAAIAEByZl29JdWUUQAAAIsAAAARAAAAd29yZC9kb2N1bWVudC54bWyzKbdKyU8uzU3NK7GzKbdKyk+pBNEFIKIIRJTYhSQWZeWXFhdUVuaVHN5mow8SA5FFYLIAXblHZl5JooJaYm6BtUJOYmJJKRYd+jCb9JGsBwBQSwECFAMUAAAACABAcmZdvSXVlFEAAACLAAAAEQAAAAAAAAAAAAAAgAEAAAAAd29yZC9kb2N1bWVudC54bWxQSwUGAAAAAAEAAQA/AAAAgAAAAAAA';
const XLSX_BASE64 =
  'UEsDBBQAAAAIAEByZl08xLYlJAAAADQAAAAUAAAAeGwvc2hhcmVkU3RyaW5ncy54bWyzKS4usbMpzrSzKbFzLTq8xEYfyNUH8SFiHpl5JYkIQX2QcgBQSwMEFAAAAAgAQHJmXY7M+DpiAAAAzAAAABgAAAB4bC93b3Jrc2hlZXRzL3NoZWV0MS54bWyzKc8vyi7OSE0tsbMBUy6JJYl2NkX55QpFtkqGSnY2ySCGo6GSQomtUjGQX2ZnYKNfZmejnwyVczJU0ocynZGVGcKV6QONg5tpBDfTCE0ZxDQjhGlQBQamaCbpI7lUH+EBAFBLAQIUAxQAAAAIAEByZl08xLYlJAAAADQAAAAUAAAAAAAAAAAAAACAAQAAAAB4bC9zaGFyZWRTdHJpbmdzLnhtbFBLAQIUAxQAAAAIAEByZl2OzPg6YgAAAMwAAAAYAAAAAAAAAAAAAACAAVYAAAB4bC93b3Jrc2hlZXRzL3NoZWV0MS54bWxQSwUGAAAAAAIAAgCIAAAA7gAAAAAA';
const PPTX_BASE64 =
  'UEsDBBQAAAAIAEByZl07Vq7rHgAAACgAAAAWAAAAcHB0L3NsaWRlcy9zbGlkZTEwLnhtbLMpsCrOSbGzSbQqABEldiGpeTb6IAaIBIrpQxQAAFBLAwQUAAAACABAcmZdZFbT8x4AAAAoAAAAFQAAAHBwdC9zbGlkZXMvc2xpZGUyLnhtbLMpsCrOSbGzSbQqABEldiHl+Tb6IAaIBIrpQxQAAFBLAQIUAxQAAAAIAEByZl07Vq7rHgAAACgAAAAWAAAAAAAAAAAAAACAAQAAAABwcHQvc2xpZGVzL3NsaWRlMTAueG1sUEsBAhQDFAAAAAgAQHJmXWRW0/MeAAAAKAAAABUAAAAAAAAAAAAAAIABUgAAAHBwdC9zbGlkZXMvc2xpZGUyLnhtbFBLBQYAAAAAAgACAIcAAACjAAAAAAA=';

jest.useRealTimers();

describe('extractAttachmentText', () => {
  it('reads paragraphs from a Word document', async () => {
    const text = await extractAttachmentText(
      Buffer.from(DOCX_BASE64, 'base64'),
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );

    expect(text).toBe('Tarjouspyyntö\nHinta & laatu\n');
  });

  it('keeps empty cells from shifting spreadsheet values', async () => {
    const text = await extractAttachmentText(
      Buffer.from(XLSX_BASE64, 'base64'),
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );

    expect(text).toBe('--- Sheet 1 ---\nErä\t\tHinta\n1\t\t105');
  });

  it('orders slides numerically', async () => {
    const text = await extractAttachmentText(
      Buffer.from(PPTX_BASE64, 'base64'),
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    );

    expect(text).toBe('--- Slide 1 ---\nTwo\n\n--- Slide 2 ---\nTen\n');
  });

  it('decodes plain text files', async () => {
    expect(
      await extractAttachmentText(Buffer.from('a,b\n1,2'), 'text/csv'),
    ).toBe('a,b\n1,2');
  });

  it('returns null for images', async () => {
    expect(
      await extractAttachmentText(Buffer.from([0xff, 0xd8]), 'image/jpeg'),
    ).toBeNull();
  });
});
