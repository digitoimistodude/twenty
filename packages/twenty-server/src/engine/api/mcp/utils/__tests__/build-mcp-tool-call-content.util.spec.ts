import { buildMcpToolCallContent } from 'src/engine/api/mcp/utils/build-mcp-tool-call-content.util';

describe('buildMcpToolCallContent', () => {
  it('keeps a plain tool output as one JSON text block', () => {
    const output = { success: true, message: 'ok', result: { text: 'hello' } };

    expect(buildMcpToolCallContent(output)).toEqual([
      { type: 'text', text: JSON.stringify(output) },
    ]);
  });

  it('moves an image out of the JSON into an image block', () => {
    const output = {
      success: true,
      message: 'Read image',
      result: {
        name: 'logo.png',
        image: { data: 'aGk=', mimeType: 'image/png' },
      },
    };

    expect(buildMcpToolCallContent(output)).toEqual([
      {
        type: 'text',
        text: JSON.stringify({
          success: true,
          message: 'Read image',
          result: { name: 'logo.png' },
        }),
      },
      { type: 'image', data: 'aGk=', mimeType: 'image/png' },
    ]);
  });
});
