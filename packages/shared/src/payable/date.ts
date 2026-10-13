/**
 * A date as printed on an invoice, to an ISO calendar date (`2026-10-31`), by rule.
 *
 * - Year first (`2026-10-31`, `20261031`) is ISO.
 * - A dot is day first (`31.10.2026`) in every language that uses one.
 * - A slash or hyphen between numbers is day first in most of Europe and month first in the US:
 *   it is settled when one number is above 12, **asked** when both could be either, and not
 *   asked when they are equal.
 * - A month name (Swedish, Danish, Norwegian, German, English) settles it.
 * - A two-digit year is this century.
 *
 * A day the calendar does not have (31 February) is invalid, not corrected. Nothing is computed
 * from payment terms ("30 days net"): a due date is only ever one the page prints.
 */
export type DateParse =
  { status: 'ok'; iso: string } | { status: 'ask'; candidates: string[] } | { status: 'invalid' };

const INVALID: DateParse = { status: 'invalid' };

/** Month names and their usual short forms, lowercase, by month number. */
const MONTHS: Record<number, string[]> = {
  1: ['januari', 'january', 'januar', 'jan'],
  2: ['februari', 'february', 'februar', 'feb'],
  3: ['mars', 'march', 'märz', 'marts', 'mar', 'mär'],
  4: ['april', 'apr'],
  5: ['maj', 'may', 'mai'],
  6: ['juni', 'june', 'jun'],
  7: ['juli', 'july', 'jul'],
  8: ['augusti', 'august', 'aug'],
  9: ['september', 'sep', 'sept'],
  10: ['oktober', 'october', 'okt', 'oct'],
  11: ['november', 'nov'],
  12: ['december', 'dezember', 'dec', 'dez'],
};
const MONTH_NUMBER = new Map(
  Object.entries(MONTHS).flatMap(([n, names]) => names.map((name) => [name, Number(n)] as const)),
);

/** Names longest first, so "mars" is not read as "mar". */
const MONTH_WORD = [...MONTH_NUMBER.keys()]
  .sort((a, b) => b.length - a.length)
  .map((name) => name.replace('.', ''))
  .join('|');

function iso(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1) return null;
  if (date.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

const fullYear = (text: string) => (text.length === 2 ? 2000 + Number(text) : Number(text));

export function parseDate(text: string): DateParse {
  const value = text.trim().replace(/\s+/g, ' ');

  let match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) ?? /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (match) return one(iso(Number(match[1]), Number(match[2]), Number(match[3])));

  match = /^(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2})$/.exec(value);
  if (match) return one(iso(fullYear(match[3]!), Number(match[2]), Number(match[1])));

  match = /^(\d{1,2})([/-])(\d{1,2})\2(\d{4}|\d{2})$/.exec(value);
  if (match) {
    const a = Number(match[1]);
    const b = Number(match[3]);
    const year = fullYear(match[4]!);
    const dayFirst = iso(year, b, a);
    const monthFirst = iso(year, a, b);
    if (dayFirst && monthFirst && a !== b)
      return { status: 'ask', candidates: [dayFirst, monthFirst] };
    return one(dayFirst ?? monthFirst);
  }

  const name = new RegExp(`^(\\d{1,2})\\.? ?(${MONTH_WORD})\\.? ?,?(\\d{4})$`, 'iu').exec(value);
  if (name)
    return one(iso(Number(name[3]), MONTH_NUMBER.get(name[2]!.toLowerCase())!, Number(name[1])));

  const english = new RegExp(
    `^(${MONTH_WORD})\\.? (\\d{1,2})(?:st|nd|rd|th)?,? (\\d{4})$`,
    'iu',
  ).exec(value);
  if (english) {
    return one(
      iso(Number(english[3]), MONTH_NUMBER.get(english[1]!.toLowerCase())!, Number(english[2])),
    );
  }
  return INVALID;
}

function one(date: string | null): DateParse {
  return date ? { status: 'ok', iso: date } : INVALID;
}

/** Source of the date patterns the reader looks for in a line, as a single regex. */
export const DATE_IN_TEXT = new RegExp(
  [
    '\\d{4}-\\d{2}-\\d{2}',
    '\\d{1,2}\\.\\d{1,2}\\.(?:\\d{4}|\\d{2})',
    '\\d{1,2}([/-])\\d{1,2}\\1(?:\\d{4}|\\d{2})',
    `\\d{1,2}\\.? ?(?:${MONTH_WORD})\\.? ?,?\\d{4}`,
    `(?:${MONTH_WORD})\\.? \\d{1,2}(?:st|nd|rd|th)?,? \\d{4}`,
  ].join('|'),
  'giu',
);
