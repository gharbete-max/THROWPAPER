import { describe, expect, it } from 'vitest';
import {
  copySvg,
  copyText,
  digitalCopy,
  editWord,
  isUncertain,
  uncertainWords,
  xmlText,
  type CopyInput,
} from './copy.js';
import type { FoundLines } from './lines.js';

/** A 1000 x 1400 photograph read as three rows: a heading, a row with a column gap, and a lower row. */
const word = (text: string, x0: number, y0: number, x1: number, y1: number, confidence = 95) => ({
  text,
  confidence,
  bbox: { x0, y0, x1, y1 },
});
const READ: CopyInput = {
  width: 1000,
  height: 1400,
  lines: [
    {
      baseline: { x0: 100, y0: 150, x1: 500, y1: 150 },
      rowHeight: 50,
      words: [word('Invoice', 100, 110, 300, 155), word('2026-14', 320, 110, 500, 155)],
    },
    {
      baseline: { x0: 100, y0: 300, x1: 900, y1: 300 },
      rowHeight: 30,
      words: [
        word('Qty', 100, 275, 160, 305),
        word('  ', 170, 275, 180, 305),
        word('Pris', 700, 275, 790, 305, 40),
      ],
    },
    {
      baseline: { x0: 100, y0: 700, x1: 400, y1: 700 },
      rowHeight: 30,
      words: [word('Tack', 100, 675, 200, 705)],
    },
  ],
};

describe('digitalCopy', () => {
  const copy = digitalCopy(READ, null);

  it('is as wide as A4 and as tall as the photograph is', () => {
    expect(copy.widthPt).toBe(595);
    expect(copy.heightPt).toBe(833);
  });

  it('holds every word the reader read, as read, in reading order', () => {
    expect(copy.words.map((w) => w.text)).toEqual(['Invoice', '2026-14', 'Qty', 'Pris', 'Tack']);
    expect(copy.words.map((w) => w.row)).toEqual([0, 0, 1, 1, 2]);
  });

  it('puts a word where the photograph had it, on its baseline, at its width', () => {
    const first = copy.words[0]!;
    expect(first.x).toBeCloseTo(59.5, 1);
    expect(first.y).toBeCloseTo(89.25, 1);
    expect(first.w).toBeCloseTo(119, 1);
    expect(first.size).toBeCloseTo(26.78, 1);
  });

  it('marks the words it was unsure of, and only those', () => {
    expect(uncertainWords(copy)).toEqual([3]);
    expect(isUncertain(copy.words[3]!)).toBe(true);
  });

  it('sets a tilted line of text on its slanted baseline', () => {
    const tilted = digitalCopy(
      {
        width: 1000,
        height: 1000,
        lines: [
          {
            baseline: { x0: 0, y0: 100, x1: 1000, y1: 200 },
            rowHeight: 20,
            words: [word('a', 0, 80, 20, 100), word('b', 900, 180, 920, 200)],
          },
        ],
      },
      null,
    );
    expect(tilted.words[1]!.y - tilted.words[0]!.y).toBeCloseTo(((910 - 10) * 0.1 + 0) * 0.595, 0);
  });

  it('takes the sheet’s turn out of the words and the lines together', () => {
    const found: FoundLines = {
      width: 1000,
      height: 1400,
      skew: 100,
      lines: [{ dir: 'h', at: 700, from: 100, to: 900, thick: 2 }],
    };
    const straight = digitalCopy(READ, found);
    // A point left of the middle moves up, one to the right moves down, by the slope.
    const plain = digitalCopy(READ, null);
    expect(straight.words[0]!.y).toBeGreaterThan(plain.words[0]!.y);
    expect(straight.lines).toEqual([{ x1: 59.5, y1: 416.5, x2: 535.5, y2: 416.5, width: 1.19 }]);
  });
});

describe('editing a word', () => {
  const copy = digitalCopy(READ, null);

  it('changes that word only, makes it certain and says it is the person’s', () => {
    const changed = editWord(copy, 3, 'Pri5');
    expect(changed.words[3]).toMatchObject({ text: 'Pri5', confidence: 100, edited: true });
    expect(changed.words.filter((_, i) => i !== 3)).toEqual(copy.words.filter((_, i) => i !== 3));
    expect(copy.words[3]!.text).toBe('Pris');
    expect(uncertainWords(changed)).toEqual([]);
  });

  it('ignores an empty word or an unchanged one', () => {
    expect(editWord(copy, 3, '  ')).toBe(copy);
    expect(editWord(copy, 3, 'Pris')).toBe(copy);
    expect(editWord(copy, 99, 'x')).toBe(copy);
  });
});

describe('the outputs', () => {
  const copy = digitalCopy(READ, null);

  it('plain text: a row to a line, a tab across a column gap, a blank line at a paragraph', () => {
    expect(copyText(copy)).toBe('Invoice 2026-14\n\nQty\tPris\n\nTack');
  });

  it('SVG: every word as text, in order, and well-formed', () => {
    const svg = copySvg(
      { ...copy, words: [...copy.words, { ...copy.words[0]!, text: 'A & B <c> "d"', row: 3 }] },
      { ink: 'rgb(0, 0, 0)', paper: 'rgb(255, 255, 255)', font: 'Helvetica, sans-serif' },
    );
    const texts = [...svg.matchAll(/<text [^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);
    expect(texts).toEqual([
      'Invoice',
      '2026-14',
      'Qty',
      'Pris',
      'Tack',
      'A &amp; B &lt;c&gt; &quot;d&quot;',
    ]);
    expect(svg).toContain('viewBox="0 0 595 833"');
    expect(svg.startsWith('<?xml')).toBe(true);
  });

  it('xml text drops characters an XML file cannot hold', () => {
    expect(xmlText('a\u0000b\u000Cc')).toBe('abc');
  });
});
