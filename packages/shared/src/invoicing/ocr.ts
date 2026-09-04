/**
 * The Swedish OCR reference: the number a payer types, and the bank matches a payment on.
 *
 * ## What it is
 *
 * An OCR reference (`OCR-referens`) is the payment reference used with Bankgiro and Plusgiro. The
 * payer copies it from the invoice into their bank; the bank returns it with the payment; the
 * recipient's system matches it back to the invoice. It is the whole mechanism by which a rent
 * payment finds the right tenant without anybody reading a note.
 *
 * It is digits only. Not because of a style preference — the fields on a giro form and in a bank's
 * payment file are numeric, and a letter in a reference is a payment that fails to import.
 *
 * ## Why a check digit, and why a length digit
 *
 * Both exist to catch a typo at the moment it is made, in the payer's bank, rather than a week
 * later in a reconciliation that does not balance.
 *
 * The **check digit** is Luhn (modulus 10). It catches every single-digit error and almost every
 * transposition of two adjacent digits, which together are the overwhelming majority of the
 * mistakes people actually make copying a number off a page.
 *
 * The **length digit** catches the error Luhn cannot: a digit dropped or added. Luhn over a
 * shortened number is simply a different valid-looking number. Recording the length inside the
 * reference means a truncated one fails immediately.
 *
 * Bankgirot calls the combination "OCR med längdkontroll och kontrollsiffra", and it is what this
 * module produces. The layout is:
 *
 *     <base digits><length digit><check digit>
 *
 * where the length digit is the total length of the finished reference modulo 10, and the check
 * digit is Luhn over everything before it.
 *
 * ## Uniqueness
 *
 * This module makes a reference from a number. It does **not** make it unique — nothing in a pure
 * function can. Uniqueness is the database's job, through a unique index on the organisation and
 * the reference, and through the invoice number this is derived from being sequential per
 * organisation. A reference that repeats is two invoices a bank cannot tell apart, so it is worth
 * being explicit about which layer is responsible: this one is not.
 */

/** Bankgirot accepts references up to 25 digits. Beyond that a payment file rejects the record. */
export const MAX_OCR_LENGTH = 25;

/**
 * The shortest reference worth issuing.
 *
 * Two digits of payload plus the two control digits. Shorter than this and the check digit is
 * guarding almost nothing, because there is almost nothing to mistype.
 */
export const MIN_OCR_LENGTH = 4;

export class OcrError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OcrError';
  }
}

/**
 * The Luhn check digit for a run of digits.
 *
 * Doubling starts at the rightmost digit of the payload, because the check digit that will be
 * appended occupies the position after it. Getting this offset wrong produces a number that
 * validates against itself and against nothing else, which is the sort of bug that is invisible
 * until a bank rejects a file.
 */
export function luhnCheckDigit(payload: string): number {
  if (!/^\d+$/.test(payload)) throw new OcrError('A Luhn payload is digits only');

  let sum = 0;
  let double = true;

  for (let index = payload.length - 1; index >= 0; index -= 1) {
    let digit = payload.charCodeAt(index) - 48;
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }

  return (10 - (sum % 10)) % 10;
}

export interface OcrOptions {
  /**
   * Whether to include the length digit.
   *
   * On by default, and it should stay on: it is the only protection against a dropped digit. The
   * option exists because a recipient's giro agreement specifies which control their bank applies,
   * and an OCR with a length digit sent to an agreement expecting only a check digit is rejected
   * on every payment. That is a setting on the agreement, not a preference.
   */
  readonly lengthControl?: boolean;
}

/**
 * Build a reference from a base number.
 *
 * The base is normally the invoice number. Leading zeros are preserved: `"0042"` and `"42"` are
 * different references, because the length differs and the length is part of the reference.
 */
export function buildOcr(base: string | number, options: OcrOptions = {}): string {
  const lengthControl = options.lengthControl ?? true;
  const digits = String(base);

  if (!/^\d+$/.test(digits)) throw new OcrError('An OCR base is digits only');

  /* Two control digits with length control, one without. */
  const controlDigits = lengthControl ? 2 : 1;
  const total = digits.length + controlDigits;

  if (total > MAX_OCR_LENGTH) {
    throw new OcrError(
      `An OCR reference may be at most ${MAX_OCR_LENGTH} digits; this would be ${total}`,
    );
  }
  if (total < MIN_OCR_LENGTH) {
    throw new OcrError(
      `An OCR reference should be at least ${MIN_OCR_LENGTH} digits; this would be ${total}`,
    );
  }

  const payload = lengthControl ? `${digits}${total % 10}` : digits;
  return `${payload}${luhnCheckDigit(payload)}`;
}

/**
 * Whether a reference somebody typed is one this scheme could have produced.
 *
 * The point of the control digits is to reject a typo where it is made, so this is what a form
 * field calls before accepting a reference. It answers "is this well formed", not "does this
 * invoice exist" — the second is a database question.
 */
export function isValidOcr(reference: string, options: OcrOptions = {}): boolean {
  const lengthControl = options.lengthControl ?? true;

  if (!/^\d+$/.test(reference)) return false;
  if (reference.length < MIN_OCR_LENGTH || reference.length > MAX_OCR_LENGTH) return false;

  const payload = reference.slice(0, -1);
  const check = reference.charCodeAt(reference.length - 1) - 48;
  if (luhnCheckDigit(payload) !== check) return false;

  if (!lengthControl) return true;

  /* The length digit records the length of the whole reference, check digit included. */
  const lengthDigit = reference.charCodeAt(reference.length - 2) - 48;
  return reference.length % 10 === lengthDigit;
}

/**
 * Group a reference for printing, so a person can read it back without losing their place.
 *
 * From the right, because the control digits are the end and a payer checks the tail against the
 * page. Grouping from the left would put a short group at the end and make two references of
 * different lengths look alike where they differ.
 */
export function formatOcr(reference: string): string {
  const groups: string[] = [];
  for (let end = reference.length; end > 0; end -= 4) {
    groups.unshift(reference.slice(Math.max(0, end - 4), end));
  }
  return groups.join(' ');
}
