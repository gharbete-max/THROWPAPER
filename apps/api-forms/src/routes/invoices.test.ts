import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  adminUser,
  bearer,
  createTestHarness,
  operatorUser,
  signIn,
  testOrganisation,
  type TestHarness,
} from '../test-support.js';
import type { InvoiceRecord } from '../db/repositories/types.js';

/**
 * The operator's side of an invoice: the list, and the file — without the tenant's key.
 *
 * `/i/:token` is the tenant's whole session: a permanent, random string that opens the invoice
 * with no account. The listing used to hand that string to every signed-in operator, for the two
 * links on the Invoices screen. An operator is entitled to the invoice; they are not the tenant,
 * and a credential that never expires does not belong in every staff browser, history entry and
 * screenshot to reach two documents a bearer can fetch. Audit item 14.
 *
 * So the listing carries no token, and the file comes from an authenticated route scoped the way
 * every other operator route is. The tenant's link is untouched and still works.
 */
const TOKEN = 'b'.repeat(40);

const INVOICE: InvoiceRecord = {
  id: '11111111-aaaa-4aaa-8aaa-111111111111',
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
      quantityThousandths: 1000n,
      unitAmountMinor: 919_900n,
      amountMinor: 919_900n,
      vatRateBasisPoints: 0,
      vatMinor: 0n,
      position: 0,
    },
  ],
};

/** Somebody else's invoice, in a different organisation, with an id an operator might guess at. */
const ELSEWHERE: InvoiceRecord = {
  ...INVOICE,
  id: '22222222-bbbb-4bbb-8bbb-222222222222',
  organisationId: '99999999-9999-4999-8999-999999999999',
  number: 7,
  publicToken: 'c'.repeat(40),
};

let harness: TestHarness;
let adminToken: string;
let operatorToken: string;

beforeEach(async () => {
  harness = await createTestHarness({ invoices: [INVOICE, ELSEWHERE] });
  adminToken = (await signIn(harness, adminUser.email)).accessToken;
  operatorToken = (await signIn(harness, operatorUser.email)).accessToken;
});

afterEach(async () => {
  await harness.close();
});

const as = (token: string | null, url: string) =>
  harness.app.inject({ method: 'GET', url, headers: token ? bearer(token) : {} });

describe('the listing', () => {
  it('shows an operator the invoice, but not the tenant’s key', async () => {
    const response = await as(operatorToken, '/v1/invoices');

    expect(response.statusCode).toBe(200);
    const [invoice] = response.json().invoices;
    expect(invoice.number).toBe(1042);
    expect(invoice.total).toBe('926125');
    expect(invoice).not.toHaveProperty('publicToken');
    expect(response.body).not.toContain(TOKEN);
  });
});

describe('the file, for the operator', () => {
  it('is served to a signed-in operator of the organisation', async () => {
    const response = await as(operatorToken, `/v1/invoices/${INVOICE.id}/pdf`);

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('application/pdf');
    expect(response.headers['content-disposition']).toBe('attachment; filename="1042.pdf"');
    expect(response.headers['cache-control']).toBe('no-store, private');
    expect(harness.renderer.rendered.at(-1)).toContain('Anna Lindqvist');
  });

  it('is not served for an invoice of another organisation', async () => {
    const response = await as(adminToken, `/v1/invoices/${ELSEWHERE.id}/pdf`);
    expect(response.statusCode).toBe(404);
    expect(harness.renderer.rendered).toHaveLength(0);
  });

  it('needs a session', async () => {
    expect((await as(null, `/v1/invoices/${INVOICE.id}/pdf`)).statusCode).toBe(401);
  });
});

/** The tenant’s half is what this is all in aid of; it must not have moved. */
describe('the tenant’s link', () => {
  it('still opens the page and the file', async () => {
    expect((await as(null, `/i/${TOKEN}`)).statusCode).toBe(200);
    expect((await as(null, `/i/${TOKEN}/pdf`)).statusCode).toBe(200);
  });
});
