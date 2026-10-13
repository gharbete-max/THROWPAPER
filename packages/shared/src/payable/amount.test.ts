import { describe, expect, it } from 'vitest';
import { parseAmount } from './amount.js';

const ok = (minor: bigint) => ({ status: 'ok', minor });

describe('parseAmount: the separator is resolved by rule', () => {
  it.each([
    // [text, minor units]
    ['1 234,56', 123456n], // Swedish: space groups, comma decimals
    ['1\u00a0234,56', 123456n], // non-breaking space
    ['1\u202f234,56', 123456n], // narrow no-break space, as Intl writes it
    ['1.234,56', 123456n], // German, Danish, Norwegian
    ['1,234.56', 123456n], // English
    ["1'234.56", 123456n], // Swiss
    ['1234,56', 123456n],
    ['1234.56', 123456n],
    ['12.345.678,90', 1234567890n],
    ['12,345,678.90', 1234567890n],
    ['1 250', 125000n], // no decimals
    ['1250', 125000n],
    ['0,50', 50n],
    ['0.5', 50n], // one decimal is tenths
    ['1 250,00 SEK', 125000n],
    ['SEK 1 250,00', 125000n],
    ['1.250,00 €', 125000n],
    ['€1,250.00', 125000n],
    ['1 250:-', 125000n], // Swedish "kronor, no öre"
    ['1250,-', 125000n],
    ['1 250 kr', 125000n],
    ['kr 1.250,00', 125000n],
    ['1.234.567', 123456700n], // repeated separator can only be thousands
    ['1,234,567', 123456700n],
  ])('%s is %s minor units', (text, minor) => {
    expect(parseAmount(text)).toEqual(ok(minor));
  });
});

describe('parseAmount: asks when the same digits could be two amounts', () => {
  it.each(['1.234', '1,234', '12,500', '999.999'])(
    '%s may be a thousands separator or a mistake: the reading is offered, not assumed',
    (text) => {
      const result = parseAmount(text);
      expect(result.status).toBe('ask');
      if (result.status === 'ask') {
        const digits = text.replace(/\D/g, '');
        expect(result.candidates).toEqual([BigInt(digits) * 100n]);
      }
    },
  );
});

describe('parseAmount: refuses what is not an amount', () => {
  it.each([
    '',
    'abc',
    '1,2,3',
    '1.234,5678', // four decimals
    '1,234.56.78',
    '0,123', // a fraction of an öre
    '1234,567',
    '12 34',
    '1 234 56', // a space is not a decimal mark
    '-1 250,00', // a credit is not a total to pay
    '1,',
    '1 250,00 25',
  ])('"%s" is invalid', (text) => {
    expect(parseAmount(text)).toEqual({ status: 'invalid' });
  });
});

describe('parseAmount is exact', () => {
  it('holds an amount no double could', () => {
    expect(parseAmount('90 071 992 547 409,93')).toEqual(ok(9007199254740993n));
  });
});
