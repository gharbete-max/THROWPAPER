import { describe, expect, it } from 'vitest';
import { binarise, estimateSkew, findLines, type RuledLine } from './lines.js';
import { Canvas, invoiceBoxes, linedForm, ruledTable, seeded } from './fixtures.js';

/** A detected line is a truth line when it lies on it (3 px) and covers 70 % of their union. */
function matches(found: RuledLine, truth: RuledLine): boolean {
  if (found.dir !== truth.dir || Math.abs(found.at - truth.at) > 3) return false;
  const overlap = Math.min(found.to, truth.to) - Math.max(found.from, truth.from);
  const union = Math.max(found.to, truth.to) - Math.min(found.from, truth.from);
  return overlap > 0 && overlap * 10 >= union * 7;
}

function score(found: RuledLine[], truth: RuledLine[]) {
  const hit = truth.filter((t) => found.some((f) => matches(f, t))).length;
  const right = found.filter((f) => truth.some((t) => matches(f, t))).length;
  return { hit, right, recall: hit / truth.length, precision: right / found.length };
}

const PAGES = {
  'a ruled table with text': ruledTable,
  'a lined form': linedForm,
  'an invoice-like box layout': invoiceBoxes,
};

describe('the line finder', () => {
  const totals = { hit: 0, truth: 0, right: 0, found: 0 };

  describe.each(Object.entries(PAGES))('on %s', (_name, draw) => {
    for (const [turn, skew] of [
      ['upright', 0],
      ['turned 0.6 degrees', 105],
    ] as const) {
      it(`finds the known lines, ${turn}, among speckle and text`, () => {
        const rand = seeded(7);
        const page = draw(rand);
        page.speckle(rand, 0.002);
        const found = findLines(page.turned(skew));
        const s = score(found.lines, page.truth);
        totals.hit += s.hit;
        totals.truth += page.truth.length;
        totals.right += s.right;
        totals.found += found.lines.length;
        expect(s.recall, 'recall').toBeGreaterThanOrEqual(0.95);
        expect(s.precision, 'precision').toBeGreaterThanOrEqual(0.95);
        if (skew) expect(Math.abs(found.skew - skew)).toBeLessThanOrEqual(15);
        else expect(found.skew).toBe(0);
      });
    }
  });

  it('reports the measured precision and recall over every page above', () => {
    const recall = totals.hit / totals.truth;
    const precision = totals.right / totals.found;
    console.log(
      `line finder: recall ${(recall * 100).toFixed(1)} %, precision ${(precision * 100).toFixed(1)} % over ${totals.truth} known lines, ${totals.found} found`,
    );
    expect(recall).toBeGreaterThan(0.95);
    expect(precision).toBeGreaterThan(0.95);
  });

  it('finds nothing on a page of text alone', () => {
    const rand = seeded(3);
    const page = new Canvas(1200, 1600);
    for (let i = 0; i < 30; i += 1) page.text(100, 150 + i * 40, 1000, rand);
    expect(findLines(page.turned(0)).lines).toEqual([]);
  });

  it('joins a dashed rule into one line, and ignores a block of ink', () => {
    const page = new Canvas(1200, 1600);
    for (let x = 100; x < 1000; x += 120) page.rect(x, 300, x + 100, 301);
    page.rect(100, 600, 1000, 640);
    const { lines } = findLines({ width: 1200, height: 1600, ink: page.ink });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ dir: 'h' });
    expect(Math.abs(lines[0]!.at - 300)).toBeLessThanOrEqual(1);
    expect(lines[0]!.from).toBeLessThanOrEqual(101);
    expect(lines[0]!.to).toBeGreaterThanOrEqual(979);
  });

  it('is deterministic: the same pixels give the same lines', () => {
    const make = () => {
      const rand = seeded(11);
      const page = ruledTable(rand);
      page.speckle(rand, 0.002);
      return findLines(page.turned(60));
    };
    expect(make()).toEqual(make());
  });

  it('takes no skew out of a blank page', () => {
    expect(estimateSkew({ width: 300, height: 300, ink: new Uint8Array(90000) })).toBe(0);
  });
});

describe('binarise', () => {
  /** A grey picture with a shadow across it, a dark rule and a pale rule. */
  const width = 400;
  const height = 300;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const paper = 255 - Math.floor((x * 60) / width); // a shadow from left to right
      let value = paper;
      if (y === 100) value = 20;
      if (y === 200) value = paper - 70;
      rgba.set([value, value, value, 255], (y * width + x) * 4);
    }
  }
  const { ink } = binarise(rgba, width, height);

  it('keeps a dark rule and a pale one, and drops the shadow', () => {
    const inRow = (y: number) => ink.slice(y * width, (y + 1) * width).reduce((a, b) => a + b, 0);
    expect(inRow(100)).toBeGreaterThan(width * 0.95);
    expect(inRow(200)).toBeGreaterThan(width * 0.95);
    expect(inRow(50)).toBe(0);
    expect(inRow(250)).toBe(0);
  });
});
