/**
 * An amount as printed, to minor units (öre, cent), exactly: bigint all the way, no float
 * (CLAUDE.md rule 5). Two decimals — every currency an invoice here is in has them.
 *
 * ## The separator is decided by rule
 *
 * `1 234,56`, `1.234,56`, `1,234.56`, `1'234.56` are all 1 234.56 and none needs a locale:
 * - both separators present: the last one is the decimal mark, the other groups thousands;
 * - one separator repeated: it groups thousands (`1.234.567`);
 * - one separator once, one or two digits after it: a decimal mark;
 * - one separator once, three digits after it, one to three before: **ask** — `1.234` is 1 234 if
 *   the dot groups thousands and cannot be a decimal amount of money, but a wrong thousands
 *   reading is a thousandfold error, so the reading is offered, never assumed;
 * - spaces (also no-break and narrow no-break, thin) group thousands only, in threes.
 *
 * Anything else is `invalid` and shown to the person as unread. Never a guess.
 */
export type AmountParse =
  { status: 'ok'; minor: bigint } | { status: 'ask'; candidates: bigint[] } | { status: 'invalid' };

const INVALID: AmountParse = { status: 'invalid' };

/** Currency words and marks around a number: they say nothing about its digits. */
const CURRENCY = /(?:SEK|NOK|DKK|EUR|USD|GBP|CHF|kr\.?|kronor|€|\$|£|:-|,-)/giu;
const SPACES = /[\u00a0\u202f\u2009]/g;

export function parseAmount(text: string): AmountParse {
  const bare = text.replace(CURRENCY, ' ').replace(SPACES, ' ').replace(/’/g, "'").trim();
  if (!/^\d[\d.,' ]*\d$|^\d$/.test(bare)) return INVALID;

  // Space and apostrophe only ever group thousands: three digits after each, none before a mark.
  const groups = bare.split(/[ ']/);
  if (groups.length > 1) {
    const tail = groups.slice(1);
    const lastWhole = tail.length - 1;
    // The last group may carry the decimal part: "234,56".
    const body = tail.map((group, i) =>
      i === lastWhole ? group.replace(/[.,]\d{1,2}$/, '') : group,
    );
    if (!/^\d{1,3}$/.test(groups[0]!) || !body.every((g) => /^\d{3}$/.test(g))) return INVALID;
    const last = tail[lastWhole]!;
    if (/[.,]/.test(last.replace(/[.,]\d{1,2}$/, ''))) return INVALID;
    const decimals = /[.,](\d{1,2})$/.exec(last)?.[1] ?? '';
    return ok(groups[0]! + body.join(''), decimals);
  }

  const marks = [...bare.matchAll(/[.,]/g)].map((m) => m[0]);
  if (marks.length === 0) return ok(bare, '');

  const last = Math.max(bare.lastIndexOf('.'), bare.lastIndexOf(','));
  const lastMark = bare[last]!;
  const before = bare.slice(0, last);
  const after = bare.slice(last + 1);
  const otherMark = lastMark === '.' ? ',' : '.';
  const grouped = (whole: string, mark: string) =>
    new RegExp(`^\\d{1,3}(?:\\${mark}\\d{3})+$`).test(whole);

  if (before.includes('.') && before.includes(',')) return INVALID;

  if (marks.every((m) => m === lastMark) && marks.length > 1) {
    // One separator repeated: thousands only.
    return grouped(bare, lastMark) ? ok(bare.replaceAll(lastMark, ''), '') : INVALID;
  }
  if (before.includes(otherMark)) {
    // Both kinds: the last is the decimal mark, the other must group by threes.
    if (!grouped(before, otherMark) || !/^\d{1,2}$/.test(after)) return INVALID;
    return ok(before.replaceAll(otherMark, ''), after);
  }
  // One mark, once.
  if (/^\d{1,2}$/.test(after) && /^\d+$/.test(before)) return ok(before, after);
  if (/^\d{3}$/.test(after) && /^[1-9]\d{0,2}$/.test(before)) {
    return { status: 'ask', candidates: [BigInt(before + after) * 100n] };
  }
  return INVALID;
}

function ok(whole: string, decimals: string): AmountParse {
  return { status: 'ok', minor: BigInt(whole) * 100n + BigInt(decimals.padEnd(2, '0') || '0') };
}
