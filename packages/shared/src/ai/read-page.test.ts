import { describe, expect, it } from 'vitest';
import {
  MODEL_PAGE_SCHEMA,
  PIXEL_BUDGET,
  assembleDocument,
  crossCheck,
  documentText,
  pageFromModel,
  pageText,
  longEdgeFor,
  pictureSize,
  renumber,
} from './read-page.js';

const SHA = 'a'.repeat(64);
const answer = (blocks: unknown[], language = 'sv') => JSON.stringify({ language, blocks });

describe('a page from what the model said', () => {
  it('becomes blocks on its page, with the language and no invented box', () => {
    const page = pageFromModel(
      2,
      answer([
        { type: 'heading', level: 1, text: ' Faktura ' },
        { type: 'paragraph', text: 'Betala senast 2026-11-30.' },
        { type: 'field', label: 'Belopp', value: '1 250,00 kr' },
        { type: 'checkbox', label: 'Betald', checked: false },
        {
          type: 'table',
          cells: [
            { row: 0, column: 0, text: 'A' },
            { row: 1, column: 1, text: 'B' },
          ],
        },
        { type: 'figure' },
      ]),
    );
    expect(page.status).toBe('ok');
    expect(page.blocks.map((b) => b.type)).toEqual([
      'heading',
      'paragraph',
      'field',
      'checkbox',
      'table',
      'figure',
    ]);
    expect(page.blocks.every((b) => b.page === 2 && b.box === null && b.language === 'sv')).toBe(
      true,
    );
    expect(pageText(page)).toContain('Belopp: 1 250,00 kr');
    expect(pageText(page)).toContain(' | B');
  });

  it('puts tables that follow one another back together, whichever way the rows are counted', () => {
    const row = (r: number, a: string, b: string) => ({
      type: 'table',
      cells: [
        { row: r, column: 0, text: a },
        { row: r, column: 1, text: b },
      ],
    });
    for (const rows of [
      [row(0, 'Region', 'Q1'), row(1, 'Norr', '120'), row(2, 'Syd', '310')],
      [row(0, 'Region', 'Q1'), row(0, 'Norr', '120'), row(0, 'Syd', '310')],
    ]) {
      const page = pageFromModel(1, answer([{ type: 'heading', level: 1, text: 'T' }, ...rows]));
      expect(page.blocks.map((b) => b.type)).toEqual(['heading', 'table']);
      expect(pageText(page)).toBe('T\nRegion | Q1\nNorr | 120\nSyd | 310');
    }
  });

  it('drops empty and unknown blocks and keeps the rest', () => {
    const page = pageFromModel(
      1,
      answer([
        { type: 'paragraph', text: '  ' },
        { type: 'nope' },
        { type: 'paragraph', text: 'ok' },
      ]),
    );
    expect(page.blocks).toHaveLength(1);
  });

  it.each(['not json', '[]', 'null', '{"x":1'])(
    'lists %j as a failed page, never drops it',
    (text) => {
      expect(pageFromModel(3, text)).toMatchObject({
        page: 3,
        status: 'failed',
        reason: 'unreadable-output',
        blocks: [],
      });
    },
  );

  it('keeps the finished blocks of an answer that ran out of room, and says so', () => {
    const cut =
      '{"language":"en","blocks":[{"type":"paragraph","text":"one"},{"type":"paragraph","text":"tw';
    const page = pageFromModel(1, cut);
    expect(page).toMatchObject({ status: 'uncertain', reason: 'cut-off' });
    expect(page.blocks).toHaveLength(1);
  });

  it('is described to the model by a schema whose block types are the six', () => {
    expect(MODEL_PAGE_SCHEMA.properties.blocks.items.properties.type.enum).toHaveLength(6);
  });
});

const LAYER =
  'Invoice number 20260412 date 2026-10-01 due 2026-10-31 total 1250 kr bank giro 5555 1234 reference 99887766 customer Demo AB thank you for your business';

describe('the cross-check against the PDF text layer', () => {
  const page = (text: string) => pageFromModel(1, answer([{ type: 'paragraph', text }], 'en'));

  it('agrees with the same words and records how well', () => {
    const checked = crossCheck(page(LAYER), LAYER);
    expect(checked.status).toBe('ok');
    expect(checked.blocks[0]!.confidence).toBe(1);
  });

  it('marks a page uncertain when the words differ a lot', () => {
    const other = 'Something else entirely written here that shares nothing with it at all today';
    expect(crossCheck(page(other), LAYER)).toMatchObject({
      status: 'uncertain',
      reason: 'mismatch',
    });
  });

  it('marks a page uncertain when the numbers differ though the words agree', () => {
    const wrong = LAYER.replace(/\d+/g, (n) => String(Number(n) + 1));
    expect(crossCheck(page(wrong), LAYER)).toMatchObject({
      status: 'uncertain',
      reason: 'mismatch',
    });
  });

  it('does not judge by a layer too short to judge by, or a failed page', () => {
    const short = page('hello');
    expect(crossCheck(short, 'a few words')).toBe(short);
    const failed = pageFromModel(1, 'x');
    expect(crossCheck(failed, LAYER)).toBe(failed);
  });
});

describe('the document', () => {
  it('lists a page nobody read as failed, in order from 1', () => {
    const doc = assembleDocument(
      SHA,
      3,
      new Map([[2, pageFromModel(2, answer([{ type: 'paragraph', text: 'two' }]))]]),
    );
    expect(doc.pages.map((p) => [p.page, p.status])).toEqual([
      [1, 'failed'],
      [2, 'ok'],
      [3, 'failed'],
    ]);
    expect(doc.pages[0]!.reason).toBe('not-read');
  });

  it('is read out as text with where each page stands', () => {
    const doc = assembleDocument(
      SHA,
      2,
      new Map([
        [1, pageFromModel(1, answer([{ type: 'paragraph', text: 'first' }]))],
        [2, pageFromModel(2, answer([{ type: 'paragraph', text: 'second' }]))],
      ]),
    );
    const { text, pages } = documentText(doc, (n) => `Page ${n}`);
    expect(text).toBe('Page 1\nfirst\n\nPage 2\nsecond');
    expect(text.slice(pages[1]!.start, pages[1]!.end)).toBe('second');
  });
});

describe('the size a page is drawn at', () => {
  it('fills the budget for a PDF page, which has a shape and no pixels', () => {
    const edge = longEdgeFor(595, 842, 'normal');
    expect(edge * Math.round((edge * 595) / 842)).toBeLessThanOrEqual(PIXEL_BUDGET.normal * 1.01);
    expect(edge * Math.round((edge * 595) / 842)).toBeGreaterThan(PIXEL_BUDGET.normal * 0.97);
    expect(longEdgeFor(595, 842, 'high')).toBeGreaterThan(edge);
    expect(longEdgeFor(100, 5000, 'high')).toBeLessThanOrEqual(2400);
  });

  it('moves a read page to its place in the document', () => {
    const page = renumber(pageFromModel(1, answer([{ type: 'paragraph', text: 'x' }])), 7);
    expect(page.page).toBe(7);
    expect(page.blocks[0]!.page).toBe(7);
  });

  it('holds an A4 page within the budget and never enlarges a small one', () => {
    const big = pictureSize(595, 842, 'normal');
    expect(big.width * big.height).toBeLessThanOrEqual(PIXEL_BUDGET.normal * 1.01);
    expect(pictureSize(300, 200, 'normal')).toEqual({ width: 300, height: 200 });
    const high = pictureSize(5000, 7000, 'high');
    expect(high.width * high.height).toBeLessThanOrEqual(PIXEL_BUDGET.high * 1.01);
  });
});
