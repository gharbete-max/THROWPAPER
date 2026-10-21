import { beforeAll, describe, expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { editPdf, EditRefusal, redactPdf, type EditOp } from './edit.js';

/**
 * The validation of edit operations, on its own: every operation a screen could send is either
 * applied or refused by name, and the choice agrees with an oracle written here from the rules in
 * `edit.ts`. The guard's worker thread is stubbed (it has its own tests and its own fuzz in
 * `fuzz.test.ts`) so that a few hundred operations run in well under a second.
 * Seeded; `FUZZ_SEED=<n>` replays a failure.
 */
vi.mock('../uploads/pdf-guard.js', () => ({
  checkPdf: async (bytes: Uint8Array) => {
    try {
      return { ok: true, pages: (await PDFDocument.load(bytes)).getPageCount() };
    } catch {
      return { ok: false, reason: 'unreadable' };
    }
  },
}));

const SEED = Number(process.env['FUZZ_SEED'] ?? 20261021);

function prng(seed: number) {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (low: number, high: number) => low + Math.floor(next() * (high - low + 1)),
    pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)]!,
  };
}

const PNG = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64',
  ),
);
const PAGES = 3;
let plain: Uint8Array;

beforeAll(async () => {
  const doc = await PDFDocument.create();
  for (let i = 0; i < PAGES; i += 1) doc.addPage([300, 400]);
  plain = await doc.save();
});

const NUMBERS = [
  -1,
  0,
  1,
  3,
  4,
  12,
  99,
  200,
  201,
  2000,
  2001,
  1.5,
  1e9,
  Number.NaN,
  Number.POSITIVE_INFINITY,
];
const finite = (...n: number[]) => n.every((x) => Number.isFinite(x));

/** The rules of `editPdf`, restated. */
function valid(op: EditOp): boolean {
  if (!Number.isInteger(op.page) || op.page < 0 || op.page >= PAGES) return false;
  if ('image' in op) {
    return (
      op.image === 'sig' &&
      finite(op.x, op.y, op.width, op.height) &&
      op.width > 0 &&
      op.height > 0 &&
      op.width <= 2000 &&
      op.height <= 2000
    );
  }
  if ('rect' in op) {
    const { x, y, width, height } = op.rect;
    return (
      finite(x, y, width, height) && width > 0 && height > 0 && /^#[0-9a-f]{6}$/i.test(op.fill)
    );
  }
  return (
    op.text.replace(/\s/g, '') !== '' &&
    op.text.length <= 500 &&
    finite(op.x, op.y, op.size) &&
    op.size >= 4 &&
    op.size <= 200 &&
    (op.color === undefined || /^#[0-9a-f]{6}$/i.test(op.color))
  );
}

describe('edit operations', () => {
  it('are applied exactly when they are well formed, and refused by name otherwise', async () => {
    const r = prng(SEED);
    const n = () => r.pick(NUMBERS);
    for (let i = 0; i < 300; i += 1) {
      const op: EditOp = r.pick<() => EditOp>([
        () => ({
          page: r.int(-1, PAGES),
          x: n(),
          y: n(),
          text: r.pick(['x', ' ', 'Åsa', 'x'.repeat(501)]),
          size: n(),
        }),
        () => ({
          page: r.int(-1, PAGES),
          x: 5,
          y: 5,
          text: 'ok',
          size: 12,
          color: r.pick(['#ff00aa', 'red', '#12345', undefined]),
        }),
        () => ({
          page: r.int(-1, PAGES),
          rect: { x: n(), y: n(), width: n(), height: n() },
          fill: r.pick(['#000000', '#FFFFFF', 'red', '']),
        }),
        () => ({
          page: r.int(-1, PAGES),
          x: n(),
          y: n(),
          width: n(),
          height: n(),
          image: r.pick(['sig', 'other']),
        }),
      ])();
      const ctx = `seed=${SEED} case=${i} op=${JSON.stringify(op)}`;
      try {
        const out = await editPdf(plain, [op], { images: new Map([['sig', PNG]]) });
        expect(valid(op), `${ctx} was applied`).toBe(true);
        expect((await PDFDocument.load(out)).getPageCount(), ctx).toBe(PAGES);
      } catch (error) {
        expect(error, `${ctx}: ${String(error)}`).toBeInstanceOf(EditRefusal);
        expect(valid(op), `${ctx} was refused as ${(error as EditRefusal).code}`).toBe(false);
      }
    }
  });

  it('are bounded in number', async () => {
    const op: EditOp = { page: 0, x: 1, y: 1, text: 'x', size: 12 };
    await expect(editPdf(plain, [])).rejects.toMatchObject({ code: 'no-ops' });
    await expect(
      editPdf(
        plain,
        Array.from({ length: 201 }, () => op),
      ),
    ).rejects.toMatchObject({
      code: 'too-many-ops',
    });
  });
});

describe('redactions', () => {
  it('refuse a page that is not there, a picture that is not one, and too many pages', async () => {
    const r = prng(SEED + 1);
    for (let i = 0; i < 40; i += 1) {
      const page = r.pick([-1, 0, 1, 2, 3, 1.5, Number.NaN]);
      const image = r.pick([
        PNG,
        Uint8Array.from([1, 2, 3]),
        new Uint8Array(),
        Uint8Array.from({ length: 64 }, () => r.int(0, 255)),
      ]);
      const ok = Number.isInteger(page) && page >= 0 && page < PAGES && image === PNG;
      try {
        await redactPdf(plain, [{ page, image }]);
        expect(ok, `seed=${SEED + 1} case=${i} page=${page} was applied`).toBe(true);
      } catch (error) {
        expect(error, `case ${i}: ${String(error)}`).toBeInstanceOf(EditRefusal);
        expect(ok, `case ${i} page=${page} refused as ${(error as EditRefusal).code}`).toBe(false);
      }
    }
    await expect(
      redactPdf(
        plain,
        Array.from({ length: 51 }, () => ({ page: 0, image: PNG })),
      ),
    ).rejects.toMatchObject({ code: 'too-many-ops' });
  });
});
