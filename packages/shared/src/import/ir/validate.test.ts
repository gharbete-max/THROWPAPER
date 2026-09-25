import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IrError, layoutProblems, parseLayoutDocument, rawProblems } from './validate.js';

/**
 * One broken document per invariant of `LAYOUT-IR.md`, each proving the validator notices it.
 *
 * Every fixture passing proves only that today's fixtures are fine. These start from a real
 * sample, break it in exactly one way, and expect a problem that names the place.
 */

type Json = Record<string, unknown> & { pages: Page[] };
type Page = Record<string, unknown> & { columns: Column[]; blocks: Block[] };
type Column = Record<string, unknown> & { bands: number[] };
type Block = Record<string, unknown> & { lines: Line[] };
type Line = Record<string, unknown> & { words: Word[]; box: Box; hints: Record<string, unknown> };
type Word = Record<string, unknown> & { box: Box };
type Box = { x0: number; y0: number; x1: number; y1: number };

const SAMPLE = readFileSync(
  new URL('../../../../../fixtures/ir/single-column.ir.json', import.meta.url),
  'utf8',
);
const sample = (): Json => JSON.parse(SAMPLE) as Json;
const page = (doc: Json) => doc.pages[0]!;
// Block 2 of the sample is its numbered list: five body lines, regular weight, two bands.
const block = (doc: Json, i = 1) => page(doc).blocks[i]!;
const line = (doc: Json, b = 1, l = 0) => block(doc, b).lines[l]!;

const broken = (mutate: (doc: Json) => void) => {
  const doc = sample();
  mutate(doc);
  return layoutProblems(doc);
};

describe('layoutProblems', () => {
  it('passes the sample it breaks', () => {
    expect(layoutProblems(sample())).toEqual([]);
  });

  it.each<[string, (doc: Json) => void, RegExp]>([
    // Shape.
    ['an unknown key', (d) => (line(d).colour = 'red'), /Unrecognized key/],
    ['a fraction', (d) => (line(d).box.x0 = 1000.5), /integer/],
    ['an iu above 10000', (d) => (line(d).box.x1 = 10001), /10000/],
    ['another irVersion', (d) => (d.irVersion = 2), /irVersion/],
    ['an unknown role', (d) => (block(d).role = 'sidebar'), /role/],
    ['a block with no lines', (d) => (block(d).lines = []), /lines/],
    // 1. Boxes.
    ['an inverted line box', (d) => (line(d).box = { x0: 9, y0: 9, x1: 1, y1: 1 }), /inverted/],
    ['an inverted word box', (d) => (line(d).words[0]!.box.y0 = 9999), /inverted/],
    // 2. Ids, parents, page numbers.
    ['a skipped page number', (d) => (page(d).pageNo = 2), /pageNo is 2/],
    ['a line id out of sequence', (d) => (line(d).id = 'p1-l9'), /expected id p1-l2/],
    ['a block id out of sequence', (d) => (block(d).id = 'p1-b7'), /expected id p1-b2/],
    ['a line in the wrong block', (d) => (line(d).blockId = 'p1-b1'), /blockId/],
    ['a line in the wrong column', (d) => (line(d).columnIndex = 1), /column/],
    ['lines out of order in a block', (d) => block(d).lines.reverse(), /expected id|above/],
    // 3. Text and offsets.
    ['text that is not its words', (d) => (line(d).text = `${String(line(d).text)} `), /joined/],
    ['a word start that points elsewhere', (d) => (line(d).words[1]!.start = 0), /starts at 0/],
    // 4. Bands.
    ['a band that does not exist', (d) => (line(d).indentBand = 5), /no band 5/],
    ['an x0 outside its band', (d) => (line(d).indentBand = 1), /not in band 1|no band 1/],
    // 5. OCR confidence.
    ['OCR confidence on a text layer', (d) => (line(d).ocrConfidence = 90), /ocrConfidence/],
    // 7. Derived fields.
    ['a box that is not the union', (d) => (line(d).box.x1 += 1), /union/],
    ['a baseline that is not the median', (d) => (line(d).baseline = 1), /baseline/],
    ['a font size that is not the median', (d) => (line(d).fontSize = 1), /fontSize/],
    ['a bold line with a regular word', (d) => (line(d).fontWeight = 700), /fontWeight/],
    // 8. Source-only facts.
    ['Word numbering on a PDF line', (d) => docx(line(d)), /docxNumbering off DOCX/],
    ['a table cell on a PDF line', (d) => (line(d).cell = { row: 0, col: 0 }), /cell off DOCX/],
  ])('rejects %s', (_name, mutate, expected) => {
    const problems = broken(mutate);
    expect(problems.join('\n')).toMatch(expected);
  });

  it('lists every problem, not the first', () => {
    const problems = broken((d) => {
      line(d, 1, 0).box.x1 += 1;
      line(d, 1, 1).fontWeight = 700;
    });
    expect(problems).toHaveLength(2);
  });

  it('says where the shape is wrong, and summarises a flood', () => {
    const doc = sample();
    for (const b of page(doc).blocks) for (const l of b.lines) l.baseline = -1;
    const problems = layoutProblems(doc);
    expect(problems[0]).toMatch(/^pages\.0\.blocks\.0\.lines\.0\.baseline: /);
    expect(problems.length).toBeLessThanOrEqual(21);
  });
});

function docx(target: Line) {
  target.hints.docxNumbering = { numId: 1, ilvl: 0, rendered: '1.', format: 'decimal' };
}

describe('parseLayoutDocument', () => {
  it('returns the document when it is valid, and throws every problem when not', () => {
    expect(parseLayoutDocument(sample()).irVersion).toBe(1);
    const doc = sample();
    line(doc).box.x1 += 1;
    expect(() => parseLayoutDocument(doc)).toThrow(IrError);
    try {
      parseLayoutDocument(doc);
    } catch (error) {
      expect((error as IrError).problems).toEqual(layoutProblems(doc));
    }
  });
});

describe('rawProblems', () => {
  const raw = () => ({
    irVersion: 1,
    source: { kind: 'pdf', extractor: 'test', sha256: null },
    pages: [
      {
        pageNo: 1,
        widthPt: 595,
        heightPt: 842,
        rules: [],
        words: [
          {
            text: 'Namn',
            box: { x0: 1000, y0: 895, x1: 1368, y1: 1026 },
            baseline: 1000,
            fontSize: 131,
            fontWeight: 400,
            italic: false,
            ocrConfidence: null,
            repair: null,
            source: 'text-layer',
            paragraph: null,
            docxNumbering: null,
            cell: null,
          },
        ],
      },
    ],
  });

  it('passes a well-formed raw document and rejects each broken fact', () => {
    expect(rawProblems(raw())).toEqual([]);
    const word = (doc: ReturnType<typeof raw>) =>
      doc.pages[0]!.words[0]! as Record<string, unknown>;
    const cases: [(doc: ReturnType<typeof raw>) => void, RegExp][] = [
      [(d) => (word(d).ocrConfidence = 90), /ocrConfidence/],
      [(d) => (word(d).paragraph = 0), /paragraph on text-layer/],
      [(d) => (word(d).source = 'scan'), /source/],
      [(d) => (d.pages[0]!.pageNo = 3), /pageNo is 3/],
      [(d) => d.pages[0]!.rules.push({ x0: 9, y0: 0, x1: 1, y1: 0 } as never), /inverted/],
    ];
    for (const [mutate, expected] of cases) {
      const doc = raw();
      mutate(doc);
      expect(rawProblems(doc).join('\n')).toMatch(expected);
    }
  });
});
