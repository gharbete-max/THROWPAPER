import { describe, expect, it } from 'vitest';
import type { RawDocument, RawWord } from './ir/types.js';
import { layoutProblems } from './ir/validate.js';
import { reassemble } from './layout/reassemble.js';
import { readLayout } from './pipeline.js';

/**
 * `CAVEATS.md` #42, `perf-budget`: twenty pages read in under four seconds. Twenty dense pages —
 * two columns of forty-five lines, a numbered list with sub-items down each, a running header and a
 * page number — go through stages 2 to 7, as the worker runs them, well inside it. The clock is
 * only in this test; the stages have none.
 */

const PAGES = 20;
const BUDGET_MS = 4000;

function word(text: string, x0: number, baseline: number): RawWord {
  return {
    text,
    box: { x0, y0: baseline - 105, x1: x0 + 92 * [...text].length, y1: baseline + 26 },
    baseline,
    fontSize: 131,
    fontWeight: 400,
    italic: false,
    ocrConfidence: null,
    repair: null,
    source: 'text-layer',
    paragraph: null,
    docxNumbering: null,
    cell: null,
  };
}

function line(text: string, x0: number, baseline: number): RawWord[] {
  let x = x0;
  return text.split(' ').map((piece) => {
    const placed = word(piece, x, baseline);
    x += 92 * ([...piece].length + 1);
    return placed;
  });
}

function densePage(pageNo: number): RawWord[] {
  const words = [
    ...line('Föreningen Exempel · Anmälan', 1000, 500),
    ...line(`Sida ${pageNo} av ${PAGES}`, 1000, 9500),
  ];
  let item = 0; // each page its own list: a number above 199 is never a marker (V4)
  for (const x0 of [1000, 5200]) {
    for (let row = 0; row < 45; row += 1) {
      const baseline = 1000 + row * 180;
      if (row % 3 === 2) words.push(...line(`${item}.1 Namn och adress`, x0 + 368, baseline));
      else words.push(...line(`${(item += 1)}. Fråga om något med ord`, x0, baseline));
    }
  }
  return words;
}

const document: RawDocument = {
  irVersion: 1,
  source: { kind: 'pdf', extractor: 'budget test', sha256: null },
  pages: Array.from({ length: PAGES }, (_, i) => ({
    pageNo: i + 1,
    widthPt: 595,
    heightPt: 842,
    words: densePage(i + 1),
    rules: [],
  })),
};

describe('the import budget', () => {
  it(`reads ${PAGES} dense pages through stages 2 to 7 in under ${BUDGET_MS / 1000} s`, () => {
    const words = document.pages.reduce((n, page) => n + page.words.length, 0);
    expect(words).toBeGreaterThan(9000);
    const start = performance.now();
    const layout = reassemble(document).output;
    const read = readLayout(layout);
    const elapsed = performance.now() - start;
    expect(layoutProblems(layout)).toEqual([]);
    expect(read.lists.items.length).toBe(PAGES * 90);
    expect(read.scored.counts.questions).toBeGreaterThanOrEqual(PAGES * 60);
    expect(elapsed).toBeLessThan(BUDGET_MS);
    console.log(
      `import budget: ${PAGES} pages, ${words} words, stages 2–7 in ${Math.round(elapsed)} ms`,
    );
  });
});
