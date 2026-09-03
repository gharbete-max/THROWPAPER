import { describe, expect, it } from 'vitest';
import { decimalPlaces, formatMoney, parseMoney, splitEvenly, sumMinor } from './money.js';

describe('decimal places', () => {
  it('is two for the ordinary case', () => {
    expect(decimalPlaces('SEK')).toBe(2);
    expect(decimalPlaces('eur')).toBe(2);
  });

  /**
   * ¥100 is a hundred minor units, not ten thousand. Assuming two everywhere makes a yen amount a
   * hundred times too large, which is the kind of defect that reaches a bank statement.
   */
  it('is none for the zero-decimal currencies', () => {
    expect(decimalPlaces('JPY')).toBe(0);
    expect(decimalPlaces('ISK')).toBe(0);
    expect(decimalPlaces('KRW')).toBe(0);
  });

  it('is three where a currency really has three', () => {
    expect(decimalPlaces('KWD')).toBe(3);
    expect(decimalPlaces('BHD')).toBe(3);
  });
});

describe('parsing what somebody typed', () => {
  it('reads an ordinary amount', () => {
    expect(parseMoney('12.50', 'SEK')).toBe(1250n);
    expect(parseMoney('0.01', 'SEK')).toBe(1n);
    expect(parseMoney('1000', 'SEK')).toBe(100000n);
  });

  /** Half of Europe writes 12,50. Typing it is not a mistake worth refusing. */
  it('accepts a comma as the decimal separator', () => {
    expect(parseMoney('12,50', 'SEK')).toBe(1250n);
  });

  /** A pasted amount carries the spaces somebody grouped it with, including non-breaking ones. */
  it('ignores grouping whitespace', () => {
    expect(parseMoney('1 234,56', 'SEK')).toBe(123456n);
    expect(parseMoney('1 234,56', 'SEK')).toBe(123456n);
  });

  it('handles a negative', () => {
    expect(parseMoney('-12.50', 'SEK')).toBe(-1250n);
  });

  it('scales to the currency rather than to two places', () => {
    expect(parseMoney('100', 'JPY')).toBe(100n);
    expect(parseMoney('1.234', 'KWD')).toBe(1234n);
  });

  /**
   * The whole point of not using `parseFloat`: it accepts every one of these and returns
   * something plausible. In a ledger a silently reinterpreted amount is worse than a rejected
   * one, because the rejection is visible.
   */
  it.each(['', '-', '.', 'abc', '12abc', '1e3', '12.34.56', '1,2,3'])(
    'refuses %o rather than guessing',
    (input) => {
      expect(parseMoney(input, 'SEK')).toBeNull();
    },
  );

  /** More precision than the currency has is a typo or a misunderstanding, not a rounding job. */
  it('refuses more decimals than the currency has', () => {
    expect(parseMoney('12.345', 'SEK')).toBeNull();
    expect(parseMoney('100.5', 'JPY')).toBeNull();
  });

  /** Larger than a double can hold exactly. This is the case bigint exists for. */
  it('is exact far past the safe integer range', () => {
    expect(parseMoney('99999999999999999.99', 'SEK')).toBe(9999999999999999999n);
  });
});

describe('formatting', () => {
  it('renders an amount in the reader’s locale', () => {
    // The separators are the platform's business; what matters is the digits and the sign.
    expect(formatMoney(123456n, 'SEK', 'en-GB')).toMatch(/1,234\.56/);
    expect(formatMoney(-1250n, 'SEK', 'en-GB')).toMatch(/12\.50/);
    expect(formatMoney(-1250n, 'SEK', 'en-GB')).toMatch(/-|−|\(/);
  });

  it('renders a zero-decimal currency without a fraction', () => {
    expect(formatMoney(100n, 'JPY', 'en-GB')).toMatch(/100/);
    expect(formatMoney(100n, 'JPY', 'en-GB')).not.toMatch(/100\.00/);
  });

  /**
   * The reason the value reaches `Intl` as a string: routing it through a number would put an
   * amount past `Number.MAX_SAFE_INTEGER` through a float, which is exactly what the bigint was
   * for.
   */
  it('is exact past the safe integer range', () => {
    expect(formatMoney(9007199254740993n, 'SEK', 'en-GB')).toMatch(/90,071,992,547,409\.93/);
  });
});

describe('splitting evenly', () => {
  /**
   * Divide-round-multiply loses money: a third of 10.00 is 3.33 three times over, which is 9.99.
   * The missing öre has to go somewhere, and somewhere has to be decided.
   */
  it('adds back up to exactly the amount', () => {
    const parts = splitEvenly(1000n, 3);
    expect(parts).toEqual([334n, 333n, 333n]);
    expect(sumMinor(parts)).toBe(1000n);
  });

  it('gives every share the same amount when it divides', () => {
    expect(splitEvenly(900n, 3)).toEqual([300n, 300n, 300n]);
  });

  it('keeps a negative amount on its own side of zero', () => {
    const parts = splitEvenly(-1000n, 3);
    expect(parts).toEqual([-334n, -333n, -333n]);
    expect(sumMinor(parts)).toBe(-1000n);
  });

  it('is stable, so the same split computed twice agrees', () => {
    expect(splitEvenly(1000n, 7)).toEqual(splitEvenly(1000n, 7));
  });

  it('refuses a nonsensical number of parts', () => {
    expect(() => splitEvenly(100n, 0)).toThrow();
    expect(() => splitEvenly(100n, 1.5)).toThrow();
  });
});
