export type McpToolCallContent =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string };

export type McpToolCallResult = {
  content: McpToolCallContent[];
  isError: boolean;
};
