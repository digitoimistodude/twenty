import { z } from 'zod';

export const READ_ATTACHMENT_DEFAULT_MAX_CHARS = 100_000;
export const READ_ATTACHMENT_MAX_CHARS_LIMIT = 400_000;

export const ReadAttachmentToolInputZodSchema = z.object({
  attachmentId: z
    .string()
    .uuid()
    .describe(
      'The id of the attachment record. Find it with find_many_attachments, filtered by targetOpportunityId, targetCompanyId or targetPersonId.',
    ),
  offset: z
    .number()
    .int()
    .min(0)
    .default(0)
    .describe(
      'Character offset to start reading from. Use the nextOffset of a previous call to read the rest of a long file.',
    ),
  maxChars: z
    .number()
    .int()
    .min(1)
    .max(READ_ATTACHMENT_MAX_CHARS_LIMIT)
    .default(READ_ATTACHMENT_DEFAULT_MAX_CHARS)
    .describe('How many characters of text to return in this call.'),
});
