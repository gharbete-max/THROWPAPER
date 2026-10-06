import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { labelNear } from './extract.js';
import { tessLangs, toRuns } from './ocr.js';
import { BOX, boxShaped, ocrWords, photoDocument, type RecognisedWords } from './ocr-words.js';

describe('reading a photographed page', () => {
  it('turns recognised lines into page fractions the label finder reads', () => {
    const runs = toRuns({
      width: 1200,
      height: 1600,
      lines: [
        { text: 'Full name\n', bbox: { x0: 100, y0: 128, x1: 220, y1: 152 } },
        { text: '   ', bbox: { x0: 0, y0: 0, x1: 10, y1: 10 } },
        { text: 'Member?', bbox: { x0: 100, y0: 208, x1: 210, y1: 232 } },
      ],
    });
    expect(runs).toEqual([
      { text: 'Full name', x: 100 / 1200, y: 0.08, w: 0.1, h: 0.015 },
      { text: 'Member?', x: 100 / 1200, y: 0.13, w: 110 / 1200, h: 0.015 },
    ]);
    // A box drawn to the right of "Member?" is offered exactly those words.
    expect(labelNear({ x: 0.2, y: 0.125, w: 0.3, h: 0.025 }, runs)).toBe('Member?');
  });

  it('reads English alongside the interface language, and English alone for the rest', () => {
    expect(tessLangs('sv-SE')).toEqual(['eng', 'swe']);
    expect(tessLangs('zh-CN')).toEqual(['eng', 'chi_sim']);
    expect(tessLangs('en-GB')).toEqual(['eng']);
    expect(tessLangs('pt-BR')).toEqual(['eng']);
  });
});

/** S14 (`docs/plan/SCANS.md`): a page read word by word, as stage 1's words. */
describe('words read by OCR', () => {
  const page = {
    width: 2000,
    height: 1000,
    engine: 'Tesseract 5.5.0',
    lines: [
      {
        // Tilted: down 10 px across 1000.
        baseline: { x0: 100, y0: 200, x1: 1100, y1: 210 },
        rowHeight: 40,
        words: [
          { text: 'Namn:', confidence: 91.6, bbox: { x0: 100, y0: 165, x1: 300, y1: 205 } },
          { text: '  ', confidence: 95, bbox: { x0: 300, y0: 165, x1: 320, y1: 205 } },
          { text: '____', confidence: -1, bbox: { x0: 400, y0: 190, x1: 1100, y1: 212 } },
        ],
      },
    ],
  };

  it('puts each word in the IR’s units, on its line’s baseline, with its confidence as an integer', () => {
    expect(ocrWords(page)).toEqual([
      {
        text: 'Namn:',
        box: { x0: 500, y0: 1650, x1: 1500, y1: 2050 },
        // Under the word's middle, x = 200: 200 + 0.01 × 100 = 201 px.
        baseline: 2010,
        fontSize: 400,
        fontWeight: 400,
        italic: false,
        ocrConfidence: 92,
        repair: null,
        source: 'ocr',
        paragraph: null,
        docxNumbering: null,
        cell: null,
      },
      {
        text: '____',
        box: { x0: 2000, y0: 1900, x1: 5500, y1: 2120 },
        // x = 750: 200 + 0.01 × 650 = 206.5 px.
        baseline: 2065,
        fontSize: 400,
        fontWeight: 400,
        italic: false,
        // Tesseract's −1, "no confidence", is the least sure there is.
        ocrConfidence: 0,
        repair: null,
        source: 'ocr',
        paragraph: null,
        docxNumbering: null,
        cell: null,
      },
    ]);
  });

  it('reads a level line with no slope, and nothing from a page with no words', () => {
    const level = {
      ...page,
      lines: [{ ...page.lines[0]!, baseline: { x0: 100, y0: 200, x1: 100, y1: 200 } }],
    };
    expect(ocrWords(level).map((word) => word.baseline)).toEqual([2000, 2000]);
    expect(ocrWords({ width: 10, height: 10, engine: 'Tesseract 5.5.0', lines: [] })).toEqual([]);
  });
});

/**
 * B1, a printed box (`SCANS.md`): Tesseract has no box among its characters, so a box on paper comes
 * back as "[" or "0". Recorded from the corpus's own scans (`fixtures/ocr/box-marks.json`, read by
 * `tesseract.js` from the pictures `pnpm corpus:scan` drew), so the rule is held to what Tesseract
 * really gives.
 */
describe('a printed box read by OCR (B1)', () => {
  type Line = RecognisedWords['lines'][number] & { text: string };
  type Recorded = {
    pages: Array<Omit<RecognisedWords, 'lines'> & { from: string; lines: Line[] }>;
  };
  const recorded = JSON.parse(
    readFileSync(new URL('../../../../../../fixtures/ocr/box-marks.json', import.meta.url), 'utf8'),
  ) as Recorded;
  /** The recorded lines that match, on the page they were read from. */
  const page = (
    from: RegExp,
    match: RegExp,
  ): Omit<RecognisedWords, 'lines'> & { lines: Line[] } => {
    const one = recorded.pages.find((candidate) => from.test(candidate.from))!;
    return { ...one, lines: one.lines.filter((line) => match.test(line.text)) };
  };
  const texts = (result: RecognisedWords) => ocrWords(result).map((word) => word.text);

  it('is a box when it was read stuck to the next word, or alone', () => {
    const words = ocrWords(page(/medlemsansokan/, /nyhetsbrev/));
    expect(words.map((word) => word.text).slice(-4)).toEqual([BOX, 'Ja', BOX, 'Nej']);
    expect(words.slice(-4).map((word) => word.repair)).toEqual([
      { kind: 'box-mark', raw: '[' },
      null,
      { kind: 'box-mark', raw: '[' },
      null,
    ]);
    // Split at the box's own character: "Ja" starts where its J does, the box ends before it.
    const [box, ja] = words.slice(-4);
    expect(box!.box.x1).toBeLessThan(ja!.box.x0);
  });

  it('is a box when it was read as a zero', () => {
    const lines = page(/fotosamtycke\.png/, /samtycker/);
    expect(lines.lines).toHaveLength(2);
    const words = ocrWords(lines);
    const first = words.filter((word) => word.text === BOX);
    expect(first).toHaveLength(2);
    expect(first.every((word) => word.repair?.raw === '0')).toBe(true);
    expect(texts(lines).filter((text) => text === '0')).toEqual([]);
  });

  it('is one box when its two sides were read as two characters', () => {
    // The scanned PDF, drawn larger: one box came back "[J", its right side the J.
    const lines = page(/fotosamtycke\.pdf/, /samtycker/);
    expect(lines.lines.map((line) => line.text.split(' ')[0])).toEqual(['0', '[J']);
    const words = ocrWords(lines);
    expect(words.filter((word) => word.repair).map((word) => word.repair!.raw)).toEqual([
      '0',
      '[J',
    ]);
    expect(texts({ ...lines, lines: [lines.lines[1]!] }).slice(0, 3)).toEqual([
      BOX,
      'Jag',
      'samtycker',
    ]);
  });

  // #160: the German scan's consent box came back as the two letters "DO", square and unsure.
  it('is a box when its sides were read as the letters D and O, in a square', () => {
    const lines = page(/erste-hilfe/, /einverstanden/);
    expect(lines.lines.map((line) => line.text.split(' ')[0])).toEqual(['DO']);
    const words = ocrWords(lines);
    expect(words[0]).toMatchObject({ text: BOX, repair: { kind: 'box-mark', raw: 'DO' } });
    expect(words[1]!.text).toBe('Ich');
    // "DO" as a word is wider than it is tall: in a line of capitals it stays itself.
    const word = lines.lines[0]!.words[0]!;
    const wide = { ...word.bbox, x1: word.bbox.x0 + (word.bbox.y1 - word.bbox.y0) * 2 };
    const capitals = { ...lines.lines[0]!, words: [{ ...word, bbox: wide }] };
    expect(texts({ ...lines, lines: [capitals] })).toEqual(['DO']);
  });

  it('leaves what is not the shape of a box', () => {
    // "1." is square, but it is two characters, and neither alone is a box.
    expect(texts(page(/medlemsansokan/, /Namn/))).toEqual(['1.', 'Namn:']);
    // A word read rightly whose first letter Tesseract boxed with the next: the "l" of "lämna"
    // came back square. A letter is never taken for a box stuck to its word.
    for (const from of [/medlemsansokan/, /fotosamtycke\.png/]) {
      const lines = page(from, /lämna/);
      const lamna = lines.lines.flatMap((line) => line.words).find((w) => w.text === 'lämna')!;
      expect(boxShaped(lamna.symbols![0]!.bbox, lines.lines[0]!.rowHeight)).toBe(true);
      expect(texts(lines)).toContain('lämna');
      expect(ocrWords(lines).filter((word) => word.repair)).toEqual([]);
    }
    const line = (word: {
      text: string;
      bbox: { x0: number; y0: number; x1: number; y1: number };
    }): RecognisedWords => ({
      width: 2000,
      height: 2000,
      engine: 'Tesseract 5.1.0',
      lines: [
        {
          baseline: { x0: 0, y0: 100, x1: 1000, y1: 100 },
          rowHeight: 30,
          words: [
            {
              ...word,
              confidence: 90,
              symbols: [...word.text].map((text, i) => ({
                text,
                bbox:
                  i === 0
                    ? { ...word.bbox, x1: word.bbox.x0 + (word.bbox.y1 - word.bbox.y0) }
                    : word.bbox,
              })),
            },
          ],
        },
      ],
    });
    // A digit zero is half as wide as it is tall; an I narrower still, and a J begins words.
    expect(texts(line({ text: '0', bbox: { x0: 0, y0: 78, x1: 12, y1: 100 } }))).toEqual(['0']);
    expect(texts(line({ text: 'I', bbox: { x0: 0, y0: 78, x1: 4, y1: 100 } }))).toEqual(['I']);
    const jag = line({ text: 'Jag', bbox: { x0: 0, y0: 78, x1: 40, y1: 104 } });
    jag.lines[0]!.words[0]!.symbols![0]!.bbox = { x0: 0, y0: 78, x1: 9, y1: 100 };
    expect(texts(jag)).toEqual(['Jag']);
    // A small o is half the line's height: under it is not a box.
    expect(texts(line({ text: 'O', bbox: { x0: 0, y0: 86, x1: 14, y1: 100 } }))).toEqual(['O']);
    // An O may begin a word; only a bracket stuck to one is taken for a box.
    expect(texts(line({ text: 'Om', bbox: { x0: 0, y0: 78, x1: 40, y1: 100 } }))).toEqual(['Om']);
    // A real bracket is narrow.
    const sic = line({ text: '[sic]', bbox: { x0: 0, y0: 76, x1: 60, y1: 104 } });
    sic.lines[0]!.words[0]!.symbols![0]!.bbox = { x0: 0, y0: 76, x1: 7, y1: 104 };
    expect(texts(sic)).toEqual(['[sic]']);
    // A box glyph Tesseract did read stays as it was read, and is split from its word.
    const glyph = line({ text: '□Ja', bbox: { x0: 0, y0: 78, x1: 60, y1: 100 } });
    expect(ocrWords(glyph).map((word) => [word.text, word.repair])).toEqual([
      ['□', null],
      ['Ja', null],
    ]);
  });

  it('is square within a fifth either way, and at least half its line high', () => {
    const box = (width: number, height: number) => ({ x0: 0, y0: 0, x1: width, y1: height });
    expect(boxShaped(box(800, 1000), 2000)).toBe(true);
    expect(boxShaped(box(799, 1000), 2000)).toBe(false);
    expect(boxShaped(box(1250, 1000), 2000)).toBe(true);
    expect(boxShaped(box(1251, 1000), 2000)).toBe(false);
    expect(boxShaped(box(1000, 1000), 2001)).toBe(false);
    expect(boxShaped(box(0, 1000), 10)).toBe(false);
  });
});

describe('a photograph as a raw document', () => {
  it('is one page, A4 wide at its own proportions, read by its engine, with no rules', () => {
    const raw = photoDocument(
      { width: 3000, height: 4000, engine: 'Tesseract 5.1.0', lines: [] },
      'ab'.repeat(32),
    );
    expect(raw).toEqual({
      irVersion: 1,
      source: { kind: 'image', extractor: 'Tesseract 5.1.0', sha256: 'ab'.repeat(32) },
      pages: [{ pageNo: 1, widthPt: 595, heightPt: 793, words: [], rules: [] }],
    });
  });
});
