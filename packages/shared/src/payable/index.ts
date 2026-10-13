/**
 * Reading a supplier invoice — `docs/HANDOVER.md` decision 5. Pure and deterministic: label lists,
 * regular expressions and check digits, no model (ADR 0019). Its own subpath
 * (`@tp/shared/payable`) so only the screen that reads an invoice loads it.
 *
 * Not to be confused with `invoicing/ocr.ts`, the Swedish OCR *number* (a payment reference);
 * "optical reading" of a page happens in the browser (`apps/forms`), and only hands this its words.
 */
export * from './amount.js';
export * from './checks.js';
export * from './date.js';
export * from './read.js';
export * from './record.js';
export type { PayableWord, Where } from './rows.js';
