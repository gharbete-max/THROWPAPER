import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestHarness, testOrganisation, type TestHarness } from '../test-support.js';
import type { InvoiceRecord } from '../db/repositories/types.js';

/**
 * The two ways a tenant gets their invoice: the page they open, and the file they keep.
 *
 * They have no account and never will — the long random token in the URL is the whole session.
 * So these tests care about what a stranger holding a link can and cannot reach, and about the
 * two renderings agreeing: a page and an attachment that disagree about an amount is a support
 * call at best and a refused payment at worst.
 */
const TOKEN = 'a'.repeat(40);

const INVOICE: InvoiceRecord = {
  id: 'i1',
  organisationId: testOrganisation.id,
  batchId: null,
  number: 1042,
  ocr: '00104281',
  status: 'sent',
  currency: 'SEK',
  recipientName: 'Anna Lindqvist',
  recipientEmail: 'anna@example.com',
  recipientAddress: 'Storgatan 14, lgh 1201',
  recipientReference: '1201',
  subject: { 'sv-SE': 'Hyra, oktober 2026', 'en-GB': 'Rent, October 2026' },
  periodStart: '2026-10-01',
  periodEnd: '2026-10-31',
  issuedOn: '2026-09-20',
  dueOn: '2026-09-30',
  netMinor: 919_900n,
  vatMinor: 6_225n,
  totalMinor: 926_125n,
  paymentMethod: 'bankgiro',
  paymentAccount: '123-4567',
  publicToken: TOKEN,
  sentAt: new Date('2026-09-20T09:00:00Z'),
  paidAt: null,
  createdAt: new Date('2026-09-20T08:00:00Z'),
  lines: [
    {
      id: 'l1',
      description: { 'sv-SE': 'Hyra', 'en-GB': 'Rent' },
      quantityThousandths: 67_500n,
      unitAmountMinor: 13_628n,
      amountMinor: 895_000n,
      vatRateBasisPoints: 0,
      vatMinor: 0n,
      position: 0,
    },
    {
      id: 'l2',
      description: { 'sv-SE': 'Kabel-TV', 'en-GB': 'Cable television' },
      quantityThousandths: 1000n,
      unitAmountMinor: 24_900n,
      amountMinor: 24_900n,
      vatRateBasisPoints: 2500,
      vatMinor: 6_225n,
      position: 1,
    },
  ],
};

let harness: TestHarness;

beforeEach(async () => {
  harness = await createTestHarness({ invoices: [INVOICE] });
});

afterEach(async () => {
  await harness.close();
});

const get = (url: string) => harness.app.inject({ method: 'GET', url });

describe('the invoice page', () => {
  it('serves it to anybody holding the token, with no bearer', async () => {
    const response = await get(`/i/${TOKEN}`);

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.body).toContain('1042');
  });

  it('offers the same invoice as a file', async () => {
    const response = await get(`/i/${TOKEN}`);
    expect(response.body).toContain(`/i/${TOKEN}/pdf`);
  });

  /** The reader's language has to travel with them, or the file arrives in another one. */
  it('carries the chosen language onto the download link', async () => {
    const response = await get(`/i/${TOKEN}?lang=en-GB`);
    expect(response.body).toContain(`/i/${TOKEN}/pdf?lang=en-GB`);
    expect(response.body).toContain('Download as PDF');
  });
});

describe('the invoice as a PDF', () => {
  it('renders the print variant and answers with a PDF', async () => {
    const response = await get(`/i/${TOKEN}/pdf`);

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('application/pdf');
    expect(response.rawPayload.subarray(0, 4).toString()).toBe('%PDF');

    // `print`, not `web`: the ground behind the sheet belongs to a screen.
    const [html] = harness.renderer.rendered;
    expect(html).toBeTruthy();
    expect(html).not.toContain('class="download"');
  });

  /**
   * Named for the invoice number, not the token.
   *
   * The token is the reader's credential. A filename outlives the download: it sits in a folder,
   * in a backup, and gets read out over the phone when somebody asks for the invoice again.
   */
  it('names the file after the invoice, never the token', async () => {
    const response = await get(`/i/${TOKEN}/pdf`);

    expect(response.headers['content-disposition']).toBe('attachment; filename="1042.pdf"');
    expect(response.headers['content-disposition']).not.toContain(TOKEN);
  });

  /** Somebody's name, address and what they owe — the same reasoning as the page. */
  it('is never cached or indexed', async () => {
    const response = await get(`/i/${TOKEN}/pdf`);

    expect(response.headers['cache-control']).toBe('no-store, private');
    expect(response.headers['x-robots-tag']).toBe('noindex, nofollow');
  });

  it('renders in the language asked for', async () => {
    await get(`/i/${TOKEN}/pdf?lang=en-GB`);

    const [html] = harness.renderer.rendered;
    expect(html).toContain('Rent, October 2026');
  });

  /**
   * The page and the file are one document. If they can disagree about an amount, the reason will
   * be that somebody changed one call site and not the other — so the totals are compared rather
   * than assumed.
   */
  it('agrees with the page about what is owed', async () => {
    const page = (await get(`/i/${TOKEN}`)).body;
    await get(`/i/${TOKEN}/pdf`);
    const [file] = harness.renderer.rendered;

    for (const amount of ['9 199,00', '62,25', '9 261,25']) {
      expect(page, `page is missing ${amount}`).toContain(amount);
      expect(file, `file is missing ${amount}`).toContain(amount);
    }
  });
});

describe('a token that buys nothing', () => {
  /**
   * The same answer for a token that never existed and one belonging to somebody else — on both
   * routes. A 404 on the page and a 500 on the file would be a difference worth probing.
   */
  it.each([`/i/${'b'.repeat(40)}`, `/i/${'b'.repeat(40)}/pdf`])(
    'answers 404 for %s',
    async (url) => {
      const response = await get(url);

      expect(response.statusCode).toBe(404);
      expect(response.headers['content-type']).toContain('text/html');
      expect(response.body).not.toContain('1042');
    },
  );

  /** A token that is not shaped like one this app issued never reaches a repository at all. */
  it.each(['/i/nope', '/i/nope/pdf'])('refuses a malformed token at %s', async (url) => {
    expect((await get(url)).statusCode).toBe(400);
  });

  /** Rendering never started, so a stranger cannot make the server launch Chromium. */
  it('does not render anything for an unknown token', async () => {
    await get(`/i/${'b'.repeat(40)}/pdf`);
    expect(harness.renderer.rendered).toHaveLength(0);
  });
});
