import { Injectable, Logger } from '@nestjs/common';

import { FileFolder } from 'twenty-shared/types';
import { isDefined } from 'twenty-shared/utils';

import { FindRecordsService } from 'src/engine/core-modules/record-crud/services/find-records.service';
import { FileService } from 'src/engine/core-modules/file/services/file.service';
import { ReadAttachmentToolInputZodSchema } from 'src/engine/core-modules/tool/tools/read-attachment-tool/read-attachment-tool.schema';
import { extractAttachmentText } from 'src/engine/core-modules/tool/tools/read-attachment-tool/utils/extract-attachment-text.util';
import { type ToolExecutionContext } from 'src/engine/core-modules/tool/types/tool-execution-context.type';
import { type ToolInput } from 'src/engine/core-modules/tool/types/tool-input.type';
import { type ToolOutput } from 'src/engine/core-modules/tool/types/tool-output.type';
import { type Tool } from 'src/engine/core-modules/tool/types/tool.type';

const FAILURE_MESSAGE = 'Failed to read attachment';

// Claude rejects images above 5 MB once base64 encoded.
const MAX_IMAGE_BYTES = 3_750_000;

type AttachmentFile = { fileId: string; label?: string; extension?: string };

export type ReadAttachmentImage = { data: string; mimeType: string };

@Injectable()
export class ReadAttachmentTool implements Tool {
  private readonly logger = new Logger(ReadAttachmentTool.name);

  description =
    'Read the file behind an attachment record. Returns the text of PDF, Word, Excel, PowerPoint and plain text files, and the image itself for images. Long files come back in parts: pass nextOffset as offset to continue.';
  inputSchema = ReadAttachmentToolInputZodSchema;

  constructor(
    private readonly findRecordsService: FindRecordsService,
    private readonly fileService: FileService,
  ) {}

  async execute(
    parameters: ToolInput,
    context: ToolExecutionContext,
  ): Promise<ToolOutput> {
    const parseResult = ReadAttachmentToolInputZodSchema.safeParse(parameters);

    if (!parseResult.success) {
      return {
        success: false,
        message: FAILURE_MESSAGE,
        error: parseResult.error.issues
          .map(
            (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
          )
          .join('; '),
      };
    }

    if (!isDefined(context.authContext)) {
      return {
        success: false,
        message: FAILURE_MESSAGE,
        error: 'Reading attachments needs an authenticated workspace caller',
      };
    }

    const { attachmentId, offset, maxChars } = parseResult.data;

    // Through the record API so the caller's object and row permissions apply.
    const found = await this.findRecordsService.execute({
      objectName: 'attachment',
      filter: { id: { eq: attachmentId } },
      limit: 1,
      authContext: context.authContext,
      shouldBuildEffectiveSelectFields: false,
    });

    const attachment = found.result?.records[0];

    if (!found.success || !isDefined(attachment)) {
      return {
        success: false,
        message: FAILURE_MESSAGE,
        error:
          found.error ?? `Attachment ${attachmentId} not found or not readable`,
      };
    }

    const file = (attachment.file as AttachmentFile[] | null)?.[0];

    if (!isDefined(file?.fileId)) {
      return {
        success: false,
        message: FAILURE_MESSAGE,
        error: `Attachment ${attachmentId} has no file`,
      };
    }

    const content = await this.fileService.getFileContentById({
      fileId: file.fileId,
      workspaceId: context.workspaceId,
      fileFolder: FileFolder.FilesField,
    });

    if (!isDefined(content)) {
      return {
        success: false,
        message: FAILURE_MESSAGE,
        error: `The file of attachment ${attachmentId} is missing from storage`,
      };
    }

    const name =
      (attachment.name as string | null) ?? file.label ?? file.fileId;
    const details = {
      attachmentId,
      name,
      mimeType: content.mimeType,
      sizeBytes: content.buffer.length,
    };

    if (content.mimeType.startsWith('image/')) {
      return this.imageOutput(details, content.buffer);
    }

    try {
      const text = await extractAttachmentText(
        content.buffer,
        content.mimeType,
      );

      if (!isDefined(text)) {
        return {
          success: false,
          message: FAILURE_MESSAGE,
          error: `No text can be read from a ${content.mimeType} file`,
        };
      }

      const part = text.slice(offset, offset + maxChars);
      const end = offset + part.length;

      return {
        success: true,
        message: `Read ${name}`,
        result: {
          ...details,
          totalChars: text.length,
          offset,
          ...(end < text.length && { nextOffset: end }),
          text: part,
        },
      };
    } catch (error) {
      this.logger.warn(`Could not read attachment ${attachmentId}: ${error}`);

      return {
        success: false,
        message: FAILURE_MESSAGE,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private imageOutput(
    details: {
      attachmentId: string;
      name: string;
      mimeType: string;
      sizeBytes: number;
    },
    buffer: Buffer,
  ): ToolOutput {
    if (buffer.length > MAX_IMAGE_BYTES) {
      return {
        success: false,
        message: FAILURE_MESSAGE,
        error: `Image is ${buffer.length} bytes, the limit is ${MAX_IMAGE_BYTES}`,
      };
    }

    const image: ReadAttachmentImage = {
      data: buffer.toString('base64'),
      mimeType: details.mimeType,
    };

    return {
      success: true,
      message: `Read image ${details.name}`,
      result: { ...details, image },
    };
  }
}
