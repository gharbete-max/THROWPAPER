import { describe, expect, it } from 'vitest';
import {
  SEND_LIMITS,
  checkBatch,
  guessColumns,
  mergeText,
  oneLine,
  parseBasisPoints,
  parseMinor,
  parseTable,
  rowsFrom,
  unknownFields,
  type BatchRow,
  type BatchTemplate,
} from './send.js';

const letter: BatchTemplate = {
  layout: 'letter',
  locale: 'sv-SE',
  currency: 'SEK',
  title: 'Hej {{name}}',
  body: 'Belopp {{amount}}',
};
const invoice: BatchTemplate = { ...letter, layout: 'invoice', vatRate: '25' };
const row = (over: Partial<BatchRow> = {}): BatchRow => ({
  name: 'Åsa',
  email: 'asa@example.com',
  amount: '1 234,50',
  reference: '1001',
  ...over,
});

describe('amounts are exact minor units', () => {
  it.each([
    ['1 234,50', 123_450n],
    ['1234.50', 123_450n],
    ['1,234.50', 123_450n],
    ['1.234,50', 123_450n],
    ['1.234', 123_400n],
    ['0,5', 50n],
    ['12', 1200n],
    ['12 kr', 1200n],
    ['SEK 99,9', 9990n],
    ['99999999999,99', 9_999_999_999_999n],
  ])('%s is %s', (text, minor) => expect(parseMinor(text)).toBe(minor));

  it.each(['', 'abc', '-5', '1,234,5', '12.345.67', '1.2.3', '12,345,678,901,234', '1,234.567'])(
    '%s is not an amount',
    (text) => expect(parseMinor(text)).toBeNull(),
  );

  it('never goes through a float: 0.1 + 0.2 style sums stay whole', () => {
    expect((parseMinor('0,10') ?? 0n) + (parseMinor('0,20') ?? 0n)).toBe(30n);
  });

  it('reads a VAT rate a person typed, to basis points, and nothing they did not', () => {
    expect(parseBasisPoints('25')).toBe(2500);
    expect(parseBasisPoints('12,5')).toBe(1250);
    expect(parseBasisPoints('0')).toBe(0);
    expect(parseBasisPoints('')).toBeNull();
    expect(parseBasisPoints('101')).toBeNull();
    expect(parseBasisPoints('abc')).toBeNull();
  });
});

describe('merge fields', () => {
  const values = { name: 'Åsa', email: 'a@x.se', amount: '1 234,50 kr', reference: '1001' };

  it('fills every field and leaves what it does not know', () => {
    expect(mergeText('{{name}} / {{ amount }} / {{reference}} / {{nope}}', values)).toBe(
      'Åsa / 1 234,50 kr / 1001 / {{nope}}',
    );
  });

  it('names fields that nothing fills', () => {
    expect(unknownFields('{{name}} {{rent}}', '{{Rent}} {{email}}')).toEqual(['rent', 'Rent']);
  });

  it('does not treat a value as a template (no second pass)', () => {
    expect(mergeText('{{name}}', { ...values, name: '{{amount}}' })).toBe('{{amount}}');
  });

  it('makes a header one line', () => {
    expect(oneLine('Hej\r\nBcc: x@y.z !')).toBe('Hej Bcc: x@y.z !');
  });
});

describe('checking a list before anything is previewed', () => {
  it('passes a good list', () => {
    expect(
      checkBatch(invoice, 'Faktura {{reference}}', 'Hej', [row(), row({ name: 'Bo' })]),
    ).toEqual([]);
  });

  it('points at the row and the field', () => {
    const problems = checkBatch(invoice, 'S', '', [
      row(),
      row({ email: 'nope', amount: 'x' }),
      row({ name: ' ', amount: '0' }),
    ]);
    expect(problems).toEqual([
      { row: 1, field: 'email', code: 'bad-email' },
      { row: 1, field: 'amount', code: 'bad-amount' },
      { row: 2, field: 'name', code: 'missing' },
      { row: 2, field: 'amount', code: 'zero-amount' },
    ]);
  });

  it('never supplies a VAT rate: an invoice without a typed one is refused', () => {
    const { vatRate: _omitted, ...without } = invoice;
    expect(checkBatch(without, 'S', '', [row()])).toContainEqual({
      row: -1,
      field: 'template',
      code: 'vat-rate',
    });
    expect(checkBatch({ ...invoice, vatRate: '0' }, 'S', '', [row()])).toEqual([]);
  });

  it('wants an amount only where the words use one', () => {
    expect(checkBatch({ ...letter, body: 'Hej' }, 'S', '', [row({ amount: '' })])).toEqual([]);
    expect(checkBatch(letter, 'S', '', [row({ amount: '' })])).toHaveLength(1);
  });

  it('refuses a field nothing fills', () => {
    expect(checkBatch({ ...letter, body: '{{rent}}' }, 'S', '', [row()])).toContainEqual({
      row: -1,
      field: 'template',
      code: 'unknown-field',
    });
  });

  it('has a hard cap', () => {
    expect(SEND_LIMITS.batch).toBe(200);
  });
});

describe('a pasted or uploaded table', () => {
  it('reads quotes, semicolons, Swedish letters and a byte-order mark', () => {
    const cells = parseTable(
      '﻿Namn;E-post;Belopp\r\n"Åsa; Ö";asa@x.se;"1 234,50"\r\n\r\nBo;bo@x.se;99\r\n',
    );
    expect(cells).toEqual([
      ['Namn', 'E-post', 'Belopp'],
      ['Åsa; Ö', 'asa@x.se', '1 234,50'],
      ['Bo', 'bo@x.se', '99'],
    ]);
  });

  it('reads tabs and escaped quotes', () => {
    expect(parseTable('a\tb\n"he said ""hi"""\tc')).toEqual([
      ['a', 'b'],
      ['he said "hi"', 'c'],
    ]);
  });

  it('guesses the columns from a header in the product languages and maps rows', () => {
    const header = ['Hyresgäst namn', 'E-post', 'Hyra', 'OCR'];
    const map = guessColumns(header);
    expect(map).toEqual({ name: 0, email: 1, amount: 2, reference: 3 });
    expect(rowsFrom([['Åsa', 'a@x.se', '5 000', '123']], map)).toEqual([
      { name: 'Åsa', email: 'a@x.se', amount: '5 000', reference: '123' },
    ]);
  });
});
