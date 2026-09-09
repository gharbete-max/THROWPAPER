import type { FastifyInstance } from 'fastify';
import { api, invoicing as invoicingSchemas } from '@tp/shared';
import { isValidOcr } from '@tp/shared/invoicing';
import type { AuthGuardDeps } from '../auth/plugin.js';
import { requireAuth } from '../auth/plugin.js';
import type { InvoiceRecord, Repositories } from '../db/repositories/index.js';

/**
 * The invoices an organisation has raised, for the people who raised them.
 *
 * The tenant's half of this has existed since invoicing landed — `/i/:token`, no account, no
 * bearer. The operator's half did not, which meant a book of invoices nobody inside the
 * organisation could see: they were created, numbered, given a reference a bank would match on,
 * and then only reachable by whoever still had the link. This is the list.
 *
 * Read-only on purpose. Raising invoices is a *run* — a month's rent across a property, all or
 * nothing, with a test mode in front of it — and a `POST /v1/invoices` that quietly made one at a
 * time would be a second way to do the thing the run exists to do carefully.
 *
 * ## Amounts
 *
 * Strings of minor units on the wire, bigint everywhere inside, converted exactly once on the way
 * out. Same rule as the ledger, for the same reason: rule 5 says money is never a float, and a
 * number that survives JSON is a number that has already been one.
 */
export function registerInvoiceRoutes(
  app: FastifyInstance,
  deps: { repos: Repositories; guard: AuthGuardDeps },
): void {
  const authenticated = requireAuth(deps.guard);

  app.get('/v1/invoices', {
    preHandler: authenticated,
    schema: {
      tags: ['invoicing'],
      response: {
        200: invoicingSchemas.InvoiceListResponse,
        401: api.ErrorResponse,
        403: api.ErrorResponse,
      },
    },
    handler: async (request, reply) => {
      const auth = request.auth;
      if (!auth) {
        return reply
          .code(401)
          .send({ error: { code: 'unauthenticated', message: 'Sign in first' } });
      }

      const invoices = await deps.repos.invoices.listInvoices(auth.organisation.id);

      /*
       * Newest first, and by number rather than by date.
       *
       * Two invoices raised in the same run share an issue date to the second, so a date sort puts
       * them in whatever order the database felt like. The number is sequential per organisation
       * and never reused, which makes it the only total order there is.
       */
      const ordered = [...invoices].sort((a, b) => b.number - a.number);

      /*
       * What is still owed: everything issued or sent and not yet paid.
       *
       * A draft has not been sent to anybody, and a cancelled one is a decision not to collect.
       * Counting either would overstate the number this screen exists to show.
       */
      const outstanding = ordered
        .filter((invoice) => invoice.status === 'issued' || invoice.status === 'sent')
        .reduce((sum, invoice) => sum + invoice.totalMinor, 0n);

      return reply.send({
        invoices: ordered.map(toInvoiceResponse),
        outstanding: outstanding.toString(),
        /*
         * One currency, taken from the invoices themselves.
         *
         * An organisation billing in two would make `outstanding` a sum of unlike things. It
         * cannot today — a run carries one currency — so the honest thing is to report the one in
         * use and let that assumption break loudly here rather than quietly in a total.
         */
        currency: ordered[0]?.currency ?? 'SEK',
      });
    },
  });
}

function toInvoiceResponse(invoice: InvoiceRecord): invoicingSchemas.Invoice {
  return {
    id: invoice.id,
    number: invoice.number,
    ocr: invoice.ocr,
    status: invoice.status,
    currency: invoice.currency as invoicingSchemas.Currency,
    recipient: {
      name: invoice.recipientName,
      ...(invoice.recipientEmail ? { email: invoice.recipientEmail } : {}),
      ...(invoice.recipientAddress ? { address: invoice.recipientAddress } : {}),
      ...(invoice.recipientReference ? { externalReference: invoice.recipientReference } : {}),
    },
    subject: invoice.subject,
    ...(invoice.periodStart ? { periodStart: invoice.periodStart } : {}),
    ...(invoice.periodEnd ? { periodEnd: invoice.periodEnd } : {}),
    issuedOn: invoice.issuedOn,
    dueOn: invoice.dueOn,
    lines: invoice.lines.map((line) => ({
      description: line.description,
      quantity: line.quantityThousandths.toString(),
      unitAmount: line.unitAmountMinor.toString(),
      amount: line.amountMinor.toString(),
      vatRateBasisPoints: line.vatRateBasisPoints,
    })),
    total: invoice.totalMinor.toString(),
    vatTotal: invoice.vatMinor.toString(),
    payment: {
      method: invoice.paymentMethod as invoicingSchemas.PaymentMethod,
      account: invoice.paymentAccount,
      /*
       * Read back off the reference rather than invented.
       *
       * The flag belongs to the recipient's giro agreement, not to an invoice, so the record does
       * not keep a copy of it. The OCR it produced does: a reference built with a length digit
       * only validates as one. Defaulting to `true` here would quietly relabel every plusgiro
       * agreement that does not use one.
       */
      ocrLengthControl: isValidOcr(invoice.ocr, { lengthControl: true }),
    },
    publicToken: invoice.publicToken,
    createdAt: invoice.createdAt.toISOString(),
    ...(invoice.sentAt ? { sentAt: invoice.sentAt.toISOString() } : {}),
    ...(invoice.paidAt ? { paidAt: invoice.paidAt.toISOString() } : {}),
  };
}
