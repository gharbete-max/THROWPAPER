import { describe, expect, it } from 'vitest';
import {
  MAX_OCR_LENGTH,
  OcrError,
  buildOcr,
  formatOcr,
  isValidOcr,
  luhnCheckDigit,
} from './ocr.js';

/**
 * The reference a bank matches a rent payment on.
 *
 * This is the least forgiving code in the product. A wrong check digit is not a bug somebody sees
 * on a screen: it is a payment file the bank rejects, or worse, a payment that imports against the
 * wrong tenant. So it is tested against the algorithm's own definition rather than against a
 * snapshot of whatever it happened to produce first.
 */
describe('the Luhn check digit', () => {
  /**
   * Doubling starts at the rightmost digit of the payload.
   *
   * Worked by hand rather than recorded from a run: "12345678902" doubles 2, 9, 7, 5, 3, 1 and
   * leaves 0, 8, 6, 4, 2, giving 4+0+9+8+5+6+1+4+6+2+2 = 47, so the digit is 3.
   */
  it('is computed from the right, with the last payload digit doubled', () => {
    expect(luhnCheckDigit('12345678902')).toBe(3);
  });

  it('makes the whole run divisible by ten', () => {
    for (const payload of ['1', '42', '7654321', '000000001', '99999999999']) {
      const complete = `${payload}${luhnCheckDigit(payload)}`;
      let sum = 0;
      let double = true;
      for (let i = complete.length - 2; i >= 0; i -= 1) {
        let digit = complete.charCodeAt(i) - 48;
        if (double) {
          digit *= 2;
          if (digit > 9) digit -= 9;
        }
        sum += digit;
        double = !double;
      }
      expect((sum + (complete.charCodeAt(complete.length - 1) - 48)) % 10).toBe(0);
    }
  });

  it('refuses anything that is not digits', () => {
    expect(() => luhnCheckDigit('12a4')).toThrow(OcrError);
  });
});

describe('an OCR reference', () => {
  it('carries its own length in the second-to-last digit', () => {
    const reference = buildOcr('1234567890');
    expect(reference).toBe('123456789023');
    // 12 digits, so the length digit is 2.
    expect(reference).toHaveLength(12);
    expect(reference.at(-2)).toBe('2');
  });

  it('validates what it builds, for every length it can produce', () => {
    for (let digits = 2; digits <= MAX_OCR_LENGTH - 2; digits += 1) {
      const base = '1'.repeat(digits);
      const reference = buildOcr(base);
      expect(isValidOcr(reference), `${reference} failed its own check`).toBe(true);
      expect(reference).toHaveLength(digits + 2);
    }
  });

  /**
   * The error the check digit exists for.
   *
   * Every single-digit slip must be caught. Not "usually caught" — Luhn catches all of them, and a
   * test that accepted less would be hiding an implementation that had drifted.
   */
  it('rejects every single-digit typo', () => {
    const reference = buildOcr('20260900412');

    for (let position = 0; position < reference.length; position += 1) {
      for (let digit = 0; digit <= 9; digit += 1) {
        const typo = reference.slice(0, position) + String(digit) + reference.slice(position + 1);
        if (typo === reference) continue;
        expect(isValidOcr(typo), `${typo} should not have validated`).toBe(false);
      }
    }
  });

  /**
   * The error the length digit exists for, and which Luhn alone cannot see.
   *
   * A dropped digit shortens the reference, and Luhn over a shorter run is simply a different
   * valid-looking number. Without the length digit roughly one truncation in ten would be accepted
   * as a real reference belonging to some other invoice.
   */
  it('rejects a dropped digit, which the check digit alone would not', () => {
    const reference = buildOcr('20260900412');

    let acceptedWithoutLengthControl = 0;
    for (let position = 0; position < reference.length - 1; position += 1) {
      const truncated = reference.slice(0, position) + reference.slice(position + 1);
      expect(isValidOcr(truncated), `${truncated} should not have validated`).toBe(false);
      if (isValidOcr(truncated, { lengthControl: false })) acceptedWithoutLengthControl += 1;
    }

    // Proof the length digit is doing work rather than being decoration.
    expect(acceptedWithoutLengthControl).toBeGreaterThan(0);
  });

  it('catches adjacent transpositions', () => {
    const reference = buildOcr('918273645');
    let caught = 0;
    let tried = 0;

    for (let i = 0; i < reference.length - 1; i += 1) {
      if (reference[i] === reference[i + 1]) continue;
      const swapped =
        reference.slice(0, i) + reference[i + 1] + reference[i] + reference.slice(i + 2);
      tried += 1;
      if (!isValidOcr(swapped)) caught += 1;
    }

    /*
     * Luhn misses exactly one transposition: 0 next to 9, in either order. Everything else is
     * caught, so this asserts the real property rather than a round number.
     */
    const nines = [...reference].filter((digit, i) => {
      const next = reference[i + 1];
      return (
        next !== undefined && ((digit === '0' && next === '9') || (digit === '9' && next === '0'))
      );
    }).length;
    expect(caught).toBe(tried - nines);
  });

  it('preserves leading zeros, because they change the length', () => {
    expect(buildOcr('0042')).not.toBe(buildOcr('42'));
    expect(isValidOcr(buildOcr('0042'))).toBe(true);
  });

  it('refuses a base that would exceed what a giro file accepts', () => {
    expect(() => buildOcr('1'.repeat(MAX_OCR_LENGTH))).toThrow(OcrError);
    expect(() => buildOcr('1'.repeat(MAX_OCR_LENGTH - 2))).not.toThrow();
  });

  it('refuses a base that is not digits', () => {
    expect(() => buildOcr('12-34')).toThrow(OcrError);
    expect(() => buildOcr('')).toThrow(OcrError);
  });

  /**
   * Without length control the reference is shorter and weaker, and both are the caller's choice.
   *
   * The choice belongs to the recipient's giro agreement, not to taste: an OCR with a length digit
   * sent to an agreement expecting only a check digit is rejected on every payment.
   */
  it('can be built without length control when an agreement requires that', () => {
    const reference = buildOcr('1234567890', { lengthControl: false });
    expect(reference).toHaveLength(11);
    expect(isValidOcr(reference, { lengthControl: false })).toBe(true);
    // And is correctly refused when read under the stricter rule.
    expect(isValidOcr(reference)).toBe(false);
  });
});

describe('printing a reference', () => {
  it('groups from the right, so the control digits stay together', () => {
    expect(formatOcr('123456789023')).toBe('1234 5678 9023');
    expect(formatOcr('12345')).toBe('1 2345');
  });

  it('is only presentation', () => {
    const reference = buildOcr('55501');
    expect(formatOcr(reference).replace(/ /g, '')).toBe(reference);
  });
});
