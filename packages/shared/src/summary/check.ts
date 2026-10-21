/**
 * The two checks that go around the model, whatever it says (ADR 0023 section 4).
 *
 * Both are plain functions on plain text. The model reformats dates and once invented a year
 * ("2027" in an Icelandic draft whose sources had no such year), and once looped to its output cap
 * ("aðeins aðeins …"). The language detector still scored that loop as Icelandic, so nothing
 * about the language is a safeguard; these two are.
 */

/**
 * A digit run without its leading zeros, as text. Never through a Number: past 2^53 two different
 * account or reference numbers become the same float (and 21 digits become "1e+21"), which is
 * exactly the number a model must not be allowed to change unseen.
 */
export const normalDigits = (digits: string): string => digits.replace(/^0+(?=\d)/, '');

/** Whole numbers in a text, as written in any script's digits, without leading zeros. */
export function numbersIn(text: string): Set<string> {
  const found = text.normalize('NFKC').match(/\d+/g) ?? [];
  return new Set(found.map(normalDigits));
}

export interface DigitCheck {
  /** Numbers in the output that the source does not have. An invented number. */
  added: string[];
  /** Numbers in the source that the output lacks. Only a translation is expected to keep them all. */
  missing: string[];
}

function numeric(a: string, b: string): number {
  // Normal digit strings: shorter is smaller, equal lengths compare as text. No float involved.
  return a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);
}

/**
 * Compares the digits of an output with its source.
 *
 * A summary leaves things out on purpose, so for a summary only `added` is a warning. A
 * translation should lose nothing, so `missing` counts too — with the known false alarm that a
 * date written 2026-04-18 and rendered "April 18, 2026" loses its month number; a warning the
 * reader can dismiss with one look at the source, which is the point of showing it beside.
 */
export function digitCheck(source: string, output: string): DigitCheck {
  const have = numbersIn(source);
  const got = numbersIn(output);
  return {
    added: [...got].filter((n) => !have.has(n)).sort(numeric),
    missing: [...have].filter((n) => !got.has(n)).sort(numeric),
  };
}

/** The longest period a loop is looked for at, in tokens. */
export const LOOP_PERIOD = 8;
/** How many times a run must repeat before the output is cut. */
export const LOOP_REPEATS = 3;

/**
 * True when the end of `tokens` is one run of up to eight tokens repeated three times or more:
 * the last `3 x 8 = 24` tokens repeat with some period from 1 to 8. A period of one needs the
 * whole 24, so "the the the" is not a loop and "0 0 0" in a table is not either.
 */
export function repeatsARun(tokens: readonly string[]): boolean {
  const window = LOOP_PERIOD * LOOP_REPEATS;
  if (tokens.length < window) return false;
  const tail = tokens.slice(-window);
  for (let period = 1; period <= LOOP_PERIOD; period += 1) {
    let same = true;
    for (let i = period; i < window; i += 1) {
      if (tail[i] !== tail[i - period]) {
        same = false;
        break;
      }
    }
    if (same) return true;
  }
  return false;
}

/** Output limits in tokens: a translation may be 1.5 times its source, the rest are fixed. */
export const OUTPUT_CAPS = { map: 450, page: 700, form: 400, select: 120 } as const;
export const reduceCap = (parts: number): number => Math.min(1100, Math.max(600, parts * 100));
export const translationCap = (sourceTokens: number): number => Math.ceil(sourceTokens * 1.5) + 16;
