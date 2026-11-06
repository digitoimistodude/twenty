import { isObject } from '@sniptt/guards';
import { isDefined } from 'twenty-shared/utils';

import { type McpToolCallContent } from 'src/engine/api/mcp/types/mcp-tool-call-result.type';

type ImagePayload = { data: string; mimeType: string };

const isImagePayload = (value: unknown): value is ImagePayload =>
  isObject(value) &&
  typeof (value as ImagePayload).data === 'string' &&
  typeof (value as ImagePayload).mimeType === 'string';

// A tool output carrying result.image goes out as an MCP image block, so the
// client sees the picture instead of a base64 string inside JSON.
export const buildMcpToolCallContent = (
  output: unknown,
): McpToolCallContent[] => {
  const result = isObject(output)
    ? (output as { result?: unknown }).result
    : undefined;
  const image = isObject(result)
    ? (result as { image?: unknown }).image
    : undefined;

  if (!isDefined(image) || !isImagePayload(image)) {
    return [{ type: 'text', text: JSON.stringify(output) }];
  }

  const { image: _image, ...resultWithoutImage } = result as Record<
    string,
    unknown
  >;

  return [
    {
      type: 'text',
      text: JSON.stringify({
        ...(output as object),
        result: resultWithoutImage,
      }),
    },
    { type: 'image', data: image.data, mimeType: image.mimeType },
  ];
};
