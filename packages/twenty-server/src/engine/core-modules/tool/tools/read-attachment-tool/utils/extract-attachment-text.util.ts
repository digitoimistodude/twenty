import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const PDF_TO_TEXT_TIMEOUT_MS = 60_000;
const PDF_TO_TEXT_MAX_BUFFER_BYTES = 64 * 1024 * 1024;

const DOCX_MIME_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX_MIME_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const PPTX_MIME_TYPE =
  'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const PDF_MIME_TYPE = 'application/pdf';

const TEXT_MIME_TYPES = new Set([
  'application/json',
  'application/xml',
  'application/csv',
  'application/rtf',
  'message/rfc822',
]);

const XML_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

const decodeXmlText = (xml: string): string =>
  xml
    .replace(/<[^>]+>/g, '')
    .replace(
      /&(amp|lt|gt|quot|apos);/g,
      (_, name: string) => XML_ENTITIES[name],
    )
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCodePoint(Number(code)),
    );

const readZipEntries = async (
  buffer: Buffer,
  matches: (path: string) => boolean,
): Promise<{ path: string; xml: string }[]> => {
  const { default: unzipper } = await import('unzipper');
  const directory = await unzipper.Open.buffer(buffer);

  const entries = directory.files
    .filter((entry) => entry.type === 'File' && matches(entry.path))
    .sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));

  return Promise.all(
    entries.map(async (entry) => ({
      path: entry.path,
      xml: (await entry.buffer()).toString('utf8'),
    })),
  );
};

const docxToText = async (buffer: Buffer): Promise<string> => {
  const [document] = await readZipEntries(
    buffer,
    (path) => path === 'word/document.xml',
  );

  return decodeXmlText(
    (document?.xml ?? '').replace(/<\/w:p>/g, '\n').replace(/<w:tab\/>/g, '\t'),
  );
};

const pptxToText = async (buffer: Buffer): Promise<string> => {
  const slides = await readZipEntries(buffer, (path) =>
    /^ppt\/slides\/slide\d+\.xml$/.test(path),
  );

  return slides
    .map(
      ({ xml }, index) =>
        `--- Slide ${index + 1} ---\n${decodeXmlText(xml.replace(/<\/a:p>/g, '\n'))}`,
    )
    .join('\n');
};

// An empty cell is written <c r="A1"/>; matching only <c>...</c> pairs would
// attach its attributes to the next cell's value.
const CELL_PATTERN = /<c(?=[\s/>])([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;

const xlsxToText = async (buffer: Buffer): Promise<string> => {
  const entries = await readZipEntries(
    buffer,
    (path) =>
      path === 'xl/sharedStrings.xml' ||
      /^xl\/worksheets\/sheet\d+\.xml$/.test(path),
  );

  const sharedStringsXml =
    entries.find(({ path }) => path === 'xl/sharedStrings.xml')?.xml ?? '';
  const sharedStrings = [
    ...sharedStringsXml.matchAll(/<si>([\s\S]*?)<\/si>/g),
  ].map(([, item]) => decodeXmlText(item));

  return entries
    .filter(({ path }) => path.startsWith('xl/worksheets/'))
    .map(({ xml }, index) => {
      const rows = [...xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].map(
        ([, row]) =>
          [...row.matchAll(CELL_PATTERN)]
            .map(([, attributes, body = '']) => {
              const value = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];

              if (/t="s"/.test(attributes) && value !== undefined) {
                return sharedStrings[Number(value)] ?? '';
              }

              if (/t="inlineStr"/.test(attributes)) {
                return decodeXmlText(body);
              }

              return value === undefined ? '' : decodeXmlText(value);
            })
            .join('\t')
            .replace(/\t+$/, ''),
      );

      return `--- Sheet ${index + 1} ---\n${rows.filter((row) => row !== '').join('\n')}`;
    })
    .join('\n');
};

const pdfToText = async (buffer: Buffer): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), 'read-attachment-'));
  const pdfPath = join(directory, 'file.pdf');

  try {
    await writeFile(pdfPath, buffer);

    const { stdout } = await execFileAsync(
      'pdftotext',
      ['-layout', pdfPath, '-'],
      {
        encoding: 'utf8',
        timeout: PDF_TO_TEXT_TIMEOUT_MS,
        maxBuffer: PDF_TO_TEXT_MAX_BUFFER_BYTES,
      },
    );

    return stdout;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
};

const isPlainText = (mimeType: string): boolean =>
  mimeType.startsWith('text/') || TEXT_MIME_TYPES.has(mimeType);

// Returns null when the file type has no text to extract.
export const extractAttachmentText = async (
  buffer: Buffer,
  mimeType: string,
): Promise<string | null> => {
  if (mimeType === PDF_MIME_TYPE) {
    return pdfToText(buffer);
  }

  if (mimeType === DOCX_MIME_TYPE) {
    return docxToText(buffer);
  }

  if (mimeType === XLSX_MIME_TYPE) {
    return xlsxToText(buffer);
  }

  if (mimeType === PPTX_MIME_TYPE) {
    return pptxToText(buffer);
  }

  if (isPlainText(mimeType)) {
    return buffer.toString('utf8');
  }

  return null;
};
