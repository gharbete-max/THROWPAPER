import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { renderAdmissionHtml } from './admission.js';
import { createPdfRenderer, type PdfRenderer } from './render.js';
import { deriveQrKey, signAdmissionToken, verifyAdmissionToken } from './qr-token.js';
import { testOrganisation } from '../test-support.js';
import type { EventRecord, SubmissionRecord } from '../db/repositories/index.js';

const SECRET = 'test-secret-at-least-thirty-two-characters-long';

const event: EventRecord = {
  id: '11111111-1111-4111-8111-111111111111',
  organisationId: testOrganisation.id,
  name: { 'sv-SE': 'Vårmötet 2026', 'en-GB': 'Spring meeting 2026' },
  description: {},
  startsAt: new Date('2026-05-14T09:00:00Z'),
  endsAt: new Date('2026-05-14T16:00:00Z'),
  venueName: 'Näringslivets Hus',
  venueAddress: 'Storgatan 19, Göteborg',
  capacity: 250,
  registrationClosesAt: null,
  status: 'open',
  createdAt: new Date(),
  updatedAt: new Date(),
};

function submission(overrides: Partial<SubmissionRecord> = {}): SubmissionRecord {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    organisationId: testOrganisation.id,
    formId: '44444444-4444-4444-8444-444444444444',
    formVersionId: '55555555-5555-4555-8555-555555555555',
    eventId: event.id,
    reference: 'AB12-CD34',
    status: 'complete',
    locale: 'sv-SE',
    email: 'bjorn@example.com',
    data: { full_name: 'Björn Öberg', email: 'bjorn@example.com' },
    resumeTokenHash: null,
    resumeExpiresAt: null,
    submittedAt: new Date(),
    revokedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function token(reference = 'AB12-CD34') {
  return signAdmissionToken({ reference, eventId: event.id }, deriveQrKey(SECRET));
}

describe('the admission document', () => {
  it('renders in the attendee’s locale, not the organisation default', async () => {
    const english = await renderAdmissionHtml({
      organisation: testOrganisation,
      event,
      submission: submission({ locale: 'en-GB' }),
      token: token(),
    });

    // The organisation default is sv-SE; this attendee registered in English.
    expect(english).toContain('Admission card');
    expect(english).toContain('Spring meeting 2026');
    expect(english).not.toContain('Inträdeskort');
  });

  it('renders Swedish for a Swedish attendee', async () => {
    const swedish = await renderAdmissionHtml({
      organisation: testOrganisation,
      event,
      submission: submission(),
      token: token(),
    });
    expect(swedish).toContain('Inträdeskort');
    expect(swedish).toContain('Vårmötet 2026');
  });

  it('embeds the QR as inline SVG so it stays sharp at print size', async () => {
    const html = await renderAdmissionHtml({
      organisation: testOrganisation,
      event,
      submission: submission(),
      token: token(),
    });
    expect(html).toContain('<svg');
    expect(html).not.toContain('data:image/png');
  });

  it('prints the reference alongside the code, for when a scanner will not cooperate', async () => {
    const html = await renderAdmissionHtml({
      organisation: testOrganisation,
      event,
      submission: submission(),
      token: token(),
    });
    expect(html).toContain('AB12-CD34');
  });

  it('escapes an attendee name — the value came from a public form', async () => {
    const html = await renderAdmissionHtml({
      organisation: testOrganisation,
      event,
      submission: submission({ data: { full_name: '<script>alert(1)</script>' } }),
      token: token(),
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

/**
 * The slow one: a real Chromium render, on the engine phase 1 proved. A test asserting the HTML
 * contains a name would happily pass while the PDF came out blank.
 */
describe('the rendered PDF', () => {
  let renderer: PdfRenderer;
  let pdf: Buffer;

  beforeAll(async () => {
    renderer = createPdfRenderer();
    const html = await renderAdmissionHtml({
      organisation: testOrganisation,
      event,
      submission: submission(),
      token: token(),
    });
    pdf = await renderer.render(html, { header: 'Demo AB', footer: 'AB12-CD34' });
  }, 120_000);

  afterAll(async () => {
    await renderer?.close();
  });

  it('keeps å ä ö intact through the embedded font', async () => {
    const text = squash(await extractText(pdf));
    expect(text).toContain('BjörnÖberg');
    expect(text).toContain('Vårmötet2026');
    expect(text).toContain('NäringslivetsHus');
  });

  it('prints the reference and the running header', async () => {
    const text = squash(await extractText(pdf));
    expect(text).toContain('AB12-CD34');
    expect(text).toContain('DemoAB');
  });

  it('produces a plausible single-page document rather than an empty file', async () => {
    const doc = await getDocument({ data: new Uint8Array(pdf), useSystemFonts: false }).promise;
    expect(doc.numPages).toBe(1);
    expect(pdf.byteLength).toBeGreaterThan(5_000);
  });
});

describe('the token in the document verifies', () => {
  it('round-trips from signing to verification', () => {
    const issued = token();
    expect(verifyAdmissionToken(issued, event.id, deriveQrKey(SECRET))).toEqual({
      ok: true,
      reference: 'AB12-CD34',
    });
  });
});

function squash(value: string): string {
  return value.replace(/\s+/g, '');
}

async function extractText(pdf: Buffer): Promise<string> {
  const doc = await getDocument({ data: new Uint8Array(pdf), useSystemFonts: false }).promise;
  let text = '';
  for (let page = 1; page <= doc.numPages; page += 1) {
    const content = await (await doc.getPage(page)).getTextContent();
    text += content.items.map((item) => ('str' in item ? item.str : '')).join(' ');
  }
  return text;
}
