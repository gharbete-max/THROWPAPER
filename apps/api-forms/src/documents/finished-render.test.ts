import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { forms as formSchemas } from '@tp/shared';
import type { SubmissionRecord } from '../db/repositories/index.js';
import { createMemoryUploadStore } from '../uploads/private-store.js';
import { createPdfRenderer, type PdfRenderer } from './render.js';
import { renderFinishedDocument, type FinishedDocument } from './finished.js';

/**
 * The finished document through real Chromium — the only way to know the PDF is right rather than
 * the HTML. A4, the embedded font carrying every script a respondent may write in, the title in
 * the file's own metadata, and a long answer that breaks across pages instead of being cut off.
 */
const definition = formSchemas.FormDefinition.parse({
  ...formSchemas.emptyDefinition,
  fields: [
    { id: 'a', key: 'full_name', type: 'short_text', label: { 'sv-SE': 'Namn' }, required: true },
    { id: 'b', key: 'notes', type: 'long_text', label: { 'sv-SE': 'Övrigt' } },
  ],
});

const at = new Date('2026-05-14T09:30:00Z');
const submission: SubmissionRecord = {
  id: '44444444-4444-4444-8444-444444444444',
  organisationId: 'o',
  formId: 'f',
  formVersionId: 'v',
  eventId: null,
  reference: 'K7M2QX',
  status: 'complete',
  locale: 'sv-SE',
  email: null,
  data: {
    full_name: 'Åsa Öberg-Ærø · Юлия · 山田',
    notes: Array.from({ length: 220 }, (_, i) => `Rad ${i + 1}: ärende om växthusets ö-dörr.`).join(
      '\n',
    ),
  },
  resumeTokenHash: null,
  resumeExpiresAt: null,
  submittedAt: at,
  revokedAt: null,
  createdAt: at,
  updatedAt: at,
};

let renderer: PdfRenderer;
let finished: FinishedDocument;

beforeAll(async () => {
  renderer = createPdfRenderer();
  finished = await renderFinishedDocument(
    { renderer, uploadStore: createMemoryUploadStore() },
    {
      organisation: {
        name: 'Föreningen Vårljus',
        supportedLocales: ['sv-SE'],
        defaultLocale: 'sv-SE',
      },
      formTitle: { 'sv-SE': 'Vårmötet 2026' },
      submission,
      definition,
    },
  );
}, 120_000);

afterAll(async () => {
  await renderer?.close();
});

async function open() {
  return getDocument({ data: new Uint8Array(finished.pdf), useSystemFonts: false }).promise;
}

async function text(): Promise<string> {
  const doc = await open();
  let out = '';
  for (let page = 1; page <= doc.numPages; page += 1) {
    const content = await (await doc.getPage(page)).getTextContent();
    out += content.items.map((item) => ('str' in item ? item.str : '')).join(' ');
  }
  return out.replace(/\s+/g, '');
}

describe('the finished document as a PDF', () => {
  it('is named after the form, in its own script', () => {
    expect(finished.filename).toBe('Vårmötet-2026-K7M2QX.pdf');
  });

  it('is A4 (595.28 × 841.89 pt; Chromium rounds to 8.27 × 11.7 in, within a point)', async () => {
    const page = await (await open()).getPage(1);
    const [, , width, height] = page.view;
    expect(Math.abs(width! - 595.28)).toBeLessThan(2);
    expect(Math.abs(height! - 841.89)).toBeLessThan(2);
  });

  it('keeps Swedish, Danish, Cyrillic and CJK text intact', async () => {
    const all = await text();
    expect(all).toContain('ÅsaÖberg-Ærø');
    expect(all).toContain('Юлия');
    expect(all).toContain('山田');
    expect(all).toContain('Vårmötet2026');
    expect(all).toContain('K7M2QX');
  });

  it('carries the title in the file’s metadata', async () => {
    const { info } = (await (await open()).getMetadata()) as { info: { Title?: string } };
    expect(info.Title).toBe('Vårmötet 2026 — K7M2QX');
  });

  it('breaks a long answer across pages rather than cutting it off, with a running header', async () => {
    const doc = await open();
    expect(doc.numPages).toBeGreaterThan(1);
    const all = await text();
    expect(all).toContain('Rad1:');
    expect(all).toContain('Rad220:');
    expect(all).toContain('FöreningenVårljus');
  });

  it('starts a long answer on the first page instead of pushing it whole onto the next', async () => {
    const first = await (await open()).getPage(1);
    const content = await first.getTextContent();
    const onFirst = content.items.map((item) => ('str' in item ? item.str : '')).join(' ');
    expect(onFirst.replace(/\s+/g, '')).toContain('Rad1:');
  });
});
