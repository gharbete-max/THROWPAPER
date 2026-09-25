import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts, degrees } from 'pdf-lib';
import { Util, getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { forms as formSchemas } from '@tp/shared';
import type { SubmissionRecord } from '../db/repositories/index.js';
import { createMemoryUploadStore } from '../uploads/private-store.js';
import { createPdfRenderer, type PdfRenderer } from './render.js';
import { fillPaper } from './paper.js';

/**
 * The answers on the paper, through real Chromium, read back where a person sees them.
 *
 * The builder places a box as a fraction of the page **as pdf.js shows it** — the crop box, with the
 * page's `/Rotate` applied (`extract.ts`). A scanner's PDF is often rotated, and a trimmed one has a
 * crop box smaller than its media box. So each case here draws a box the way the builder would, fills
 * it, opens the result with pdf.js again and asks: is the answer inside that box, upright, and is the
 * original page's own text still there?
 */
let renderer: PdfRenderer;

beforeAll(() => {
  renderer = createPdfRenderer();
});

afterAll(async () => {
  await renderer?.close();
});

const locales = { supported: ['sv-SE'], default: 'sv-SE' };
/** Where the builder put the box, as fractions of the page as it is seen. */
const box = { page: 0, x: 0.1, y: 0.12, w: 0.35, h: 0.04 };

async function sourcePdf(shape: {
  rotate?: number;
  crop?: [number, number, number, number];
}): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595, 842]);
  page.drawText('ORIGINALTEXT', { x: 200, y: 400, size: 14, font });
  if (shape.crop) page.setCropBox(...shape.crop);
  if (shape.rotate) page.setRotation(degrees(shape.rotate));
  return Buffer.from(await doc.save());
}

async function filled(source: Buffer): Promise<Buffer> {
  const uploadStore = createMemoryUploadStore();
  const { key } = await uploadStore.put(source, 'pdf');
  const definition = formSchemas.FormDefinition.parse({
    schemaVersion: 1,
    paper: { sources: [{ key, pages: 1 }] },
    fields: [
      {
        id: 'f1',
        key: 'full_name',
        type: 'short_text',
        label: { 'sv-SE': 'Namn' },
        paper: box,
      },
    ],
  });
  const at = new Date('2026-05-14T09:30:00Z');
  const submission: SubmissionRecord = {
    id: '55555555-5555-4555-8555-555555555555',
    organisationId: 'o',
    formId: 'f',
    formVersionId: 'v',
    eventId: null,
    reference: 'PAPR01',
    status: 'complete',
    locale: 'sv-SE',
    email: null,
    data: { full_name: 'Answerwritten' },
    resumeTokenHash: null,
    resumeExpiresAt: null,
    submittedAt: at,
    revokedAt: null,
    createdAt: at,
    updatedAt: at,
  };
  const out = await fillPaper({ uploadStore, renderer }, submission, definition, locales);
  if (!out) throw new Error('no paper');
  return out.pdf;
}

/** Each run of text on page 1, with where pdf.js shows it as fractions of the viewed page. */
async function seen(pdf: Buffer) {
  const doc = await getDocument({ data: new Uint8Array(pdf), useSystemFonts: false }).promise;
  const page = await doc.getPage(1);
  const viewport = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  return {
    pages: doc.numPages,
    items: content.items.flatMap((item) => {
      if (!('str' in item) || item.str.trim() === '') return [];
      const [a = 0, b = 0, , , e = 0, f = 0] = Util.transform(
        viewport.transform,
        item.transform as number[],
      );
      return [
        {
          text: item.str,
          x: e / viewport.width,
          y: f / viewport.height,
          upright: a > 0 && Math.abs(b) < 1e-6,
        },
      ];
    }),
  };
}

describe('answers written onto the paper, as the page is seen', () => {
  it.each([
    ['an upright page', {}],
    ['a page rotated a quarter turn', { rotate: 90 }],
    ['a page upside down', { rotate: 180 }],
    ['a page rotated three quarters', { rotate: 270 }],
    ['a trimmed page (crop box inside the media box)', { crop: [40, 60, 500, 700] as const }],
    ['a trimmed, rotated page', { rotate: 90, crop: [40, 60, 500, 700] as const }],
  ] as const)('%s: the answer is in its box, upright, over the original', async (_, shape) => {
    const pdf = await filled(
      await sourcePdf(shape as { rotate?: number; crop?: [number, number, number, number] }),
    );
    const { pages, items } = await seen(pdf);
    expect(pages).toBe(1);

    // Chromium may set one word as several runs (kerning), so the answer starts at the run from
    // which the following runs spell it.
    const answer = items.find((_, i) =>
      items
        .slice(i)
        .map((item) => item.text)
        .join('')
        .startsWith('Answerwritten'),
    );
    expect(answer, JSON.stringify(items)).toBeDefined();
    expect(answer!.upright).toBe(true);
    // The baseline sits inside the box: left edge to right edge, top to bottom (with a little
    // slack for the line's own height and Chromium's rounding).
    expect(answer!.x).toBeGreaterThanOrEqual(box.x - 0.01);
    expect(answer!.x).toBeLessThan(box.x + box.w);
    expect(answer!.y).toBeGreaterThanOrEqual(box.y - 0.01);
    expect(answer!.y).toBeLessThanOrEqual(box.y + box.h + 0.01);

    // Nothing of the original was lost under the answers.
    expect(items.some((item) => item.text.includes('ORIGINALTEXT'))).toBe(true);
  });
});
