/**
 * Money, as an integer number of minor units.
 *
 * `CLAUDE.md` rule 5: money is never a float. `0.1 + 0.2` is `0.30000000000000004`, and a ledger
 * that is out by a hundredth of a krona is a ledger nobody can close. So an amount here is a
 * **bigint count of the smallest unit the currency has** — öre, cents, pence — and the currency
 * says how many of those make one major unit.
 *
 * ## Why bigint rather than a decimal library
 *
 * A decimal library would work and would be another dependency to keep. Every amount this product
 * handles is a whole number of minor units by construction — there is no such thing as half an
 * öre in a posted entry — so the only arithmetic needed is integer addition and comparison, which
 * `bigint` does exactly and natively. Division, where it appears, is the one operation that has to
 * think, and it is handled explicitly by {@link splitEvenly} rather than by rounding and hoping.
 *
 * ## Currencies with no decimal places
 *
 * The yen has none: ¥100 is 100 minor units, not 10 000. The zero-decimal list is small, fixed by
 * ISO 4217, and getting it wrong means an amount a hundred times too large — so it is here rather
 * than assumed to be two everywhere.
 */

/** ISO 4217, upper case. Validated at the edges; this type is the shape, not the guarantee. */
export type CurrencyCode = string;

/**
 * How many decimal places a currency has.
 *
 * Everything not listed has two. The exceptions are the currencies with none and the three with
 * three; both lists are short and neither changes often, but a wrong answer here is an amount off
 * by a factor of a hundred, so they are written down rather than inferred.
 */
const ZERO_DECIMAL = new Set([
  'BIF',
  'CLP',
  'DJF',
  'GNF',
  'ISK',
  'JPY',
  'KMF',
  'KRW',
  'PYG',
  'RWF',
  'UGX',
  'UYI',
  'VND',
  'VUV',
  'XAF',
  'XOF',
  'XPF',
]);

const THREE_DECIMAL = new Set(['BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND']);

export function decimalPlaces(currency: CurrencyCode): number {
  const code = currency.toUpperCase();
  if (ZERO_DECIMAL.has(code)) return 0;
  if (THREE_DECIMAL.has(code)) return 3;
  return 2;
}

/**
 * Parse what a person typed into minor units.
 *
 * Deliberately strict rather than forgiving. `parseFloat` would accept `"12.345.6"`, `"1e3"` and
 * `"12abc"` and hand back something plausible for each — in a ledger, a silently reinterpreted
 * amount is worse than a rejected one, because the rejection is visible and the reinterpretation
 * is not.
 *
 * Accepts a leading minus, digits, and one separator — a full stop or a comma, because half of
 * Europe writes `12,50` and typing the other one is not a mistake worth refusing. Spaces and
 * non-breaking spaces are stripped: they are how people group thousands, and a pasted amount
 * carries them.
 *
 * Returns `null` when it cannot be read exactly. Never guesses.
 */
export function parseMoney(input: string, currency: CurrencyCode): bigint | null {
  const places = decimalPlaces(currency);
  // JS `\s` already covers the non-breaking and thin spaces people group thousands with, so
  // the class stays plain rather than listing code points that are easy to get subtly wrong.
  const cleaned = input.replace(/[\s']/g, '');
  if (cleaned === '') return null;

  const match = /^(-?)(\d*)(?:[.,](\d*))?$/.exec(cleaned);
  if (!match) return null;

  const [, sign, whole = '', fraction = ''] = match;
  // "." on its own, or "-", is not an amount. At least one digit has to be present.
  if (whole === '' && fraction === '') return null;
  // More precision than the currency has is a typo or a misunderstanding, not a rounding problem.
  if (fraction.length > places) return null;

  const padded = fraction.padEnd(places, '0');
  const magnitude =
    BigInt(whole === '' ? '0' : whole) * 10n ** BigInt(places) + BigInt(padded || '0');
  return sign === '-' ? -magnitude : magnitude;
}

/**
 * Render minor units for a person, in their locale.
 *
 * `Intl.NumberFormat` does the grouping and the separator, which differ by locale and are not
 * ours to invent. The value handed to it is a **string**, not a number: passing a number would
 * route an amount larger than `Number.MAX_SAFE_INTEGER` through a float on the way out, which is
 * the one thing the bigint was for.
 */
export function formatMoney(minor: bigint, currency: CurrencyCode, locale: string): string {
  const places = decimalPlaces(currency);
  const negative = minor < 0n;
  const digits = (negative ? -minor : minor).toString().padStart(places + 1, '0');
  const whole = digits.slice(0, digits.length - places) || '0';
  const fraction = places === 0 ? '' : `.${digits.slice(digits.length - places)}`;

  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: currency.toUpperCase(),
    minimumFractionDigits: places,
    maximumFractionDigits: places,
  }).format(`${negative ? '-' : ''}${whole}${fraction}` as unknown as number);
}

/**
 * Split an amount into `parts` shares that add back up to exactly the amount.
 *
 * The obvious implementation — divide, round, multiply — loses or invents money: a third of 10.00
 * is 3.33 three times over, which is 9.99. The missing öre has to go somewhere, and "somewhere"
 * has to be decided rather than left to a rounding mode.
 *
 * Here the remainder is distributed one minor unit at a time across the earliest shares, so the
 * shares differ by at most one unit and the total is exact by construction. Which share gets the
 * extra unit is arbitrary but **stable**, which is what matters when the same split is computed
 * twice and the two results have to agree.
 */
export function splitEvenly(minor: bigint, parts: number): bigint[] {
  if (!Number.isInteger(parts) || parts < 1) {
    throw new Error(`splitEvenly needs a positive whole number of parts, got ${parts}`);
  }
  const count = BigInt(parts);
  const base = minor / count;
  // `%` on a negative bigint keeps the sign of the dividend, which is what we want: a negative
  // amount distributes its remainder downward, so the shares stay on the same side of zero.
  const remainder = minor % count;
  const step = remainder < 0n ? -1n : 1n;
  const spread = remainder < 0n ? -remainder : remainder;

  return Array.from({ length: parts }, (_, index) => (BigInt(index) < spread ? base + step : base));
}

/** Sum, exactly. Present so no caller reaches for `reduce((a, b) => a + b, 0)` and gets a number. */
export function sumMinor(amounts: Iterable<bigint>): bigint {
  let total = 0n;
  for (const amount of amounts) total += amount;
  return total;
}
