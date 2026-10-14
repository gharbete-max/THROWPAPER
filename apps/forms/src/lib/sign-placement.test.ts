import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { LOCALE_CODES } from '@tp/i18n';
import { tinyPdf } from '../../../../e2e/pdf.js';
import {
  arrowDelta,
  clampToPage,
  dateSize,
  formatStampDate,
  nudge,
  onEveryPage,
  resizeDate,
  resizePicture,
  seenSize,
  toOps,
  toPdfPoint,
  toSeenPoint,
  type PageGeometry,
  type Placement,
} from './sign-placement.js';

/** A page 600 wide and 800 tall, in each of the four turns. */
const view = [0, 0, 600, 800] as const;
const turned = (rotate: number): PageGeometry => ({ view, rotate });

describe('page space and screen space', () => {
  it('knows the page as seen: sideways pages swap their sides', () => {
    expect(seenSize(turned(0))).toEqual({ width: 600, height: 800 });
    expect(seenSize(turned(90))).toEqual({ width: 800, height: 600 });
    expect(seenSize(turned(180))).toEqual({ width: 600, height: 800 });
    expect(seenSize(turned(270))).toEqual({ width: 800, height: 600 });
  });

  it('turns the top left of what is seen into the file corner that is there', () => {
    expect(toPdfPoint(turned(0), { x: 0, y: 0 })).toEqual({ x: 0, y: 800 });
    expect(toPdfPoint(turned(90), { x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
    expect(toPdfPoint(turned(180), { x: 0, y: 0 })).toEqual({ x: 600, y: 0 });
    expect(toPdfPoint(turned(270), { x: 0, y: 0 })).toEqual({ x: 600, y: 800 });
  });

  it('goes there and back again for every turn, with a box that does not start at the origin', () => {
    for (const rotate of [0, 90, 180, 270, -90, 450]) {
      const geometry: PageGeometry = { view: [10, 20, 610, 820], rotate };
      const seen = { x: 123.5, y: 45.25 };
      const back = toSeenPoint(geometry, toPdfPoint(geometry, seen));
      expect(back.x).toBeCloseTo(seen.x, 9);
      expect(back.y).toBeCloseTo(seen.y, 9);
    }
  });

  it('agrees with pdf.js for pages turned every way', async () => {
    const require = createRequire(import.meta.url);
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(
      require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs'),
    ).href;
    for (const rotate of [0, 90, 180, 270]) {
      const doc = await pdfjs.getDocument({ data: new Uint8Array(tinyPdf('x', rotate)) }).promise;
      const page = await doc.getPage(1);
      const geometry: PageGeometry = {
        view: page.view as unknown as PageGeometry['view'],
        rotate: page.rotate,
      };
      const viewport = page.getViewport({ scale: 1 });
      expect(viewport.width).toBeCloseTo(seenSize(geometry).width, 6);
      for (const seen of [
        { x: 0, y: 0 },
        { x: 100, y: 30 },
        { x: 40.5, y: 200.25 },
      ]) {
        const expected = viewport.convertToPdfPoint(seen.x, seen.y) as number[];
        const got = toPdfPoint(geometry, seen);
        expect(got.x).toBeCloseTo(expected[0]!, 6);
        expect(got.y).toBeCloseTo(expected[1]!, 6);
      }
      await doc.loadingTask.destroy();
    }
  });
});

describe('keeping a mark on the page', () => {
  const page = { width: 600, height: 800 };
  const box = { x: 0, y: 0, width: 100, height: 40 };

  it('clamps the whole box inside, not just its corner', () => {
    expect(clampToPage({ ...box, x: -20, y: -5 }, page)).toMatchObject({ x: 0, y: 0 });
    expect(clampToPage({ ...box, x: 590, y: 790 }, page)).toMatchObject({ x: 500, y: 760 });
    expect(clampToPage({ ...box, x: 12.345, y: 7.891 }, page)).toMatchObject({ x: 12.35, y: 7.89 });
  });

  it('puts a box wider than the page at its left edge rather than off it', () => {
    expect(clampToPage({ ...box, width: 900, x: 50 }, page).x).toBe(0);
  });

  it('nudges by a point, or ten with Shift, and stops at the edge', () => {
    expect(arrowDelta('ArrowLeft', false)).toEqual({ x: -1, y: 0 });
    expect(arrowDelta('ArrowDown', true)).toEqual({ x: 0, y: 10 });
    expect(arrowDelta('a', false)).toBeNull();
    const start = { ...box, x: 5, y: 5 };
    expect(nudge(start, -10, -10, page)).toMatchObject({ x: 0, y: 0 });
    expect(nudge(start, 1, 10, page)).toMatchObject({ x: 6, y: 15 });
  });

  it('resizes a picture keeping its proportions, within limits and on the page', () => {
    const grown = resizePicture({ ...box, x: 580, y: 100 }, 200, 3, page);
    expect(grown).toMatchObject({ width: 200, height: 66.67, x: 400 });
    expect(resizePicture(box, 1, 3, page).width).toBe(16);
    expect(resizePicture(box, 5000, 3, page).width).toBe(400);
  });

  it('sets a date by its letters, and keeps it on the page', () => {
    const date = resizeDate({ ...box, x: 590, y: 790 }, '05.03.2026', 12, page);
    expect(dateSize(date)).toBe(12);
    expect(date.height).toBe(15.6);
    expect(date.x + date.width).toBeLessThanOrEqual(600);
    expect(date.y + date.height).toBeLessThanOrEqual(800);
    expect(dateSize(resizeDate(box, 'x', 2, page))).toBe(6);
  });
});

describe('the marks as the server wants them', () => {
  const sign: Placement = {
    id: 1,
    page: 0,
    kind: 'signature',
    x: 72,
    y: 100,
    width: 140,
    height: 50,
  };

  it('puts a picture by its lower left corner as seen', () => {
    expect(toOps([sign], [turned(0)], '')).toEqual([
      { page: 0, x: 72, y: 800 - 150, width: 140, height: 50, image: 'signature' },
    ]);
  });

  it('puts the same mark where it is seen on a page turned a quarter', () => {
    // Seen lower left is (72, 150); on a 90 turn that is (x0 + 150, y0 + 72).
    expect(toOps([sign], [turned(90)], '')).toEqual([
      { page: 0, x: 150, y: 72, width: 140, height: 50, image: 'signature' },
    ]);
  });

  it('puts a date by its baseline, with the text it was given', () => {
    const date: Placement = {
      id: 2,
      page: 1,
      kind: 'date',
      x: 300,
      y: 700,
      width: 60,
      height: 15.6,
    };
    const [op] = toOps([date], [turned(0), turned(0)], '05/03/2026');
    expect(op).toEqual({
      page: 1,
      x: 300,
      y: Math.round((800 - (700 + 15.6 * 0.8)) * 100) / 100,
      text: '05/03/2026',
      size: 12,
    });
  });

  it('repeats initials on every page, each clamped to its own page', () => {
    let id = 10;
    const marks = onEveryPage(
      { kind: 'initials', x: 540, y: 740, width: 60, height: 40 },
      [turned(0), turned(90)],
      () => id++,
    );
    expect(marks.map((m) => [m.id, m.page, m.x, m.y])).toEqual([
      [10, 0, 540, 740],
      // The turned page is 800 wide and 600 tall as seen: 740 would be off the bottom.
      [11, 1, 540, 560],
    ]);
  });
});

describe('the date of signing', () => {
  const day = new Date(Date.UTC(2026, 2, 5, 12));

  it('is written in the order of the locale, in all twelve, with Latin digits', () => {
    const yearFirst = new Set(['sv-SE', 'zh-CN', 'ja-JP']);
    expect(LOCALE_CODES).toHaveLength(12);
    for (const code of LOCALE_CODES) {
      const text = formatStampDate(day, code, 'UTC');
      expect(text, code).toMatch(/^[0-9./-]+$/);
      expect(text.match(/\d+/g), code).toEqual(
        yearFirst.has(code) ? ['2026', '03', '05'] : ['05', '03', '2026'],
      );
    }
    expect(formatStampDate(day, 'sv-SE', 'UTC')).toBe('2026-03-05');
    expect(formatStampDate(day, 'en-GB', 'UTC')).toBe('05/03/2026');
    expect(formatStampDate(day, 'de-DE', 'UTC')).toBe('05.03.2026');
  });

  it('is the day where the signer is, not the day in Greenwich', () => {
    const lateNight = new Date(Date.UTC(2026, 2, 5, 23, 30));
    expect(formatStampDate(lateNight, 'en-GB', 'Asia/Tokyo')).toBe('06/03/2026');
    expect(formatStampDate(lateNight, 'en-GB', 'UTC')).toBe('05/03/2026');
  });

  it('falls back to the ISO day for a locale the engine cannot read', () => {
    expect(formatStampDate(day, 'not a locale!!', 'UTC')).toBe('2026-03-05');
  });
});
