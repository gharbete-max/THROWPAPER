import { z } from 'zod';
import { MinorAmount } from '../api/common.js';
import { PaymentMethod } from '../invoicing/api.js';

/**
 * What a person kept after reviewing a supplier invoice: the record that leaves the review screen
 * as JSON or CSV, and the figures a payment note is made from.
 *
 * It holds only what was read and confirmed. Nothing is computed into it: a VAT amount is the one
 * the page printed, a due date the one the page printed. `keptDespiteFailedCheck` names the fields
 * whose check digit failed and which the person kept as they were anyway, so a record never looks
 * more sure than it was.
 *
 * ## Why this does not feed `invoicing/` directly
 *
 * `InvoiceInput` describes an invoice this organisation *sends* — a recipient, lines, the issuer's
 * own giro agreement. A supplier invoice is the other direction (a payable) and has none of those.
 * `bank` reuses the invoicing payment method names so a later payables feature can share them;
 * nothing else is shared, and nothing here pretends to be an invoice.
 */
export const PayableFieldKey = z.enum(['total', 'currency', 'dueDate', 'bank', 'reference', 'vat']);
export type PayableFieldKey = z.infer<typeof PayableFieldKey>;

export const ReviewedPayable = z.object({
  version: z.literal(1),
  total: MinorAmount,
  currency: z.string().regex(/^[A-Z]{3}$/),
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  bank: z.object({ method: PaymentMethod, account: z.string().trim().min(1).max(64) }).nullable(),
  reference: z
    .object({ kind: z.enum(['ocr', 'rf', 'text']), value: z.string().trim().min(1).max(64) })
    .nullable(),
  vat: MinorAmount.nullable(),
  keptDespiteFailedCheck: z.array(PayableFieldKey),
  reviewedAt: z.string().datetime(),
});
export type ReviewedPayable = z.infer<typeof ReviewedPayable>;

/** Minor units as a plain decimal: `125000` is `1250.00`. For a spreadsheet, not for display. */
export function decimalOf(minor: string): string {
  const negative = minor.startsWith('-');
  const digits = (negative ? minor.slice(1) : minor).padStart(3, '0');
  return `${negative ? '-' : ''}${digits.slice(0, -2)}.${digits.slice(-2)}`;
}

/** A cell a spreadsheet will not run as a formula (OWASP CSV injection): quoted, defanged. */
function cell(text: string): string {
  // A plain decimal (`-123.45`, a credit note) is a number, not a formula: leave it one.
  const safe = /^[=+\-@\t\r]/.test(text) && !/^-\d+\.\d{2}$/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export const CSV_COLUMNS = [
  'total',
  'currency',
  'due_date',
  'bank_method',
  'bank_account',
  'reference_kind',
  'reference',
  'vat',
  'kept_despite_failed_check',
  'reviewed_at',
] as const;

/** One header row and one record row. Amounts are plain decimals with a point. */
export function payableCsv(record: ReviewedPayable): string {
  const row = [
    decimalOf(record.total),
    record.currency,
    record.dueDate ?? '',
    record.bank?.method ?? '',
    record.bank?.account ?? '',
    record.reference?.kind ?? '',
    record.reference?.value ?? '',
    record.vat === null ? '' : decimalOf(record.vat),
    record.keptDespiteFailedCheck.join(' '),
    record.reviewedAt,
  ];
  return `${CSV_COLUMNS.join(',')}\n${row.map(cell).join(',')}\n`;
}

export function payableJson(record: ReviewedPayable): string {
  return `${JSON.stringify(record, null, 2)}\n`;
}
