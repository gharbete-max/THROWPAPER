import { describe, expect, it } from 'vitest';
import { lexiconFor } from './lexicon.js';
import { luhn, readPattern, readQuantity } from './patterns.js';

/**
 * T4's patterns beyond what the phrase tables show: the edges of each — a leap day, a
 * samordningsnummer, a number too long to be a quantity, a date inside a sentence — and that a
 * value is exact and pointed at, never approximated.
 */

describe('a quantity', () => {
  const en = lexiconFor('en');
  it('is 1–3 digits or a number word, never a year or a decimal', () => {
    expect(readQuantity('2026', en)).toEqual({ refused: 'nothing' });
    expect(readQuantity('3.5', en)).toEqual({ refused: 'ambiguous' });
    expect(readQuantity('four, 4', en)).toMatchObject({ value: 4 });
  });

  it('is refused inside a phrase too long to be sure of', () => {
    expect(readQuantity('four buttons in a row', en)).toMatchObject({ value: 4, whole: false });
    expect(readQuantity('we expect four hundred guests at the big summer party', en)).toEqual({
      refused: 'ambiguous',
    });
    expect(readQuantity('we will need four for the big summer party', en)).toEqual({
      refused: 'nothing',
    });
  });

  it('composes Chinese and Japanese numerals, and refuses a run that is not one', () => {
    const zh = lexiconFor('zh');
    expect(readQuantity('二十一', zh)).toMatchObject({ value: 21, whole: true });
    expect(readQuantity('十', zh)).toMatchObject({ value: 10 });
    expect(readQuantity('一百', zh)).toMatchObject({ value: 100 });
    expect(readQuantity('一二', zh)).toEqual({ refused: 'ambiguous' });
    expect(readQuantity('十十', zh)).toEqual({ refused: 'ambiguous' });
  });

  it('points at the number as typed', () => {
    const typed = 'maybe ４ please';
    const read = readQuantity(typed, en);
    if ('refused' in read) throw new Error(read.refused);
    expect(typed.slice(read.start, read.end)).toBe('４');
  });
});

describe('a date', () => {
  it('is a real calendar date', () => {
    expect(readPattern('date', '29 February 2028', 'en')?.value).toBe('2028-02-29');
    expect(readPattern('date', '29 February 2027', 'en')).toBeNull();
    expect(readPattern('date', '29 February 2100', 'en')).toBeNull();
    expect(readPattern('date', '29 February 2000', 'en')?.value).toBe('2000-02-29');
    expect(readPattern('date', '31/04/2026', 'en')).toBeNull();
    expect(readPattern('date', '2026-13-01', 'en')).toBeNull();
  });

  it('is found inside a sentence, at 750, and pointed at', () => {
    const typed = 'the party is on 1 May 2026 at eight';
    const read = readPattern('date', typed, 'en');
    expect(read).toMatchObject({ value: '2026-05-01', confidence: 750 });
    expect(typed.slice(read!.span[0], read!.span[1])).toBe('1 May 2026');
  });

  it('reads a month only in the language it is in', () => {
    expect(readPattern('date', '1 maj 2026', 'sv')?.value).toBe('2026-05-01');
    expect(readPattern('date', '1 maj 2026', 'en')).toBeNull();
  });
});

describe('an amount of money', () => {
  it('is an exact decimal string, grouped and separated as the language writes it', () => {
    expect(readPattern('currency', '1 234,5 kr', 'sv')?.value).toEqual({
      amount: '1234.5',
      currency: 'SEK',
    });
    expect(readPattern('currency', '$1,234.50', 'en')?.value).toEqual({
      amount: '1234.50',
      currency: 'USD',
    });
    expect(readPattern('currency', 'SEK 400', 'en')?.value).toEqual({
      amount: '400',
      currency: 'SEK',
    });
  });

  it('needs its marker as a whole word', () => {
    expect(readPattern('currency', '400 krav', 'sv')).toBeNull();
    expect(readPattern('currency', '400', 'sv')).toBeNull();
  });

  it('is no value when two different amounts are given', () => {
    expect(readPattern('currency', '100 kr eller 200 kr', 'sv')).toBeNull();
  });
});

describe('Swedish identity numbers', () => {
  it('check Luhn as Skatteverket does', () => {
    expect(luhn('8112189876')).toBe(true);
    expect(luhn('8112189875')).toBe(false);
    expect(luhn('5566778899')).toBe(true);
  });

  it('take a samordningsnummer’s day of 61–91, and keep what was written', () => {
    // 811278-… is the 18th, as a samordningsnummer; the check digit is recomputed for it.
    const ten = '811278987';
    const check = [...'0123456789'].find((d) => luhn(ten + d))!;
    expect(readPattern('personnummer', `811278-987${check}`, 'sv')?.value).toBe(
      `811278-987${check}`,
    );
    expect(readPattern('personnummer', '811232-9876', 'sv')).toBeNull();
  });

  it('refuse + with a four-digit year, and tell a person from an organisation', () => {
    expect(readPattern('personnummer', '19811218+9876', 'sv')).toBeNull();
    expect(readPattern('orgNr', '556677-8899', 'sv')?.value).toBe('556677-8899');
    expect(readPattern('personnummer', '556677-8899', 'sv')).toBeNull();
  });
});

describe('e-mail and phone', () => {
  it('reads an address out of a sentence without its full stop', () => {
    expect(readPattern('email', 'mail me at anna@example.org.', 'en')?.value).toBe(
      'anna@example.org',
    );
    expect(readPattern('email', 'anna@', 'en')).toBeNull();
  });

  it('needs + and 7–15 digits', () => {
    expect(readPattern('phone', '+46 (0)70 123 45 67', 'sv')?.value).toBe('+460701234567');
    expect(readPattern('phone', '070-123 45 67', 'sv')).toBeNull();
    expect(readPattern('phone', '+1 234 567 890 123 456 7', 'en')).toBeNull();
  });
});
