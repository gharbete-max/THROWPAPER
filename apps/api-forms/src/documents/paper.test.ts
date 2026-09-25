import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { forms as formSchemas } from '@tp/shared';
import type { SubmissionRecord } from '../db/repositories/index.js';
import { createMemoryUploadStore } from '../uploads/private-store.js';
import type { PdfRenderer } from './render.js';
import { fillPaper } from './paper.js';

/**
 * The answers on the paper, where the boxes are.
 *
 * The renderer here is a stand-in that returns a real PDF — one blank page per `@page` rule in
 * the overlay HTML, at the size the rule names — so pdf-lib has something to composite and the
 * HTML it was handed can be inspected. Whether Chromium draws the text is Chromium's job, and
 * `admission.test.ts` already proves it can.
 */
function pageRenderer(): PdfRenderer & { rendered: string[] } {
  const rendered: string[] = [];
  return {
    rendered,
    async render() {
      throw new Error('not used here');
    },
    async renderPages(html) {
      rendered.push(html);
      const doc = await PDFDocument.create();
      for (const [, w, h] of html.matchAll(/@page p\d+ \{ size: ([\d.]+)pt ([\d.]+)pt/g)) {
        // A content stream, however empty: a page with none cannot be embedded, and Chromium
        // never produces one.
        doc.addPage([Number(w), Number(h)]).drawRectangle({ x: 0, y: 0, width: 0, height: 0 });
      }
      return Buffer.from(await doc.save());
    },
    async close() {},
  };
}

/** A 2×3 PNG: the smallest thing `imageSize` reads a size from. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAIAAAA5+3qbAAAADklEQVQI12P4//8/AwMDAAj+A/9v5WmDAAAAAElFTkSuQmCC',
  'base64',
);

async function sourcePdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.addPage([595, 842]);
  return Buffer.from(await doc.save());
}

const locales = { supported: ['sv-SE', 'en-GB'], default: 'sv-SE' };

describe('filling paper', () => {
  it('writes each answer into its box and copies every page', async () => {
    const uploadStore = createMemoryUploadStore();
    const pdf = await uploadStore.put(await sourcePdf(), 'pdf');
    const photo = await uploadStore.put(PNG, 'png');
    const mark = await uploadStore.put(PNG, 'png');

    const definition = formSchemas.FormDefinition.parse({
      schemaVersion: 1,
      paper: {
        sources: [
          { key: pdf.key, pages: 1 },
          { key: photo.key, pages: 1 },
        ],
      },
      fields: [
        {
          id: 'a',
          key: 'name',
          type: 'short_text',
          label: { 'sv-SE': 'Namn' },
          paper: { page: 0, x: 0.25, y: 0.1, w: 0.5, h: 0.03 },
        },
        {
          id: 'b',
          key: 'member',
          type: 'yes_no',
          label: { 'sv-SE': 'Medlem' },
          // 15pt square: a tick box.
          paper: { page: 0, x: 0.25, y: 0.2, w: 15 / 595, h: 15 / 842 },
        },
        {
          id: 'c',
          key: 'news',
          type: 'yes_no',
          label: { 'sv-SE': 'Nyhetsbrev' },
          // A wide box: the word.
          paper: { page: 0, x: 0.25, y: 0.3, w: 0.3, h: 0.03 },
        },
        {
          id: 'd',
          key: 'colour',
          type: 'single_select',
          label: { 'sv-SE': 'Färg' },
          options: [{ value: 'r', label: { 'sv-SE': 'Röd', 'en-GB': 'Red' } }],
          paper: { page: 1, x: 0.1, y: 0.5, w: 0.3, h: 0.04 },
        },
        {
          id: 'g',
          key: 'size',
          type: 'single_select',
          label: { 'sv-SE': 'Storlek' },
          // A radio group off the paper: each button has its own box.
          options: [
            {
              value: 's',
              label: { 'sv-SE': 'S' },
              paper: { page: 0, x: 0.3, y: 0.4, w: 0.02, h: 0.015 },
            },
            {
              value: 'm',
              label: { 'sv-SE': 'M' },
              paper: { page: 0, x: 0.4, y: 0.4, w: 0.02, h: 0.015 },
            },
          ],
          paper: { page: 0, x: 0.3, y: 0.4, w: 0.12, h: 0.015 },
        },
        {
          id: 'e',
          key: 'mark',
          type: 'signature',
          label: { 'sv-SE': 'Underskrift' },
          paper: { page: 1, x: 0.5, y: 0.8, w: 0.4, h: 0.1 },
        },
        { id: 'f', key: 'notes', type: 'long_text', label: { 'sv-SE': 'Övrigt' } },
      ],
    });

    const submission = {
      id: 's1',
      reference: 'ABC123',
      locale: 'sv-SE',
      formVersionId: 'v1',
      data: {
        name: 'Анна Öberg <b>',
        member: true,
        news: false,
        colour: 'r',
        size: 'm',
        mark: mark.key,
        notes: 'never drawn',
      },
    } as unknown as SubmissionRecord;

    const renderer = pageRenderer();
    const filled = await fillPaper({ uploadStore, renderer }, submission, definition, locales);
    expect(filled?.filename).toBe('ABC123-paper.pdf');

    const out = await PDFDocument.load(filled!.pdf);
    expect(out.getPageCount()).toBe(2);
    // Named in its own metadata, so a viewer's window and its Save use a name, not a blob's id.
    expect(out.getTitle()).toBe('ABC123');
    const titled = await fillPaper(
      { uploadStore, renderer: pageRenderer() },
      submission,
      definition,
      locales,
      'Medlemsansökan',
    );
    expect((await PDFDocument.load(titled!.pdf)).getTitle()).toBe('Medlemsansökan — ABC123');
    // The photograph's page is A4 wide and keeps the photograph's 2:3 shape.
    expect(out.getPage(1).getSize().height / out.getPage(1).getSize().width).toBeCloseTo(1.5);

    const html = renderer.rendered[0]!;
    expect(html).toContain('left:25.000%;top:10.000%;width:50.000%;height:3.000%');
    // Verbatim, and escaped.
    expect(html).toContain('Анна Öberg &lt;b&gt;');
    expect(html).toContain('class="a tick"');
    expect(html).toContain('✓');
    expect(html).toContain('>Nej<');
    // The option's label in the respondent's language, not its stored value.
    expect(html).toContain('>Röd<');
    // A radio button off the paper: a tick on the chosen one, its label nowhere.
    expect(html).toContain('left:40.000%;top:40.000%');
    expect(html).not.toContain('left:30.000%;top:40.000%');
    expect(html).not.toContain('>M<');
    expect(html).toContain('class="a mark"');
    expect(html).toContain('<img src="data:image/png;base64,');
    // The photograph is the page background; the field with no anchor is nowhere.
    expect(html).toContain('<img class="bg" src="data:image/png;base64,');
    expect(html).not.toContain('never drawn');
  });

  it('draws a signature from its strokes, so it stays sharp at any size', async () => {
    const uploadStore = createMemoryUploadStore();
    const pdf = await uploadStore.put(await sourcePdf(), 'pdf');
    const strokes = {
      v: 1 as const,
      kind: 'drawn' as const,
      width: 600,
      height: 200,
      paths: ['M 10 20 Q 11 22 13 24 L 30 40'],
    };
    const mark = await uploadStore.put(
      // A whole PNG: the 2×3 one above is only complete enough for `imageSize`.
      Buffer.from(
        formSchemas.embedSignatureVector(
          Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
            'base64',
          ),
          strokes,
        ),
      ),
      'png',
    );

    const definition = formSchemas.FormDefinition.parse({
      schemaVersion: 1,
      paper: { sources: [{ key: pdf.key, pages: 1 }] },
      fields: [
        {
          id: 's',
          key: 'mark',
          type: 'signature',
          label: { 'sv-SE': 'Underskrift' },
          paper: { page: 0, x: 0.5, y: 0.8, w: 0.4, h: 0.1 },
        },
      ],
    });

    const renderer = pageRenderer();
    await fillPaper(
      { uploadStore, renderer },
      {
        reference: 'SIG1',
        locale: 'sv-SE',
        data: { mark: mark.key },
      } as unknown as SubmissionRecord,
      definition,
      locales,
    );

    const html = renderer.rendered[0]!;
    expect(html).toContain('<path d="M 10 20 Q 11 22 13 24 L 30 40"/>');
    // The vector replaces the bitmap rather than sitting on top of it.
    expect(html).not.toContain('class="a mark"><img');
  });

  it('is nothing for a form without paper', async () => {
    const filled = await fillPaper(
      { uploadStore: createMemoryUploadStore(), renderer: pageRenderer() },
      { locale: 'sv-SE', data: {} } as unknown as SubmissionRecord,
      formSchemas.emptyDefinition,
      locales,
    );
    expect(filled).toBeNull();
  });
});
