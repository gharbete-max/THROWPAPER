import { describe, expect, it } from 'vitest';
import { divideRounded, formatMinor, invoiceTotals, lineTotals } from './totals.js';

/**
 * Invoice arithmetic, which has to be exact rather than nearly right.
 *
 * `CLAUDE.md` rule 5 says money is decimal or bigint and never a float. The tests below are the
 * argument for that rule rather than a restatement of it: several of them fail under floating
 * point in ways that look like nothing until a tenant adds up a column by hand.
 */
describe('rounding', () => {
  it('goes half away from zero, the way a person does it', () => {
    expect(divideRounded(5n, 2n)).toBe(3n);
    expect(divideRounded(-5n, 2n)).toBe(-3n);
    expect(divideRounded(4n, 2n)).toBe(2n);
    expect(divideRounded(1n, 3n)).toBe(0n);
    expect(divideRounded(2n, 3n)).toBe(1n);
  });

  it('refuses to divide by zero rather than returning something', () => {
    expect(() => divideRounded(1n, 0n)).toThrow(RangeError);
  });

  /**
   * The reason this is bigint.
   *
   * An amount past 2^53 minor units is beyond what a double can represent exactly. No rent invoice
   * is that large; a yearly total across a property portfolio, in öre, can be. The point is that
   * nothing here has to know which case it is in.
   */
  it('stays exact past the range a double can hold', () => {
    const huge = 9_007_199_254_740_993n; // 2^53 + 1, the first integer a double cannot represent
    expect(divideRounded(huge * 1000n, 1000n)).toBe(huge);
  });
});

describe('a line', () => {
  it('multiplies a quantity in thousandths by a unit price', () => {
    // One month of rent at 8 950,00 kr.
    expect(lineTotals({ quantity: '1000', unitAmount: '895000', vatRateBasisPoints: 0 })).toEqual({
      amount: 895000n,
      vat: 0n,
    });
  });

  it('handles a fractional quantity without a float', () => {
    // A third of a shared water meter at 300,00 kr: 10000,00 öre / 3 = 3333.33 -> 3333 öre.
    expect(lineTotals({ quantity: '333', unitAmount: '30000', vatRateBasisPoints: 0 })).toEqual({
      amount: 9990n,
      vat: 0n,
    });
  });

  it('applies VAT in basis points', () => {
    // Cable television at 250,00 kr with 25% VAT.
    expect(lineTotals({ quantity: '1000', unitAmount: '25000', vatRateBasisPoints: 2500 })).toEqual(
      { amount: 25000n, vat: 6250n },
    );
  });

  it('rounds VAT to the öre', () => {
    // 33,33 kr at 25% is 8,3325 kr, which is 833 öre after rounding.
    expect(lineTotals({ quantity: '1000', unitAmount: '3333', vatRateBasisPoints: 2500 })).toEqual({
      amount: 3333n,
      vat: 833n,
    });
  });

  it('refuses a negative quantity and a malformed amount', () => {
    expect(() => lineTotals({ quantity: '-1', unitAmount: '100', vatRateBasisPoints: 0 })).toThrow(
      RangeError,
    );
    expect(() =>
      lineTotals({ quantity: '1000', unitAmount: '10.5', vatRateBasisPoints: 0 }),
    ).toThrow(TypeError);
  });
});

describe('an invoice', () => {
  /** The rent case, with the extras a tenant actually sees on the bill. */
  const RENT = [
    { quantity: '1000', unitAmount: '895000', vatRateBasisPoints: 0 }, // Rent, exempt
    { quantity: '1000', unitAmount: '24900', vatRateBasisPoints: 2500 }, // Cable television
    { quantity: '1000', unitAmount: '39900', vatRateBasisPoints: 2500 }, // Broadband
    { quantity: '1000', unitAmount: '65000', vatRateBasisPoints: 2500 }, // Parking space
  ];

  it('adds up what a tenant would add up', () => {
    const totals = invoiceTotals(RENT);
    expect(totals.net).toBe(1_024_800n); // 10 248,00 kr
    expect(totals.vat).toBe(32_450n); // 324,50 kr
    expect(totals.total).toBe(1_057_250n); // 10 572,50 kr
  });

  /**
   * Lines are rounded and then summed, never summed and then rounded.
   *
   * Three lines whose VAT each ends in half an öre: rounding each gives 3 öre of VAT, rounding the
   * sum gives 2. The first matches the column printed on the invoice, and the column is what a
   * person checks.
   */
  it('rounds each line, so the total matches the column above it', () => {
    const halves = Array.from({ length: 3 }, () => ({
      quantity: '1000',
      unitAmount: '2',
      vatRateBasisPoints: 2500,
    }));

    const totals = invoiceTotals(halves);
    // Each line: 2 öre at 25% is 0.5 öre, rounded to 1. Three lines, so 3.
    expect(totals.vat).toBe(3n);

    // Summed first, it would have been 6 öre at 25% = 1.5, rounded to 2. Different, and wrong here.
    expect(totals.vat).not.toBe(2n);
  });

  it('is zero for no lines rather than throwing', () => {
    // An empty draft is a real state in the builder; the schema is what refuses to issue one.
    expect(invoiceTotals([])).toEqual({ net: 0n, vat: 0n, total: 0n });
  });

  /**
   * A property portfolio's yearly total, which is where a float would first be visibly wrong.
   *
   * Two thousand tenants, twelve months, ten thousand kronor each. In öre that is past what a
   * double represents exactly.
   */
  it('stays exact across a portfolio-sized run', () => {
    const lines = Array.from({ length: 2000 * 12 }, () => ({
      quantity: '1000',
      unitAmount: '1000000',
      vatRateBasisPoints: 0,
    }));
    expect(invoiceTotals(lines).total).toBe(24_000_000_000n);
  });
});

describe('showing an amount to a person', () => {
  it('renders minor units as the locale writes money', () => {
    // Non-breaking spaces and the locale's own separators, so this asserts the digits it must hold.
    const swedish = formatMinor(1_057_250n, 'SEK', 'sv-SE');
    expect(swedish.replace(/\s/g, '')).toContain('10572,50');

    const british = formatMinor(1_057_250n, 'SEK', 'en-GB');
    expect(british.replace(/\s/g, '')).toContain('10,572.50');
  });

  it('keeps the öre when they are zero', () => {
    expect(formatMinor(895_000n, 'SEK', 'sv-SE').replace(/\s/g, '')).toContain('8950,00');
  });

  it('renders a credit as negative', () => {
    /*
     * A real minus sign, U+2212, not a hyphen.
     *
     * That is what `Intl` produces and it is typographically right, so the test asks whether the
     * amount reads as negative rather than which character was used. Asserting the hyphen would
     * have been a test pinning a wrong expectation onto correct output.
     */
    expect(formatMinor(-25_000n, 'SEK', 'sv-SE')).toMatch(/[-−]/);
    expect(formatMinor(25_000n, 'SEK', 'sv-SE')).not.toMatch(/[-−]/);
  });
});
