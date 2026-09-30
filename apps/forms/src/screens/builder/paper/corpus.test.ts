import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { debugSnapshot, type RawDocument } from '@tp/shared/import';
import { readDocx } from './docx.js';
import { openPdf, type Pdfjs } from './extract.js';
import { readDocument } from './pipeline.js';
import type { Reading } from './reading.js';

/**
 * The golden corpus — `docs/plan/IMPORT-PIPELINE.md`, "The golden corpus": real documents, written
 * by a real word processor, read by exactly the code the paper door runs. Stage 1 (`openPdf` with
 * Node's pdf.js, or `readDocx`), then stages 2 to 7 (`readDocument`, as in the worker).
 *
 * Each document's expectation (`fixtures/documents/expected/`) was written by hand from what the
 * document says, before it was run: the numbered items a person reading it would list, in reading
 * order, nested as they are nested, with their wording verbatim — and the document's language, and
 * (since S9) every part of it a person would list: its headings, its text, and its questions with
 * what answers them and the type they would give them. The PDF and the Word file of a document are
 * held to the same expectation, so they agree. Each stage's
 * debug artifact is a snapshot besides (`fixtures/documents/debug/`), so a change to any decision is
 * a diff to review, not only a change to the items.
 */

const ROOT = new URL('../../../../../../', import.meta.url).pathname.replace(
  /^\/([A-Za-z]:)/,
  '$1',
);
const CORPUS = join(ROOT, 'fixtures', 'documents');
const EXPECTED = join(CORPUS, 'expected');
const DEBUG = join(CORPUS, 'debug');
const FORMATS = ['pdf', 'docx'] as const;
type Format = (typeof FORMATS)[number];

interface Source {
  name: string;
  language: string;
  summary: string;
  features: string[];
  spec: string;
  files: Record<Format, { path: string; sha256: string }>;
}
interface Sources {
  licence: string;
  tool: string;
  documents: Source[];
}

/** An item as a person lists it: its marker, its words, what is written under it, and its items. */
interface Listed {
  marker: string;
  label: string;
  /** Lines under the label that belong to it without being it (J1): help text, a note. */
  details?: string[];
  /** "accept" unless it says otherwise. */
  verdict?: string;
  flags?: string[];
  items?: Listed[];
}
/**
 * A part of the document as a person lists it: a heading, text to read, or a question with what
 * answers it and the type they would give it (stages 4 and 5).
 */
interface Seen {
  kind: string;
  text?: string;
  label?: string | null;
  answer?: string;
  type?: string;
  options?: string[];
  details?: string[];
  rows?: string[];
  columns?: string[];
  rowCount?: number;
  flags?: string[];
}
interface Expectation {
  document: string;
  locale: string;
  items: Listed[];
  segments: Seen[];
}

const sources = JSON.parse(readFileSync(join(CORPUS, 'SOURCES.json'), 'utf8')) as Sources;
const expectation = (name: string) =>
  JSON.parse(readFileSync(join(EXPECTED, `${name}.json`), 'utf8')) as Expectation;

const require = createRequire(import.meta.url);
/** pdf.js in Node: the same legacy build the browser loads, its worker run in-process. */
async function nodePdfjs(): Promise<Pdfjs> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(
    require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs'),
  ).href;
  return pdfjs;
}

async function stageOne(format: Format, bytes: Uint8Array): Promise<RawDocument> {
  if (format === 'docx') return readDocx(bytes);
  const pdf = await openPdf(bytes.slice().buffer, 0, nodePdfjs);
  try {
    return await pdf.raw();
  } finally {
    await pdf.close();
  }
}

/** Stage 3's items as the tree a person would write down. */
function listed({ lists, layout }: Reading): Listed[] {
  const text = new Map(
    layout.pages.flatMap((page) =>
      page.blocks.flatMap((block) => block.lines.map((line) => [line.id, line.text] as const)),
    ),
  );
  const under = (parentId: string | null): Listed[] =>
    lists.items
      .filter((item) => item.parentId === parentId)
      .map((item) => {
        const children = under(item.id);
        return {
          marker: item.marker.raw,
          label: item.label,
          ...(item.detailLineIds.length
            ? { details: item.detailLineIds.map((id) => text.get(id)!) }
            : {}),
          ...(item.verdict === 'accept' ? {} : { verdict: item.verdict }),
          ...(item.flags.length ? { flags: [...item.flags] } : {}),
          ...(children.length ? { items: children } : {}),
        };
      });
  return under(null);
}

/** Stage 4's segments, with stage 5's type for each question, as the expectations write them. */
function seen({ segments, classified }: Reading): Seen[] {
  const types = new Map(classified.classified.map((c) => [c.segmentIndex, c.kind]));
  return segments.segments.map((segment, index): Seen => {
    const type = types.get(index);
    switch (segment.kind) {
      case 'heading':
      case 'instruction':
      case 'meta':
        return { kind: segment.kind, text: segment.text };
      case 'question':
        return {
          kind: 'question',
          label: segment.label,
          answer: segment.answer,
          type,
          ...(segment.options.length ? { options: segment.options } : {}),
          ...(segment.details.length ? { details: segment.details } : {}),
          ...(segment.flags.length ? { flags: segment.flags } : {}),
        };
      case 'grid':
        return {
          kind: 'grid',
          label: segment.label,
          rows: segment.rows,
          columns: segment.columns,
          type,
          ...(segment.flags.length ? { flags: segment.flags } : {}),
        };
      case 'table':
        return {
          kind: 'table',
          label: segment.label,
          columns: segment.columns,
          rowCount: segment.rowCount,
          type,
          ...(segment.flags.length ? { flags: segment.flags } : {}),
        };
    }
  });
}

describe('the golden corpus', () => {
  it('lists every file it holds, by hash, under its licence', () => {
    expect(sources.licence).toBe('CC0-1.0');
    expect(sources.tool).toMatch(/^LibreOffice \d+\.\d+/);
    const listedFiles = sources.documents.flatMap((doc) =>
      FORMATS.map((format) => doc.files[format].path),
    );
    const onDisk = readdirSync(CORPUS).filter((name) => /\.(pdf|docx)$/.test(name));
    expect([...listedFiles].sort()).toEqual([...onDisk].sort());
    for (const doc of sources.documents) {
      expect(doc.summary.length, doc.name).toBeGreaterThan(20);
      expect(doc.features.length, doc.name).toBeGreaterThan(0);
      for (const format of FORMATS) {
        const { path, sha256 } = doc.files[format];
        expect(path).toBe(`${doc.name}.${format}`);
        const actual = createHash('sha256')
          .update(readFileSync(join(CORPUS, path)))
          .digest('hex');
        expect(actual, `${path} is not the file SOURCES.json lists`).toBe(sha256);
      }
    }
  });

  it('has an expectation for every document, and none for a document it lacks', () => {
    const names = sources.documents.map((doc) => doc.name).sort();
    const written = readdirSync(EXPECTED)
      .filter((name) => name.endsWith('.json'))
      .map((name) => name.slice(0, -'.json'.length))
      .sort();
    expect(written).toEqual(names);
    for (const name of names) expect(expectation(name).document).toBe(name);
  });

  for (const doc of sources.documents) {
    for (const format of FORMATS) {
      it(`${doc.name}.${format} is read as its expectation says`, async () => {
        const expected = expectation(doc.name);
        const raw = await stageOne(
          format,
          new Uint8Array(readFileSync(join(CORPUS, `${doc.name}.${format}`))),
        );
        const reading = readDocument({ kind: 'raw', raw });
        expect(listed(reading)).toStrictEqual(expected.items);
        expect(reading.layout.locale).toBe(expected.locale);
        expect(seen(reading)).toStrictEqual(expected.segments);
        for (const debug of reading.debug) {
          await expect(debugSnapshot(debug)).toMatchFileSnapshot(
            join(DEBUG, `${doc.name}.${format}.${debug.stage}.json`),
          );
        }
      }, 30_000);
    }
  }

  // A snapshot left behind by a renamed document would fail nothing, so this does.
  it('keeps no debug snapshot that no document writes', () => {
    const written = new Set(
      sources.documents.flatMap((doc) =>
        FORMATS.flatMap((format) =>
          ['reassemble', 'enumerate', 'segment', 'classify', 'score'].map(
            (stage) => `${doc.name}.${format}.${stage}.json`,
          ),
        ),
      ),
    );
    const snapshots = existsSync(DEBUG) ? readdirSync(DEBUG) : [];
    expect(snapshots.filter((name) => !written.has(name))).toEqual([]);
  });
});
