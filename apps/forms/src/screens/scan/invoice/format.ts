import { payableCsv, payableJson, type ReviewedPayable } from '@tp/shared/payable';
import type { Translator } from '@tp/i18n';

/** Minor units for a person: grouping and decimal mark of their language, exact (bigint). */
export function amountText(minor: bigint, locale: string): string {
  const negative = minor < 0n;
  const absolute = negative ? -minor : minor;
  const format = new Intl.NumberFormat(locale);
  const decimal = format.formatToParts(1.5).find((part) => part.type === 'decimal')?.value ?? '.';
  const fraction = (absolute % 100n).toString().padStart(2, '0');
  return `${negative ? '-' : ''}${format.format(absolute / 100n)}${decimal}${fraction}`;
}

/** An ISO date in the person's language, with the ISO form beside it so nothing is ambiguous. */
export function dateText(iso: string, locale: string): string {
  const long = new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(
    new Date(`${iso}T00:00:00Z`),
  );
  return `${long} (${iso})`;
}

/**
 * The payment note: facts of the record, one to a line, each line a sentence from the catalogue.
 * It says what the page said and nothing more — no terms, no obligations.
 */
export function paymentNote(record: ReviewedPayable, t: Translator, locale: string): string {
  const lines = [
    t('invoiceScan.note.amount', {
      amount: `${amountText(BigInt(record.total), locale)} ${record.currency}`,
    }),
  ];
  if (record.bank) {
    lines.push(
      t('invoiceScan.note.to', {
        method: t(`invoiceScan.method.${record.bank.method}`),
        account: record.bank.account,
      }),
    );
  }
  if (record.reference) {
    lines.push(t('invoiceScan.note.reference', { reference: record.reference.value }));
  }
  if (record.dueDate)
    lines.push(t('invoiceScan.note.due', { date: dateText(record.dueDate, locale) }));
  if (record.vat !== null) {
    lines.push(t('invoiceScan.note.vat', { amount: amountText(BigInt(record.vat), locale) }));
  }
  return lines.join('\n');
}

export const recordFiles = (record: ReviewedPayable) => ({
  json: new Blob([payableJson(record)], { type: 'application/json' }),
  csv: new Blob([payableCsv(record)], { type: 'text/csv;charset=utf-8' }),
});
