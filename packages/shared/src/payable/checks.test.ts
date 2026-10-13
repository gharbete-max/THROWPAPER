import { describe, expect, it } from 'vitest';
import { buildOcr } from '../invoicing/ocr.js';
import {
  checkBankgiro,
  checkIban,
  checkPlusgiro,
  checkReference,
  checkRf,
  luhnValid,
  normaliseBankgiro,
} from './checks.js';

describe('Luhn (mod 10)', () => {
  it('accepts the standard published example and refuses a changed digit', () => {
    expect(luhnValid('79927398713')).toBe(true);
    expect(luhnValid('79927398712')).toBe(false);
    expect(luhnValid('79927398731')).toBe(false); // two digits swapped
  });
  it('refuses anything that is not digits', () => {
    expect(luhnValid('')).toBe(false);
    expect(luhnValid('12a4')).toBe(false);
  });
});

describe('bankgiro and plusgiro', () => {
  it.each(['999-9996', '123-4566', '9999996', '5402-9681'])('accepts %s', (number) => {
    expect(checkBankgiro(number).check).toBe('passed');
  });
  it('refuses a bankgiro with one digit wrong, or the wrong length', () => {
    expect(checkBankgiro('123-4567').check).toBe('failed');
    expect(checkBankgiro('123-45').check).toBe('failed');
    expect(checkBankgiro('12345678901').check).toBe('failed');
  });
  it('prints a bankgiro the way the bank does: 3-4 or 4-4', () => {
    expect(normaliseBankgiro('1234566')).toBe('123-4566');
    expect(normaliseBankgiro('5402 9681')).toBe('5402-9681');
  });
  it('checks a plusgiro the same way, 2 to 8 digits', () => {
    expect(checkPlusgiro('123456-6').check).toBe('passed');
    expect(checkPlusgiro('123456-7').check).toBe('failed');
    expect(checkPlusgiro('1').check).toBe('failed');
  });
});

describe('IBAN (ISO 13616 mod 97)', () => {
  it.each([
    'GB82 WEST 1234 5698 7654 32',
    'DE89 3704 0044 0532 0130 00',
    'SE45 5000 0000 0583 9825 7466',
    'DK50 0040 0440 1162 43',
    'NO93 8601 1117 947',
    'FI21 1234 5600 0007 85',
    'NL91 ABNA 0417 1643 00',
    'FR14 2004 1010 0505 0001 3M02 606',
  ])('accepts the published example %s', (iban) => {
    expect(checkIban(iban).check).toBe('passed');
  });
  it('refuses a changed digit, a swapped pair, the wrong length and an unknown country', () => {
    expect(checkIban('DE89 3704 0044 0532 0130 01').check).toBe('failed');
    expect(checkIban('DE89 3704 0044 0532 0310 00').check).toBe('failed');
    expect(checkIban('DE89 3704 0044 0532 0130').check).toBe('failed');
    expect(checkIban('XX89 3704 0044 0532 0130 00').check).toBe('failed');
  });
  it('is read in capitals, in groups of four, however OCR cased it', () => {
    expect(checkIban('de893704004405320130 00').value).toBe('DE89 3704 0044 0532 0130 00');
  });
});

describe('RF creditor reference (ISO 11649)', () => {
  it('accepts the published example, with or without spaces', () => {
    expect(checkRf('RF18 5390 0754 7034').check).toBe('passed');
    expect(checkRf('RF18539007547034').check).toBe('passed');
  });
  it('refuses a changed or dropped character', () => {
    expect(checkRf('RF18 5390 0754 7035').check).toBe('failed');
    expect(checkRf('RF18 5390 0754 703').check).toBe('failed');
    expect(checkRf('RF19 5390 0754 7034').check).toBe('failed');
  });
  it('refuses more than 25 characters', () => {
    expect(checkRf('RF18 5390 0754 7034 5390 0754 7034').check).toBe('failed');
  });
});

describe('payment reference', () => {
  it('knows an OCR number by check digit and length digit', () => {
    expect(checkReference(buildOcr('1234567'))).toMatchObject({
      kind: 'ocr',
      check: 'passed',
      detail: 'luhn+length',
    });
  });
  it('passes a Luhn-valid number with no length digit, and says that is all that held', () => {
    // 123456 + its Luhn digit 6: the next-to-last digit (5... 6) is not the length (7).
    expect(checkReference('1234566')).toMatchObject({
      kind: 'ocr',
      check: 'passed',
      detail: 'luhn',
    });
  });
  it('fails a number with one digit changed or one dropped', () => {
    const ocr = buildOcr('1234567');
    const changed = ocr.slice(0, 3) + String((Number(ocr[3]) + 1) % 10) + ocr.slice(4);
    expect(checkReference(changed).check).toBe('failed');
    expect(checkReference(ocr.slice(1)).check).toBe('failed');
  });
  it('reads RF before digits, and ignores the spacing in either', () => {
    expect(checkReference('RF18 5390 0754 7034')).toMatchObject({ kind: 'rf', check: 'passed' });
    const ocr = buildOcr('1234567');
    expect(checkReference(`${ocr.slice(0, 4)} ${ocr.slice(4)}`).value).toBe(ocr);
  });
  it('has no check for free text, and says so', () => {
    expect(checkReference('Invoice 2026-114')).toMatchObject({ kind: 'text', check: 'none' });
  });
});
