import { describe, expect, it } from 'vitest';
import { isValidOcr } from '@tp/shared/invoicing';
import { createMemoryRepositories } from '../db/repositories/memory.js';
import type { Repositories } from '../db/repositories/types.js';

/**
 * A month's rent across a property, as a run.
 *
 * The behaviour worth pinning is not "an invoice was written down". It is that forty of them get
 * forty different references, that a run is all-or-nothing, and that a test send is distinguishable
 * from a real one afterwards — because each of those failures is discovered late and costs somebody
 * a conversation with a tenant.
 */
const ORG = '00000000-0000-4000-8000-000000000001';

function line(amountMinor: bigint, vatMinor = 0n) {
  return {
    description: { 'sv-SE': 'Hyra', 'en-GB': 'Rent' },
    quantityThousandths: 1000n,
    unitAmountMinor: amountMinor,
    amountMinor,
    vatRateBasisPoints: vatMinor > 0n ? 2500 : 0,
    vatMinor,
  };
}

function tenant(name: string, amountMinor: bigint) {
  return {
    recipientName: name,
    recipientEmail: `${name.toLowerCase().replace(/\s/g, '.')}@example.com`,
    recipientAddress: 'Storgatan 14',
    recipientReference: null,
    subject: { 'sv-SE': 'Hyra', 'en-GB': 'Rent' },
    currency: 'SEK',
    periodStart: '2026-10-01',
    periodEnd: '2026-10-31',
    issuedOn: '2026-09-20',
    dueOn: '2026-09-30',
    paymentMethod: 'bankgiro',
    paymentAccount: '123-4567',
    ocrLengthControl: true,
    lines: [line(amountMinor)],
  };
}

function repos(): Repositories {
  return createMemoryRepositories({
    organisations: [
      {
        id: ORG,
        name: 'Fastighets AB',
        slug: 'fastighets',
        defaultLocale: 'sv-SE',
        supportedLocales: ['sv-SE', 'en-GB'],
      },
    ],
  });
}

describe('a run of invoices', () => {
  it('gives every invoice its own number and its own reference', async () => {
    const store = repos();
    const { invoices } = await store.invoices.createBatch({
      organisationId: ORG,
      name: 'Rent, October 2026',
      createdBy: null,
      invoices: Array.from({ length: 40 }, (_, index) =>
        tenant(`Tenant ${index}`, 800_000n + BigInt(index) * 1000n),
      ),
    });

    expect(invoices).toHaveLength(40);

    const numbers = new Set(invoices.map((invoice) => invoice.number));
    const references = new Set(invoices.map((invoice) => invoice.ocr));
    expect(numbers.size, 'two invoices share a number').toBe(40);
    expect(references.size, 'two invoices share a payment reference').toBe(40);
  });

  it('issues references a bank would accept', async () => {
    const store = repos();
    const { invoices } = await store.invoices.createBatch({
      organisationId: ORG,
      name: 'Rent',
      createdBy: null,
      invoices: [tenant('Anna', 895_000n)],
    });

    expect(isValidOcr(invoices[0]!.ocr)).toBe(true);
  });

  /**
   * A second run continues the numbering rather than restarting it.
   *
   * Restarting would reissue references that are already printed on invoices somebody is holding,
   * and a bank matching a payment would find two.
   */
  it('never reuses a number across runs', async () => {
    const store = repos();
    const first = await store.invoices.createBatch({
      organisationId: ORG,
      name: 'September',
      createdBy: null,
      invoices: [tenant('Anna', 895_000n), tenant('Björn', 750_000n)],
    });
    const second = await store.invoices.createBatch({
      organisationId: ORG,
      name: 'October',
      createdBy: null,
      invoices: [tenant('Anna', 895_000n)],
    });

    const used = first.invoices.map((invoice) => invoice.number);
    expect(used).toEqual([1, 2]);
    expect(second.invoices[0]!.number).toBe(3);
    expect(used).not.toContain(second.invoices[0]!.number);
  });

  it('adds the lines up on the invoice', async () => {
    const store = repos();
    const { invoices } = await store.invoices.createBatch({
      organisationId: ORG,
      name: 'Rent',
      createdBy: null,
      invoices: [
        {
          ...tenant('Anna', 895_000n),
          lines: [line(895_000n), line(24_900n, 6_225n)],
        },
      ],
    });

    const invoice = invoices[0]!;
    expect(invoice.netMinor).toBe(919_900n);
    expect(invoice.vatMinor).toBe(6_225n);
    expect(invoice.totalMinor).toBe(926_125n);
  });

  /**
   * The link token is not the payment reference.
   *
   * An OCR is printed on the invoice and quoted on every bank statement. If it also opened the web
   * page, everybody who handles the payment could read the invoice behind it.
   */
  it('gives the public link its own secret', async () => {
    const store = repos();
    const { invoices } = await store.invoices.createBatch({
      organisationId: ORG,
      name: 'Rent',
      createdBy: null,
      invoices: [tenant('Anna', 895_000n)],
    });

    const invoice = invoices[0]!;
    expect(invoice.publicToken).not.toBe(invoice.ocr);
    expect(invoice.publicToken.length).toBeGreaterThanOrEqual(32);

    const found = await store.invoices.findByPublicToken(invoice.publicToken);
    expect(found?.id).toBe(invoice.id);
  });

  it('does not hand an invoice to a token that is nearly right', async () => {
    const store = repos();
    const { invoices } = await store.invoices.createBatch({
      organisationId: ORG,
      name: 'Rent',
      createdBy: null,
      invoices: [tenant('Anna', 895_000n)],
    });

    const token = invoices[0]!.publicToken;
    expect(await store.invoices.findByPublicToken(token.slice(0, -1))).toBeNull();
    expect(await store.invoices.findByPublicToken(`${token}0`)).toBeNull();
  });
});

describe('sending a run', () => {
  /**
   * Issued and sent are two different states, which is rule 7.
   *
   * Creating forty invoices and posting forty emails are two decisions, and forty emails with a
   * wrong amount on them is not a mistake anybody can take back.
   */
  it('leaves a new run unsent', async () => {
    const store = repos();
    const { batch, invoices } = await store.invoices.createBatch({
      organisationId: ORG,
      name: 'Rent',
      createdBy: null,
      invoices: [tenant('Anna', 895_000n)],
    });

    expect(batch.sentAt).toBeNull();
    expect(invoices[0]!.status).toBe('issued');
    expect(invoices[0]!.sentAt).toBeNull();
  });

  it('stamps the run and its invoices when it really goes', async () => {
    const store = repos();
    const { batch } = await store.invoices.createBatch({
      organisationId: ORG,
      name: 'Rent',
      createdBy: null,
      invoices: [tenant('Anna', 895_000n)],
    });

    const at = new Date('2026-09-21T09:00:00Z');
    await store.invoices.markSent(ORG, batch.id, at);

    const after = await store.invoices.listInvoices(ORG, batch.id);
    expect(after[0]!.status).toBe('sent');
    expect(after[0]!.sentAt).toEqual(at);
  });

  /**
   * A test run must not look like a real one afterwards.
   *
   * It stamps the batch and leaves the invoices alone, because they went to nobody. Marking them
   * would make "was this actually sent to the tenants" unanswerable from the data.
   */
  it('keeps a test distinguishable from the real thing', async () => {
    const store = repos();
    const { batch } = await store.invoices.createBatch({
      organisationId: ORG,
      name: 'Rent',
      createdBy: null,
      invoices: [tenant('Anna', 895_000n)],
    });

    await store.invoices.markTested(ORG, batch.id, new Date('2026-09-20T08:00:00Z'));

    const after = await store.invoices.findBatch(ORG, batch.id);
    expect(after?.lastTestAt).not.toBeNull();
    expect(after?.sentAt, 'a test marked the run as sent').toBeNull();

    const untouched = await store.invoices.listInvoices(ORG, batch.id);
    expect(untouched[0]!.status).toBe('issued');
    expect(untouched[0]!.sentAt).toBeNull();
  });
});

describe('one organisation cannot see another', () => {
  const OTHER = '00000000-0000-4000-8000-000000000002';

  it('scopes every lookup', async () => {
    const store = repos();
    const { batch, invoices } = await store.invoices.createBatch({
      organisationId: ORG,
      name: 'Rent',
      createdBy: null,
      invoices: [tenant('Anna', 895_000n)],
    });

    expect(await store.invoices.findBatch(OTHER, batch.id)).toBeNull();
    expect(await store.invoices.findInvoice(OTHER, invoices[0]!.id)).toBeNull();
    expect(await store.invoices.listInvoices(OTHER)).toHaveLength(0);
  });
});
