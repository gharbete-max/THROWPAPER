/**
 * Synthetic pages for the line finder's tests: drawn pixel by pixel, with the lines they hold
 * known exactly, text-like clutter between them, a turn of the sheet and speckle. Written for this
 * repository; a test that wants real glyphs draws them in a browser (`e2e/digital-copy.spec.ts`).
 */
import type { Bitmap, RuledLine } from './lines.js';

/** A small seeded generator, so a fixture is the same picture on every machine. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Page {
  bitmap: Bitmap;
  /** The lines drawn, in the picture before any turn. */
  truth: RuledLine[];
}

export class Canvas {
  readonly ink: Uint8Array;
  readonly truth: RuledLine[] = [];
  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.ink = new Uint8Array(width * height);
  }

  rect(x0: number, y0: number, x1: number, y1: number) {
    for (let y = Math.max(0, y0); y <= Math.min(this.height - 1, y1); y += 1) {
      for (let x = Math.max(0, x0); x <= Math.min(this.width - 1, x1); x += 1) {
        this.ink[y * this.width + x] = 1;
      }
    }
  }

  /** A ruled line: drawn, and written down as drawn. */
  h(y: number, x0: number, x1: number, thick = 2) {
    this.rect(x0, y, x1, y + thick - 1);
    this.truth.push({ dir: 'h', at: y + Math.floor((thick - 1) / 2), from: x0, to: x1, thick });
  }

  v(x: number, y0: number, y1: number, thick = 2) {
    this.rect(x, y0, x + thick - 1, y1);
    this.truth.push({ dir: 'v', at: x + Math.floor((thick - 1) / 2), from: y0, to: y1, thick });
  }

  box(x0: number, y0: number, x1: number, y1: number, thick = 2) {
    this.h(y0, x0, x1, thick);
    this.h(y1 - thick + 1, x0, x1, thick);
    this.v(x0, y0, y1, thick);
    this.v(x1 - thick + 1, y0, y1, thick);
  }

  /**
   * A line of text-like clutter: glyphs 8 px wide and `height` tall, a stem or two, bars at the top,
   * middle or foot, one pixel apart (so a word is a dense row), words eight pixels apart.
   */
  text(x: number, baseline: number, length: number, rand: () => number, height = 14) {
    let cursor = x;
    const end = x + length;
    while (cursor + 8 < end) {
      const letters = 3 + Math.floor(rand() * 6);
      for (let i = 0; i < letters && cursor + 8 < end; i += 1) {
        const top = baseline - height;
        this.rect(cursor, top, cursor + 1, baseline);
        if (rand() < 0.6) this.rect(cursor + 6, top, cursor + 7, baseline);
        if (rand() < 0.7) this.rect(cursor, top, cursor + 7, top + 1);
        if (rand() < 0.5) this.rect(cursor, top + 6, cursor + 7, top + 7);
        if (rand() < 0.3) this.rect(cursor, baseline - 1, cursor + 7, baseline);
        cursor += 9;
      }
      cursor += 8;
    }
  }

  /** Isolated specks, as a photograph has. */
  speckle(rand: () => number, share: number) {
    for (let i = 0; i < this.ink.length; i += 1) if (rand() < share) this.ink[i] = 1;
  }

  /** The sheet turned by `skew` ten-thousandths about its middle, as `straighten` would undo. */
  turned(skew: number): Bitmap {
    const out = new Uint8Array(this.ink.length);
    for (let y = 0; y < this.height; y += 1) {
      for (let x = 0; x < this.width; x += 1) {
        const sx = Math.round(x + ((y - this.height / 2) * skew) / 10000);
        const sy = Math.round(y - ((x - this.width / 2) * skew) / 10000);
        if (sx >= 0 && sx < this.width && sy >= 0 && sy < this.height) {
          out[y * this.width + x] = this.ink[sy * this.width + sx]!;
        }
      }
    }
    return { width: this.width, height: this.height, ink: out };
  }
}

export const W = 1200;
export const H = 1600;

/** A table: a box, four columns, six rows, text in every cell. */
export function ruledTable(rand: () => number): Canvas {
  const c = new Canvas(W, H);
  c.text(100, 100, 600, rand, 22);
  const x = [100, 400, 650, 900, 1100];
  const y = [200, 300, 400, 500, 600, 700, 800];
  c.box(x[0]!, y[0]!, x[4]!, y[6]!, 3);
  for (const column of x.slice(1, 4)) c.v(column, y[0]!, y[6]!, 2);
  for (const row of y.slice(1, 6)) c.h(row, x[0]!, x[4]!, 2);
  for (let r = 0; r < 6; r += 1) {
    for (let k = 0; k < 4; k += 1) {
      c.text(x[k]! + 14, y[r]! + 55, x[k + 1]! - x[k]! - 28, rand);
    }
  }
  c.text(100, 900, 900, rand);
  c.text(100, 940, 700, rand);
  return c;
}

/** A form: labels with a line to write on, and two boxes for longer answers. */
export function linedForm(rand: () => number): Canvas {
  const c = new Canvas(W, H);
  c.text(100, 120, 500, rand, 28);
  for (let i = 0; i < 8; i += 1) {
    const y = 250 + i * 90;
    c.text(100, y, 240, rand);
    c.h(y + 6, 360, 1100, 1);
  }
  c.text(100, 1000, 300, rand);
  c.box(100, 1030, 1100, 1250, 2);
  c.text(100, 1330, 300, rand);
  c.box(100, 1360, 1100, 1500, 2);
  return c;
}

/** An invoice: a header box, an items table with no side borders, and a totals box. */
export function invoiceBoxes(rand: () => number): Canvas {
  const c = new Canvas(W, H);
  c.box(80, 80, 1120, 300, 2);
  c.text(100, 140, 400, rand, 30);
  c.text(100, 200, 300, rand);
  c.text(100, 240, 300, rand);
  c.v(700, 80, 300, 2);
  c.text(720, 140, 300, rand);
  c.text(720, 200, 300, rand);
  c.h(380, 80, 1120, 3);
  for (let i = 0; i < 8; i += 1) {
    c.text(100, 440 + i * 60, 760, rand);
    c.text(900, 440 + i * 60, 180, rand);
    c.h(452 + i * 60, 80, 1120, 1);
  }
  c.box(700, 960, 1120, 1120, 2);
  c.h(1040, 700, 1120, 2);
  c.text(720, 1010, 200, rand);
  c.text(720, 1090, 200, rand);
  return c;
}
