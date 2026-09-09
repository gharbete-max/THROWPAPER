import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  adminUser,
  bearer,
  createTestHarness,
  signIn,
  testOrganisation,
  type TestHarness,
} from './test-support.js';
import type { InvoiceRecord } from './db/repositories/types.js';

/** Minimal, but a real record: the route loads it before it ever reaches the renderer. */
const INVOICE: InvoiceRecord = {
  id: 'i1',
  organisationId: testOrganisation.id,
  batchId: null,
  number: 1042,
  ocr: '00104281',
  status: 'sent',
  currency: 'SEK',
  recipientName: 'Anna Lindqvist',
  recipientEmail: null,
  recipientAddress: null,
  recipientReference: null,
  subject: { 'sv-SE': 'Hyra' },
  periodStart: null,
  periodEnd: null,
  issuedOn: '2026-09-20',
  dueOn: '2026-09-30',
  netMinor: 100_000n,
  vatMinor: 0n,
  totalMinor: 100_000n,
  paymentMethod: 'bankgiro',
  paymentAccount: '123-4567',
  publicToken: 'c'.repeat(40),
  sentAt: null,
  paidAt: null,
  createdAt: new Date('2026-09-20T08:00:00Z'),
  lines: [
    {
      id: 'l1',
      description: { 'sv-SE': 'Hyra' },
      quantityThousandths: 1000n,
      unitAmountMinor: 100_000n,
      amountMinor: 100_000n,
      vatRateBasisPoints: 0,
      vatMinor: 0n,
      position: 0,
    },
  ],
};

/**
 * What an error looks like from outside.
 *
 * Two things were wrong with the default. Fastify answers `{ statusCode, error, message }`, which
 * is not the `ErrorResponse` contract every route in this app declares — so a client reading
 * `body.error.code` got `undefined` for exactly the responses it needed to branch on. And the
 * `message` of an unexpected throw is whatever the layer below said; the layer below is Postgres,
 * so a constraint violation would have replied with the constraint name and the column.
 *
 * These tests pin both halves: the shape is always ours, and a 5xx says nothing about the inside.
 */
let harness: TestHarness;
let token: string;

beforeEach(async () => {
  harness = await createTestHarness();
  token = (await signIn(harness, adminUser.email)).accessToken;
});

afterEach(async () => {
  await harness.close();
});

describe('error responses', () => {
  /** A validation failure is ours to explain, so the message survives. */
  it('answers a bad request in the app’s own shape', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/forms',
      headers: bearer(token),
      payload: { slug: 'Vår Anmälan!', title: { 'sv-SE': 'Anmälan' } },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body).toHaveProperty('error.code');
    expect(body).toHaveProperty('error.message');
    // Not Fastify's default shape.
    expect(body).not.toHaveProperty('statusCode');
  });

  it('answers an unauthenticated request in the same shape', async () => {
    const response = await harness.app.inject({ method: 'GET', url: '/v1/forms' });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toHaveProperty('error.code');
  });

  /**
   * The one that matters: an unexpected throw must not narrate itself to the caller.
   *
   * Driven through a real route rather than a test-only one, because the thing being tested is
   * the handler the real routes actually hit. The invoice PDF route calls the renderer without
   * catching, so a renderer that throws is the honest way to produce an unhandled 5xx — and the
   * message it throws is the kind Postgres throws, naming a constraint, a column and a value.
   */
  it('tells a caller nothing about an unexpected failure', async () => {
    const leak =
      'duplicate key value violates unique constraint "users_org_email_idx" ' +
      'DETAIL: Key (email)=(alva@example.com) already exists.';

    const exploding = await createTestHarness(
      { invoices: [INVOICE] },
      {
        renderer: {
          rendered: [],
          async render() {
            throw new Error(leak);
          },
          async close() {},
        },
      },
    );

    try {
      const response = await exploding.app.inject({
        method: 'GET',
        url: `/i/${INVOICE.publicToken}/pdf`,
      });

      expect(response.statusCode).toBe(500);

      const raw = response.body;
      for (const secret of [
        'users_org_email_idx',
        'alva@example.com',
        'unique constraint',
        'DETAIL',
      ]) {
        expect(raw, `leaked ${secret}`).not.toContain(secret);
      }
      expect(raw).not.toMatch(/\.ts:\d+|at Object\.|node_modules/);

      const body = response.json();
      expect(body.error.code).toBe('internal');
      expect(body.error.message).toBe('Something went wrong. Try again.');
    } finally {
      await exploding.close();
    }
  });
});
