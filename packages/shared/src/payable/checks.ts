import { luhnCheckDigit } from '../invoicing/ocr.js';

/**
 * Check digits for the numbers an invoice asks a person to pay: Luhn for Swedish giro numbers and
 * OCR references, mod 97 for IBAN (ISO 13616) and the RF creditor reference (ISO 11649).
 *
 * Pure, deterministic, no model. A number whose check fails is not corrected here: it is reported
 * as failed and the person decides (`docs/HANDOVER.md`, decision 5).
 */

/** `passed`: the number's own check digit holds. `failed`: it does not. `none`: it has none. */
export type Check = 'passed' | 'failed' | 'none';

export interface Checked {
  /** The number in its normal printed form (capitals, the bank's spacing). */
  value: string;
  check: Check;
}

/** Luhn over the whole number, check digit included: what a bankgiro or plusgiro number obeys. */
export function luhnValid(digits: string): boolean {
  if (!/^\d{2,}$/.test(digits)) return false;
  return luhnCheckDigit(digits.slice(0, -1)) === digits.charCodeAt(digits.length - 1) - 48;
}

const digitsOf = (text: string) => text.replace(/[\s-]/g, '');

/** A bankgiro as the bank prints it: seven digits as 3-4, eight as 4-4. Anything else unchanged. */
export function normaliseBankgiro(text: string): string {
  const digits = digitsOf(text);
  if (!/^\d{7,8}$/.test(digits)) return text.trim();
  return `${digits.slice(0, -4)}-${digits.slice(-4)}`;
}

export function checkBankgiro(text: string): Checked {
  const digits = digitsOf(text);
  const ok = /^\d{7,8}$/.test(digits) && luhnValid(digits);
  return { value: normaliseBankgiro(text), check: ok ? 'passed' : 'failed' };
}

/** A plusgiro as printed: all but the last digit, a hyphen, the check digit. */
export function checkPlusgiro(text: string): Checked {
  const digits = digitsOf(text);
  const shaped = /^\d{2,8}$/.test(digits);
  return {
    value: shaped ? `${digits.slice(0, -1)}-${digits.slice(-1)}` : text.trim(),
    check: shaped && luhnValid(digits) ? 'passed' : 'failed',
  };
}

/**
 * The length of an IBAN by country (ISO 13616 registry), for the countries invoices here come
 * from. A country not in the list fails: an IBAN whose length cannot be checked is not passed.
 */
export const IBAN_LENGTHS: Readonly<Record<string, number>> = {
  AT: 20,
  BE: 16,
  CH: 21,
  CZ: 24,
  DE: 22,
  DK: 18,
  EE: 20,
  ES: 24,
  FI: 18,
  FO: 18,
  FR: 27,
  GB: 22,
  GL: 18,
  IE: 22,
  IS: 26,
  IT: 27,
  LT: 20,
  LU: 20,
  LV: 21,
  NL: 18,
  NO: 15,
  PL: 28,
  PT: 25,
  SE: 24,
};

/** Mod 97 over a string of digits and capitals (A = 10 … Z = 35), without a big number. */
function mod97(text: string): number {
  let remainder = 0;
  for (const char of text) {
    const code = char.charCodeAt(0);
    const piece = code >= 65 ? String(code - 55) : char;
    for (const digit of piece) remainder = (remainder * 10 + (digit.charCodeAt(0) - 48)) % 97;
  }
  return remainder;
}

const groupsOfFour = (compact: string) => compact.replace(/(.{4})/g, '$1 ').trim();
const rotated = (compact: string) => compact.slice(4) + compact.slice(0, 4);

export function checkIban(text: string): Checked {
  const compact = text.replace(/\s/g, '').toUpperCase();
  const value = groupsOfFour(compact);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(compact)) return { value, check: 'failed' };
  if (IBAN_LENGTHS[compact.slice(0, 2)] !== compact.length) return { value, check: 'failed' };
  return { value, check: mod97(rotated(compact)) === 1 ? 'passed' : 'failed' };
}

/** RF creditor reference: "RF", two check digits, up to 21 letters and digits; mod 97 equals 1. */
export function checkRf(text: string): Checked {
  const compact = text.replace(/\s/g, '').toUpperCase();
  const value = groupsOfFour(compact);
  if (!/^RF\d{2}[A-Z0-9]{1,21}$/.test(compact)) return { value, check: 'failed' };
  return { value, check: mod97(rotated(compact)) === 1 ? 'passed' : 'failed' };
}

export type ReferenceKind = 'ocr' | 'rf' | 'text';

export interface CheckedReference extends Checked {
  kind: ReferenceKind;
  /**
   * What held, for an OCR number: `luhn+length` (check digit and length digit), or `luhn` alone,
   * which is what an agreement without length control produces and which a dropped digit can pass.
   */
  detail?: 'luhn' | 'luhn+length';
}

/**
 * A payment reference as read off a page: RF if it begins RF and two digits, otherwise digits
 * only are a Swedish OCR number, otherwise it is free text and has no check to run.
 * Luhn without the length digit passes with the weaker `luhn` detail: some agreements issue
 * numbers without length control, so failing them would reject real invoices.
 */
export function checkReference(text: string): CheckedReference {
  if (/^\s*RF\s*\d{2}/i.test(text)) return { kind: 'rf', ...checkRf(text) };
  const digits = text.replace(/\s/g, '');
  if (/^\d+$/.test(digits)) {
    if (digits.length < 4 || digits.length > 25 || !luhnValid(digits)) {
      return { kind: 'ocr', value: digits, check: 'failed' };
    }
    const length = digits.length % 10 === digits.charCodeAt(digits.length - 2) - 48;
    return { kind: 'ocr', value: digits, check: 'passed', detail: length ? 'luhn+length' : 'luhn' };
  }
  return { kind: 'text', value: text.trim(), check: 'none' };
}
