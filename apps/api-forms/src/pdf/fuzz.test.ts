import { beforeAll, describe, expect, it } from 'vitest';
import { degrees, PDFDocument, PDFName, PDFRawStream, StandardFonts } from 'pdf-lib';
import { arrangePdf, ArrangeRefusal, type ArrangeStep } from './arrange.js';
import { editPdf, EditRefusal, redactPdf } from './edit.js';
import { fillPdf, pdfFields } from './fill.js';
import { shrinkPdf } from './shrink.js';

/**
 * Page work on pages nobody planned: random plans, and files that are damaged in random ways. The
 * promise is the route's: a stranger's bytes end as a PDF or as a refusal a screen can word, and
 * never as a thrown error that becomes a 500 (or worse, stops the server). Seeded; a failure names
 * the seed, and `FUZZ_SEED=<n> pnpm vitest run <file>` replays it. Every parse here runs in the
 * guard's worker thread, which is what bounds the file-count of the damaged cases to a few dozen.
 */
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
type Rng = ReturnType<typeof prng>;

const PAGES = 4;
let plain: Uint8Array;
let withForm: Uint8Array;
let bigArray: Uint8Array;
/** A 1x1 PNG, for the edit and redact inputs. */
const PNG = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64',
  ),
);

beforeAll(async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < PAGES; i += 1) {
    const page = doc.addPage([300, 400]);
    page.drawText(`Page ${i + 1}`, { x: 40, y: 300, size: 18, font });
    if (i === 1) page.setRotation(degrees(90));
  }
  plain = await doc.save();

  const formed = await PDFDocument.create();
  formed.addPage([300, 400]).drawText('Form', { x: 20, y: 300, size: 12 });
  const field = formed.getForm().createTextField('name');
  field.addToPage(formed.getPage(0), { x: 20, y: 200, width: 100, height: 20 });
  withForm = await formed.save();

  // One array of 200 000 numbers hung off the catalogue: valid, if odd, and a spread of it into
  // a function call overflows the stack.
  const heavy = await PDFDocument.create();
  heavy.addPage([300, 400]);
  heavy.catalog.set(PDFName.of('Big'), heavy.context.obj(Array.from({ length: 200_000 }, () => 1)));
  bigArray = await heavy.save({ useObjectStreams: false });
});

/** A refusal is an answer; anything else is a defect. */
async function answerOrRefusal<T>(label: string, run: () => Promise<T>): Promise<T | 'refused'> {
  try {
    return await run();
  } catch (error) {
    expect(
      error instanceof ArrangeRefusal || error instanceof EditRefusal,
      `${label}: threw ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`,
    ).toBe(true);
    return 'refused';
  }
}

/** The file, damaged in one of the ways a bad download, a bad scanner or a bad actor does it. */
function damaged(bytes: Uint8Array, r: Rng): { bytes: Uint8Array; how: string } {
  const copy = Uint8Array.from(bytes);
  switch (r.int(0, 6)) {
    case 0: {
      const keep = r.int(0, copy.length - 1);
      return { bytes: copy.subarray(0, keep), how: `truncated to ${keep}` };
    }
    case 1: {
      for (let n = r.int(1, 12); n > 0; n -= 1) copy[r.int(0, copy.length - 1)] = r.int(0, 255);
      return { bytes: copy, how: 'flipped bytes' };
    }
    case 2: {
      const from = r.int(0, copy.length - 1);
      copy.fill(0, from, Math.min(copy.length, from + r.int(1, 400)));
      return { bytes: copy, how: `zeroed from ${from}` };
    }
    case 3:
      return {
        bytes: Uint8Array.from([...Buffer.from('junk before\n'), ...copy]),
        how: 'junk prefix',
      };
    case 4:
      return { bytes: copy.subarray(r.int(1, 40)), how: 'header cut off' };
    case 5: {
      // The cross-reference table and trailer, which a reader needs first, gone or wrong.
      const text = Buffer.from(copy).toString('latin1');
      const at = text.lastIndexOf('startxref');
      return {
        bytes: Buffer.from(text.slice(0, at) + 'startxref\n9999999\n%%EOF', 'latin1'),
        how: 'bad startxref',
      };
    }
    default:
      return {
        bytes: Uint8Array.from({ length: r.int(0, 300) }, () => r.int(0, 255)),
        how: 'noise',
      };
  }
}

describe('arranging pages', () => {
  it('any valid plan gives a PDF with those pages, in that order, turned as asked', async () => {
    const source = await PDFDocument.load(plain);
    for (let i = 0; i < 8; i += 1) {
      const r = prng(SEED + i);
      const plan: ArrangeStep[] = Array.from({ length: r.int(1, 12) }, () => ({
        file: 0,
        page: r.int(0, PAGES - 1),
        rotate: r.pick([undefined, 0, 90, 180, 270]),
      }));
      const ctx = `seed=${SEED + i} plan=${JSON.stringify(plan)}`;
      const out = await PDFDocument.load(await arrangePdf([plain], plan));
      expect(out.getPageCount(), ctx).toBe(plan.length);
      plan.forEach((step, n) => {
        const was = source.getPage(step.page).getRotation().angle;
        const now = out.getPage(n).getRotation().angle;
        expect(((now % 360) + 360) % 360, `${ctx} page ${n}`).toBe(
          (was + (step.rotate ?? 0)) % 360,
        );
        expect(out.getPage(n).getSize(), `${ctx} page ${n} size`).toEqual(
          source.getPage(step.page).getSize(),
        );
      });
    }
  });

  it('any invalid plan is a refusal that names why, before or after the file is opened', async () => {
    const r = prng(SEED);
    const numbers = [
      -1,
      0,
      1,
      3,
      4,
      99,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      2 ** 53,
      -(2 ** 31),
    ];
    const wrong: ArrangeStep[][] = [
      [],
      ...Array.from({ length: 20 }, () => [
        {
          file: r.pick(numbers),
          page: r.pick(numbers),
          rotate: r.pick([undefined, 45, -90, 360, 450, Number.NaN]),
        },
      ]),
      Array.from({ length: 501 }, () => ({ file: 0, page: 0 })),
    ];
    for (const plan of wrong) {
      const ctx = `plan=${JSON.stringify(plan).slice(0, 120)}`;
      try {
        const out = await arrangePdf([plain], plan);
        // Allowed only if the plan was in fact valid.
        const valid = plan.every(
          (s) =>
            s.file === 0 &&
            Number.isInteger(s.page) &&
            s.page >= 0 &&
            s.page < PAGES &&
            [0, 90, 180, 270].includes(s.rotate ?? 0),
        );
        expect(valid && plan.length > 0, ctx).toBe(true);
        expect(out.length, ctx).toBeGreaterThan(0);
      } catch (error) {
        expect(error, `${ctx}: ${String(error)}`).toBeInstanceOf(ArrangeRefusal);
      }
    }
  });

  it('a damaged file is a PDF out or a refusal, never anything else', async () => {
    for (let i = 0; i < 10; i += 1) {
      const r = prng(SEED + 100 + i);
      const { bytes, how } = damaged(r.pick([plain, withForm]), r);
      const result = await answerOrRefusal(`seed=${SEED + 100 + i} ${how}`, () =>
        arrangePdf([bytes], [{ file: 0, page: 0 }]),
      );
      if (result !== 'refused') {
        expect((await PDFDocument.load(result)).getPageCount(), `${how}`).toBe(1);
      }
    }
  });
});

describe('the other page work on damaged files', () => {
  it('reading fields, filling, shrinking, editing and redacting end as an answer or a refusal', async () => {
    for (let i = 0; i < 2; i += 1) {
      const r = prng(SEED + 200 + i);
      const { bytes, how } = damaged(withForm, r);
      const ctx = `seed=${SEED + 200 + i} ${how}`;
      await answerOrRefusal(`${ctx} fields`, () => pdfFields(bytes));
      await answerOrRefusal(`${ctx} fill`, () => fillPdf(bytes, { name: 'x' }));
      await answerOrRefusal(`${ctx} shrink`, () => shrinkPdf(bytes));
      await answerOrRefusal(`${ctx} edit`, () =>
        editPdf(bytes, [{ page: 0, x: 10, y: 10, text: 'x', size: 12 }]),
      );
      await answerOrRefusal(`${ctx} redact`, () => redactPdf(bytes, [{ page: 0, image: PNG }]));
    }
  });
});

describe('what pages share is copied once', () => {
  /** Twenty pages that all draw one 400 KB picture. */
  async function shared(): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    const picture = doc.context.register(
      PDFRawStream.of(
        doc.context.obj({
          Type: 'XObject',
          Subtype: 'Image',
          Width: 600,
          Height: 600,
          ColorSpace: 'DeviceGray',
          BitsPerComponent: 8,
        }),
        Uint8Array.from({ length: 360_000 }, (_, i) => (i * 2654435761) >>> 24),
      ),
    );
    for (let i = 0; i < 20; i += 1) {
      doc
        .addPage([300, 400])
        .node.set(PDFName.of('Resources'), doc.context.obj({ XObject: { Im0: picture } }));
    }
    return doc.save({ useObjectStreams: false });
  }

  it('reordering every page of a PDF does not multiply what the pages share', async () => {
    const source = await shared();
    const reversed = Array.from({ length: 20 }, (_, i) => ({ file: 0, page: 19 - i }));
    const out = await arrangePdf([source], reversed);
    // Was twenty copies of the picture (about twenty times the file) when each page was copied alone.
    expect(out.length).toBeLessThan(source.length * 1.2);
    expect((await PDFDocument.load(out)).getPageCount()).toBe(20);
  });

  it('a page named again costs its own copy, turned as asked; a plan of heavy repeats is refused', async () => {
    const source = await shared();
    const twice = await arrangePdf(
      [source],
      [
        { file: 0, page: 0 },
        { file: 0, page: 0, rotate: 90 },
      ],
    );
    const doc = await PDFDocument.load(twice);
    expect([doc.getPage(0).getRotation().angle, doc.getPage(1).getRotation().angle]).toEqual([
      0, 90,
    ]);
    // Five hundred copies of a 360 KB file would be a response of some 180 MB.
    const repeats = Array.from({ length: 500 }, () => ({ file: 0, page: 0 }));
    await expect(arrangePdf([source], repeats)).rejects.toMatchObject({ code: 'too-many-pages' });
  });
});

describe('a valid PDF with an enormous array', () => {
  it('is shrunk, not crashed: the walk over it does not spread the array into a call', async () => {
    const out = await shrinkPdf(bigArray);
    expect((await PDFDocument.load(out)).getPageCount()).toBe(1);
  });
});
