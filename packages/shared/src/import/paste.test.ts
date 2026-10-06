import { describe, expect, it } from 'vitest';
import { enumerate } from './enumerate/enumerate.js';
import { layoutProblems } from './ir/validate.js';
import { MAX_PASTE, pasteDocument } from './paste.js';

/**
 * Pasted text as a layout document (`LAYOUT-IR.md`, the `paste` column): valid by the same
 * validator every fixture passes, synthetic geometry exactly as specified, and read by the
 * list-number detector the way a pasted document is.
 */

const lines = (text: string) =>
  pasteDocument(text).pages.flatMap((p) => p.blocks.flatMap((b) => b.lines));

describe('a paste', () => {
  it.each([
    ['one line', 'Röd'],
    ['a numbered list', '1. Röd\n2. Grön\n3. Blå'],
    ['a bulleted list, indented', '  • Red\n  • Green\n\t• Blue'],
    ['blank lines between blocks, and Windows line ends', 'Namn:\r\n\r\nE-post: ______\r\n'],
    ['tabs inside a line', 'Ja\tNej\tVet ej'],
    ['a line far longer than the page', 'ord '.repeat(400)],
    [
      'more lines than a page holds',
      Array.from({ length: 100 }, (_, i) => `${i + 1}. Rad`).join('\n'),
    ],
    ['text written without spaces', '赤\n緑\n青'],
  ])('is a valid layout document: %s', (_what, text) => {
    expect(layoutProblems(pasteDocument(text))).toEqual([]);
  });

  it('puts each line where the synthetic geometry says, indent and tab stops included', () => {
    const [first, second] = lines('Röd\n  Grön\tBlå');
    expect(first).toMatchObject({
      text: 'Röd',
      baseline: 1000,
      box: { x0: 1000, y0: 895, x1: 1276, y1: 1026 },
      source: 'paste',
    });
    // Two leading spaces: 1000 + 2 × 92. The tab after "Grön" (at 1552) goes to 1184 + 2 × 368.
    expect(second).toMatchObject({ text: 'Grön Blå', baseline: 1180, box: { x0: 1184 } });
    expect(second?.words.map((w) => w.box.x0)).toEqual([1184, 1920]);
  });

  it('starts a block after a blank line, and a page after the forty-fifth line', () => {
    const doc = pasteDocument('a\nb\n\nc');
    expect(doc.pages[0]?.blocks.map((b) => b.lines.map((l) => l.text))).toEqual([
      ['a', 'b'],
      ['c'],
    ]);
    const long = pasteDocument(Array.from({ length: 46 }, (_, i) => `rad ${i}`).join('\n'));
    expect(long.pages.map((p) => p.blocks[0]?.lines.length)).toEqual([45, 1]);
    expect(pasteDocument('\n \n\t\n').pages).toEqual([]);
  });

  it('knows only what text can say: blanks, boxes and a closing colon — never a rule below', () => {
    const [blank, boxes, colon, leader] = lines('Namn ______\n☐ Ja ☐ Nej\nE-post:\nOrt ....');
    expect(blank?.hints).toMatchObject({ blankRun: true, ruleBelow: false });
    expect(boxes?.hints.checkboxes).toBe(2);
    expect(colon?.hints.endsWithColon).toBe(true);
    expect(leader?.hints.blankRun).toBe(true);
  });

  it('refuses more than a paste may hold', () => {
    expect(() => pasteDocument('x'.repeat(MAX_PASTE + 1))).toThrow(RangeError);
  });
});

describe('the list-number detector, on a paste', () => {
  it('reads a numbered list and a bulleted one, labels verbatim', () => {
    const numbered = enumerate(pasteDocument('1. Röd\n2. Grön\n3. Blå – mörk')).output.items;
    expect(numbered.map((item) => [item.marker.raw, item.label, item.verdict])).toEqual([
      ['1.', 'Röd', 'accept'],
      ['2.', 'Grön', 'accept'],
      ['3.', 'Blå – mörk', 'accept'],
    ]);
    const bullets = enumerate(pasteDocument('• Red\n• Green')).output.items;
    expect(bullets.map((item) => item.label)).toEqual(['Red', 'Green']);
  });

  it('reads the same list the same way twice', () => {
    const text = 'a) Ja\nb) Nej\nc) Vet ej';
    expect(JSON.stringify(enumerate(pasteDocument(text)))).toBe(
      JSON.stringify(enumerate(pasteDocument(text))),
    );
  });
});
