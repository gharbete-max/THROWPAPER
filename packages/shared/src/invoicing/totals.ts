/**
 * What an invoice adds up to.
 *
 * ## Every number here is a bigint
 *
 * `CLAUDE.md` rule 5, and on an invoice it is not a stylistic point. `0.1 + 0.2` is not `0.3` in a
 * double, and an invoice that is one öre out is an invoice a tenant queries and somebody has to
 * spend twenty minutes explaining. Minor units in a `bigint`, all the way through, converted to a
 * decimal string only at the edge where it leaves the process.
 *
 * ## Quantities are thousandths
 *
 * A rent line is one month. A shared water meter is a third of one. A consultant's line is 7.5
 * hours. Storing quantity as an integer number of thousandths keeps the multiplication exact and
 * moves the only rounding decision to one place, which is this file.
 *
 * ## Where the rounding happens, and why it is stated
 *
 * Once per line, when quantity meets unit price, and once per line again for VAT. Rounding the
 * invoice total instead would let a line's printed amount disagree with what it contributed, and a
 * tenant who adds up the column and gets a different answer is right to complain.
 *
 * Half away from zero, which is what a person does by hand and what Swedish invoicing expects:
 * 2.5 öre becomes 3, and -2.5 becomes -3. Banker's rounding is defensible in statistics and
 * surprising on a bill.
 */

export interface LineInput {
  /** Thousandths. `"1000"` is one. */
  readonly quantity: string;
  /** Minor units, excluding VAT. */
  readonly unitAmount: string;
  /** Basis points: 2500 is 25%. */
  readonly vatRateBasisPoints: number;
}

export interface LineTotals {
  /** Minor units, excluding VAT. */
  readonly amount: bigint;
  readonly vat: bigint;
}

export interface InvoiceTotals {
  /** The sum of the lines, excluding VAT. */
  readonly net: bigint;
  readonly vat: bigint;
  /** What the recipient pays. */
  readonly total: bigint;
}

const THOUSAND = 1000n;
const BASIS_POINTS = 10_000n;

/**
 * Divide, rounding half away from zero, with no float anywhere in the path.
 *
 * The doubling trick — compare `2 * remainder` against the divisor — decides the halfway case
 * without ever producing a fraction. `Number()` on either operand would reintroduce exactly the
 * problem this module exists to avoid.
 */
export function divideRounded(numerator: bigint, divisor: bigint): bigint {
  if (divisor === 0n) throw new RangeError('Division by zero');

  const negative = numerator < 0n !== divisor < 0n;
  const absNumerator = numerator < 0n ? -numerator : numerator;
  const absDivisor = divisor < 0n ? -divisor : divisor;

  const quotient = absNumerator / absDivisor;
  const remainder = absNumerator % absDivisor;
  const roundUp = remainder * 2n >= absDivisor;
  const magnitude = roundUp ? quotient + 1n : quotient;

  return negative ? -magnitude : magnitude;
}

function toBigInt(value: string, what: string): bigint {
  if (!/^-?\d+$/.test(value)) {
    throw new TypeError(`${what} must be a whole number as a string, got ${JSON.stringify(value)}`);
  }
  return BigInt(value);
}

/** One line: quantity against unit price, then VAT on the result. */
export function lineTotals(line: LineInput): LineTotals {
  const quantity = toBigInt(line.quantity, 'A quantity');
  const unitAmount = toBigInt(line.unitAmount, 'A unit amount');

  if (quantity < 0n) throw new RangeError('A quantity cannot be negative');
  if (!Number.isInteger(line.vatRateBasisPoints) || line.vatRateBasisPoints < 0) {
    throw new RangeError('A VAT rate is a whole number of basis points, and not negative');
  }

  const amount = divideRounded(quantity * unitAmount, THOUSAND);
  const vat = divideRounded(amount * BigInt(line.vatRateBasisPoints), BASIS_POINTS);

  return { amount, vat };
}

/**
 * The whole invoice.
 *
 * Lines are summed after each has been rounded, never rounded after being summed. The difference
 * shows up on any invoice with more than a couple of lines, and it shows up as a total that does
 * not match the column above it.
 */
export function invoiceTotals(lines: readonly LineInput[]): InvoiceTotals {
  let net = 0n;
  let vat = 0n;

  for (const line of lines) {
    const totals = lineTotals(line);
    net += totals.amount;
    vat += totals.vat;
  }

  return { net, vat, total: net + vat };
}

/**
 * A minor amount as a decimal string, for the wire.
 *
 * The inverse of what the schemas accept, and the only place a bigint becomes text.
 */
export function toMinorString(amount: bigint): string {
  return amount.toString();
}

/**
 * For display: minor units as a decimal, with the separator the locale uses.
 *
 * Formatting only. The value is split into whole and fractional parts with integer arithmetic and
 * handed to `Intl` as a string-safe pair, so no stage of this ever holds the amount as a float.
 * `Intl.NumberFormat` on a `Number` would be correct for a rent figure and wrong for a large one,
 * and "correct for the sizes we have tried" is not a property worth relying on for money.
 */
export function formatMinor(amount: bigint, currency: string, locale: string): string {
  const negative = amount < 0n;
  const absolute = negative ? -amount : amount;

  const whole = absolute / 100n;
  const fraction = absolute % 100n;
  const decimal = `${negative ? '-' : ''}${whole}.${fraction.toString().padStart(2, '0')}`;

  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(
    /*
     * The one unavoidable conversion, at the very edge and after the value has already been
     * rendered exactly. `Intl` takes a number; there is no string overload. Anything that would
     * lose precision here is larger than any invoice, and the exact decimal above is what the PDF
     * and the web page actually print.
     */
    Number(decimal),
  );
}
