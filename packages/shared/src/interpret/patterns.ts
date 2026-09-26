import type { Json } from '../builder/graph/schema.js';
import { lexiconFor, occurrences, type Language, type Lexicon } from './lexicon.js';
import { isCjk, probed, spanOf, tokenise, type Probed } from './text.js';

/**
 * T4 — values rather than options (`docs/plan/INTENT-LADDER.md`, "T4 — gazetteers and
 * patterns"). Each pattern is named and locked by rows in `fixtures/ladder/`: a quantity, an
 * amount of money, a date, an e-mail address, a phone number, a Swedish organisation number and a
 * Swedish personal identity number.
 *
 * Values are exact: an amount is a decimal string (`CLAUDE.md` rule 5), a date is `yyyy-mm-dd`,
 * and nothing is inferred that was not written — a personnummer's century is not guessed, because
 * guessing it needs today's date and the core has no clock. Two different values of one kind in
 * one input is no value at all: which was meant is a question, not a guess.
 */

export const PATTERN_KINDS = [
  'quantity',
  'currency',
  'date',
  'email',
  'phone',
  'orgNr',
  'personnummer',
] as const;
export type PatternKind = (typeof PATTERN_KINDS)[number];

export interface PatternReading {
  readonly kind: PatternKind;
  readonly value: Json;
  /** 850 when the pattern is the whole input, 750 when it is inside a phrase. */
  readonly confidence: 850 | 750;
  /** UTF-16 offsets into the input. */
  readonly span: readonly [number, number];
}

interface Found {
  readonly value: Json;
  readonly start: number;
  readonly end: number;
}

/** The one value found, or none when there was nothing or more than one different value. */
function single(kind: PatternKind, input: string, found: readonly Found[]): PatternReading | null {
  const distinct = new Set(found.map((f) => JSON.stringify(f.value)));
  if (distinct.size !== 1) return null;
  const first = found[0]!;
  return {
    kind,
    value: first.value,
    confidence: isWhole(input, first.start, first.end) ? 850 : 750,
    span: [first.start, first.end],
  };
}

/** The span covers everything but surrounding whitespace. */
function isWhole(input: string, start: number, end: number): boolean {
  const lead = input.length - input.trimStart().length;
  const trail = input.trimEnd().length;
  return start <= lead && end >= trail;
}

// --- quantity ----------------------------------------------------------------------------------

export type QuantityRefusal = 'vague' | 'negated' | 'ambiguous' | 'nothing';
export type QuantityRead =
  | {
      readonly value: number;
      readonly start: number;
      readonly end: number;
      readonly whole: boolean;
    }
  | { readonly refused: QuantityRefusal };

/** Words besides the number a phrase may have, stop words aside: "four buttons in a row". */
const PHRASE_WORDS = 3;

/** A run of CJK numerals (`二十一`, `十二`, `两`) as a number, or null if it is not one. */
function cjkNumeral(run: readonly string[], numerals: ReadonlyMap<string, number>): number | null {
  let total = 0;
  let digit: number | null = null;
  let lastUnit = Infinity;
  for (const character of run) {
    const value = numerals.get(character)!;
    if (value === 10 || value === 100) {
      if (value >= lastUnit) return null;
      total += (digit ?? 1) * value;
      digit = null;
      lastUnit = value;
    } else {
      if (digit !== null) return null;
      digit = value;
    }
  }
  return total + (digit ?? 0);
}

/**
 * A quantity — `^\d{1,3}$` or a number word, alone or inside a short phrase. Refused, never
 * guessed: a vague word ("some", "några") anywhere, a negator ("not four"), two different
 * numbers ("3 or 4"), or a phrase too long to be sure the number is the answer.
 */
export function readQuantity(input: string, lexicon: Lexicon): QuantityRead {
  const p = probed(input);
  const tokens = tokenise(p);
  if (occurrences(lexicon.vague, p, tokens).length > 0) return { refused: 'vague' };
  if (occurrences(lexicon.negators, p, tokens).length > 0) return { refused: 'negated' };

  const mentions: { value: number; start: number; end: number; tokens: readonly number[] }[] = [];
  // Number words, longest first, so `dix-sept` is 17 and not 10 and 7.
  const words = lexicon.numbers
    .flatMap((phrase) =>
      occurrences([phrase], p, tokens).map((o) => ({ ...o, value: phrase.value })),
    )
    .sort((a, b) => b.tokens.length - a.tokens.length || a.start - b.start);
  const covered = new Set<number>();
  for (const word of words) {
    if (word.tokens.some((i) => covered.has(i))) continue;
    word.tokens.forEach((i) => covered.add(i));
    mentions.push(word);
  }
  tokens.forEach((token, i) => {
    if (!covered.has(i) && /^[0-9]{1,3}$/.test(token.text)) {
      covered.add(i);
      mentions.push({
        value: Number.parseInt(token.text, 10),
        start: token.start,
        end: token.end,
        tokens: [i],
      });
    }
  });
  // Chinese and Japanese numerals, as runs of the probed text.
  const characters = [...p.text];
  const numeralSpans: [number, number][] = [];
  for (let i = 0, at = 0; i < characters.length;) {
    if (!lexicon.numerals.has(characters[i]!)) {
      at += characters[i]!.length;
      i += 1;
      continue;
    }
    const begin = at;
    const run: string[] = [];
    while (i < characters.length && lexicon.numerals.has(characters[i]!)) {
      run.push(characters[i]!);
      at += characters[i]!.length;
      i += 1;
    }
    const value = cjkNumeral(run, lexicon.numerals);
    if (value === null) return { refused: 'ambiguous' };
    const [start, end] = spanOf(p, begin, at);
    numeralSpans.push([start, end]);
    mentions.push({ value, start, end, tokens: [] });
  }

  if (mentions.length === 0) return { refused: 'nothing' };
  if (new Set(mentions.map((m) => m.value)).size > 1) return { refused: 'ambiguous' };

  // What else was said besides the number: anything at all makes it a phrase, and more than
  // PHRASE_WORDS words that are not stop words make it too long to be sure of. In Chinese and
  // Japanese, two characters count as a word.
  const inNumber = (start: number, end: number) =>
    mentions.some((m) => start >= m.start && end <= m.end);
  let rest = 0;
  let said = 0;
  tokens.forEach((token, i) => {
    if (covered.has(i) || token.cjk || inNumber(token.start, token.end)) return;
    rest += 1;
    if (!lexicon.stopWords.has(token.text)) said += 1;
  });
  let cjkSaid = 0;
  for (let at = 0; at < p.text.length;) {
    const character = String.fromCodePoint(p.text.codePointAt(at)!);
    const [start, end] = spanOf(p, at, at + character.length);
    if (isCjk(character) && !inNumber(start, end)) {
      rest += 1;
      if (!lexicon.stopWords.has(character)) cjkSaid += 1;
    }
    at += character.length;
  }
  if (said + Math.ceil(cjkSaid / 2) > PHRASE_WORDS) return { refused: 'nothing' };
  const first = mentions.sort((a, b) => a.start - b.start)[0]!;
  return { value: first.value, start: first.start, end: first.end, whole: rest === 0 };
}

// --- currency ----------------------------------------------------------------------------------

const AMOUNT = {
  ',': /(?<![\d.,])(\d{1,3}(?:[ .]\d{3})+|\d+)(?:,(\d{1,2}))?(?![\d]|[.,]\d)/g,
  '.': /(?<![\d.,])(\d{1,3}(?:[ ,]\d{3})+|\d+)(?:\.(\d{1,2}))?(?![\d]|[.,]\d)/g,
} as const;
const LETTER = /[\p{L}\p{N}]/u;

function readCurrency(input: string, lexicon: Lexicon): Found[] {
  const p = probed(input);
  const text = p.text;
  const markers = [...lexicon.currencies].sort(([a], [b]) => b.length - a.length);
  const markerAt = (at: number, before: boolean) => {
    for (const [marker, code] of markers) {
      const from = before ? at - marker.length : at;
      if (from < 0 || text.slice(from, from + marker.length).toLowerCase() !== marker) continue;
      const outside = before ? text[from - 1] : text[from + marker.length];
      // A word marker must be a whole word: `kr` is not the start of `krav`.
      if (LETTER.test(marker) && outside !== undefined && LETTER.test(outside)) continue;
      return { from, to: from + marker.length, code };
    }
    return null;
  };
  const found: Found[] = [];
  for (const match of text.matchAll(AMOUNT[lexicon.decimalSeparator])) {
    const start = match.index;
    const end = start + match[0].length;
    let after = end;
    while (text[after] === ' ') after += 1;
    let before = start;
    while (text[before - 1] === ' ') before -= 1;
    const marker = markerAt(after, false) ?? markerAt(before, true);
    if (!marker) continue;
    const whole = match[1]!.replace(/[ .,]/g, '');
    const amount = match[2] === undefined ? whole : `${whole}.${match[2]}`;
    const [from, to] = spanOf(p, Math.min(start, marker.from), Math.max(end, marker.to));
    found.push({ value: { amount, currency: marker.code }, start: from, end: to });
  }
  return found;
}

// --- date --------------------------------------------------------------------------------------

function daysIn(year: number, month: number): number {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function isoDate(year: number, month: number, day: number): string | null {
  if (year < 1000 || month < 1 || month > 12 || day < 1 || day > daysIn(year, month)) return null;
  const two = (n: number) => String(n).padStart(2, '0');
  return `${year}-${two(month)}-${two(day)}`;
}

const DATES: readonly {
  pattern: RegExp;
  ymd: (m: RegExpMatchArray, l: Lexicon) => number[] | null;
}[] = [
  { pattern: /(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/g, ymd: (m) => [+m[1]!, +m[2]!, +m[3]!] },
  { pattern: /(?<!\d)(\d{4})\/(\d{1,2})\/(\d{1,2})(?!\d)/g, ymd: (m) => [+m[1]!, +m[2]!, +m[3]!] },
  { pattern: /(\d{4})年(\d{1,2})月(\d{1,2})日/g, ymd: (m) => [+m[1]!, +m[2]!, +m[3]!] },
  {
    pattern: /(?<![\d./])(\d{1,2})([./])(\d{1,2})\2(\d{4})(?!\d)/g,
    ymd: (m) => [+m[4]!, +m[3]!, +m[1]!],
  },
  {
    pattern:
      /(?<![\p{L}\p{N}])(\d{1,2})(?:\.|er|st|nd|rd|th)?\s*(?:de\s+)?(\p{L}+)\.?\s*(?:de\s+|del\s+)?(\d{4})(?!\d)/giu,
    ymd: (m, lexicon) => {
      const month = lexicon.months.get(m[2]!.toLowerCase());
      return month === undefined ? null : [+m[3]!, month, +m[1]!];
    },
  },
];

function readDate(input: string, lexicon: Lexicon): Found[] {
  const p = probed(input);
  const found: Found[] = [];
  for (const { pattern, ymd } of DATES) {
    for (const match of p.text.matchAll(pattern)) {
      const parts = ymd(match, lexicon);
      const value = parts && isoDate(parts[0]!, parts[1]!, parts[2]!);
      if (!value) continue;
      const [start, end] = spanOf(p, match.index, match.index + match[0].length);
      found.push({ value, start, end });
    }
  }
  return found;
}

// --- e-mail, phone, organisation and personal numbers -------------------------------------------

/** The WHATWG `type=email` pattern. */
const EMAIL =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

function matches(p: Probed, pattern: RegExp, value: (m: RegExpMatchArray) => Json | null): Found[] {
  const found: Found[] = [];
  for (const match of p.text.matchAll(pattern)) {
    const v = value(match);
    if (v === null) continue;
    const [start, end] = spanOf(p, match.index, match.index + match[0].length);
    found.push({ value: v, start, end });
  }
  return found;
}

function readEmail(input: string): Found[] {
  return matches(probed(input), /[^\s<>()[\]",;:]+@[^\s<>()[\]",;:]*[^\s<>()[\]",;:.]/g, (m) =>
    EMAIL.test(m[0]) ? m[0] : null,
  );
}

function readPhone(input: string): Found[] {
  return matches(probed(input), /(?<![\d+])\+(?=[\d(])[\d \-()]*\d(?!\d)/g, (m) => {
    const digits = m[0].replace(/\D/g, '');
    return digits.length >= 7 && digits.length <= 15 ? `+${digits}` : null;
  });
}

/** The Luhn check as Swedish numbers use it: weights 2, 1, 2, 1, … from the first digit. */
export function luhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i += 1) {
    let d = digits.charCodeAt(i) - 48;
    if (i % 2 === 0) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

/** `NNNNNN-NNNN`, Luhn-valid, and — unlike a personnummer — a third digit of at least 2. */
function readOrgNr(input: string): Found[] {
  return matches(probed(input), /(?<![\d\-+])(\d{6})-(\d{4})(?![\d-])/g, (m) => {
    const ten = m[1]! + m[2]!;
    return ten.charCodeAt(2) >= 50 && luhn(ten) ? `${m[1]}-${m[2]}` : null;
  });
}

/**
 * `YYMMDD-NNNN`, `YYMMDD+NNNN` (over a hundred) or `YYYYMMDD-NNNN`, Luhn-valid over the last ten
 * digits, with a real month and day — a samordningsnummer's day is 61–91. Kept as written.
 */
function readPersonnummer(input: string): Found[] {
  return matches(probed(input), /(?<![\d\-+])(\d{8}|\d{6})([-+])(\d{4})(?![\d-])/g, (m) => {
    const [date, separator, last] = [m[1]!, m[2]!, m[3]!];
    if (date.length === 8 && separator === '+') return null;
    const ten = (date.length === 8 ? date.slice(2) : date) + last;
    const year = date.length === 8 ? +date.slice(0, 4) : 2000 + +date.slice(0, 2);
    const month = +ten.slice(2, 4);
    const rawDay = +ten.slice(4, 6);
    const day = rawDay > 60 ? rawDay - 60 : rawDay;
    if (month < 1 || month > 12 || day < 1 || day > daysIn(year, month)) return null;
    return luhn(ten) ? `${date}${separator}${last}` : null;
  });
}

/** A value of one kind in free text, or null. */
export function readPattern(
  kind: PatternKind,
  input: string,
  language: Language,
): PatternReading | null {
  const lexicon = lexiconFor(language);
  switch (kind) {
    case 'quantity': {
      const read = readQuantity(input, lexicon);
      return 'refused' in read
        ? null
        : {
            kind,
            value: read.value,
            confidence: read.whole ? 850 : 750,
            span: [read.start, read.end],
          };
    }
    case 'currency':
      return single(kind, input, readCurrency(input, lexicon));
    case 'date':
      return single(kind, input, readDate(input, lexicon));
    case 'email':
      return single(kind, input, readEmail(input));
    case 'phone':
      return single(kind, input, readPhone(input));
    case 'orgNr':
      return single(kind, input, readOrgNr(input));
    case 'personnummer':
      return single(kind, input, readPersonnummer(input));
  }
}
