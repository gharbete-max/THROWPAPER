import { buildOcr } from './ocr.js';
import { invoiceTotals, lineTotals } from './totals.js';
import type { CreateInvoice, InvoiceLine, PaymentDetails } from './api.js';

/**
 * Turning a request into the invoice that will actually be stored.
 *
 * One function, so the totals, the reference and the public token are produced together and cannot
 * drift apart. The alternative was a route handler doing all three inline, which works until the
 * batch endpoint does it slightly differently and half the invoices carry a reference built under
 * the other giro agreement.
 *
 * It is deliberately pure: no clock, no random source, no database. The number and the token come
 * in from the caller, because both are things only the database can promise are unique, and a
 * function that quietly generated them would look like it was making that promise.
 */

export interface BuildInvoiceInput {
  /** Sequential per organisation, allocated by the database. */
  readonly number: number;
  /** Random, allocated by the caller. Not the OCR — see the schema for why. */
  readonly publicToken: string;
  readonly request: CreateInvoice;
}

export interface BuiltLine extends InvoiceLine {
  readonly position: number;
  readonly vatAmount: string;
}

export interface BuiltInvoice {
  readonly number: number;
  readonly ocr: string;
  readonly publicToken: string;
  readonly lines: readonly BuiltLine[];
  /** Minor units, as decimal strings, ready for the wire and for the row. */
  readonly net: string;
  readonly vat: string;
  readonly total: string;
}

/**
 * How wide the number is written before the control digits are added.
 *
 * Six, which makes an ordinary reference eight digits — the length these actually are in the wild,
 * and long enough that the control digits are guarding something.
 *
 * It exists because the first version did not have it, and invoice number 1 produced a three-digit
 * reference that `buildOcr` refused as too short. An organisation's *first ever invoice* could not
 * be issued. Padding is also why this is a fixed constant rather than a minimum: a number padded to
 * different widths on different days is the same invoice with two different references, and a bank
 * would treat those as two debts.
 */
export const OCR_BASE_WIDTH = 6;

/**
 * The reference is built from the invoice number, and nothing else.
 *
 * Not from the date, not from the tenant, not from a random draw. A sequential number is the only
 * base guaranteed unique per organisation without a second lookup, and that uniqueness is already
 * enforced by an index — so the reference inherits the guarantee rather than needing one of its
 * own. Past a million invoices the base simply grows; the number is still unique, so the reference
 * still is.
 */
export function ocrForInvoice(number: number, payment: PaymentDetails): string {
  if (!Number.isInteger(number) || number < 1) {
    throw new RangeError('An invoice number is a positive whole number');
  }
  const base = String(number).padStart(OCR_BASE_WIDTH, '0');
  return buildOcr(base, { lengthControl: payment.ocrLengthControl });
}

export function buildInvoice(input: BuildInvoiceInput): BuiltInvoice {
  const { number, publicToken, request } = input;

  const lines = request.lines.map((line, position) => {
    const totals = lineTotals({
      quantity: line.quantity,
      unitAmount: line.unitAmount,
      vatRateBasisPoints: line.vatRateBasisPoints,
    });

    return {
      ...line,
      position,
      amount: totals.amount.toString(),
      vatAmount: totals.vat.toString(),
    };
  });

  const totals = invoiceTotals(
    request.lines.map((line) => ({
      quantity: line.quantity,
      unitAmount: line.unitAmount,
      vatRateBasisPoints: line.vatRateBasisPoints,
    })),
  );

  return {
    number,
    ocr: ocrForInvoice(number, request.payment),
    publicToken,
    lines,
    net: totals.net.toString(),
    vat: totals.vat.toString(),
    total: totals.total.toString(),
  };
}
