import { z } from 'zod';
import currency from './gazetteers/currency.json';
import da from './gazetteers/da.json';
import de from './gazetteers/de.json';
import en from './gazetteers/en.json';
import es from './gazetteers/es.json';
import fi from './gazetteers/fi.json';
import fr from './gazetteers/fr.json';
import is from './gazetteers/is.json';
import ja from './gazetteers/ja.json';
import nb from './gazetteers/nb.json';
import ru from './gazetteers/ru.json';
import sv from './gazetteers/sv.json';
import zh from './gazetteers/zh.json';
import { clauseAt, isCjk, phraseTokens, type Probed, type Token } from './text.js';

/**
 * The words the ladder knows in each shipped language, as data — `docs/plan/INTENT-LADDER.md`
 * (ADR 0021: JSON, provenance in a field, schema-validated on load). One file per language in
 * `gazetteers/`, so whoever maintains a language finds all of its words in one place, and
 * `currency.json` for the markers that mean the same in every language.
 *
 * A word added to any of these is a behaviour change: it needs a row in
 * `fixtures/ladder/<language>.json` in the same commit.
 */

export const LANGUAGES = [
  'en',
  'sv',
  'da',
  'nb',
  'fi',
  'is',
  'de',
  'fr',
  'es',
  'zh',
  'ja',
  'ru',
] as const;
export type Language = (typeof LANGUAGES)[number];

/** The primary language subtag of a locale, if it is one Loppa ships: `sv-SE` → `sv`. */
export function languageOf(locale: string): Language | null {
  const primary = locale.slice(0, 2);
  return (LANGUAGES as readonly string[]).includes(primary) ? (primary as Language) : null;
}

const word = z.string().min(1).max(40);
const currencyCode = z.string().regex(/^[A-Z]{3}$/);

const LexiconFile = z
  .object({
    language: z.enum(LANGUAGES),
    source: z.string().min(1),
    /** Written in numbers: `3,5` or `3.5`; the other of `.` and `,` (and a space) groups thousands. */
    decimalSeparator: z.enum([',', '.']),
    /**
     * Normalisation step 6: 0–20, the tens and 100. In Chinese and Japanese the digits, 十 and 百
     * are read as numerals (二十一 is 21), and longer entries (ひとつ) as words.
     */
    numbers: z.record(word, z.number().int().min(0).max(100)),
    /** T1: words that do not count against "at most two other tokens"; never keywords. */
    stopWords: z.array(word),
    /** "No number from vagueness": never a quantity; the quantity node is asked. */
    vague: z.array(word),
    /** "Negation is honoured": before a node's keyword, they select its `negative` option. */
    negators: z.array(word),
    /** "but", "men", "aber": a negator's reach ends here, as it does at a comma. */
    contrast: z.array(word),
    /** The date pattern's month names, to their number. */
    months: z.record(word, z.number().int().min(1).max(12)),
    /** Currency words in this language, to their code — or null when they do not say which. */
    currencies: z.record(word, currencyCode.nullable()),
  })
  .strict();

const CurrencyFile = z
  .object({ source: z.string().min(1), markers: z.record(word, currencyCode) })
  .strict();

/** A word or phrase from a list, in the form it is matched in. */
export interface Phrase {
  readonly text: string;
  /** Chinese or Japanese: matched as a substring of the probed text, within one clause. */
  readonly cjk: boolean;
  /** Otherwise: the tokens it must match, in order, within one clause. */
  readonly tokens: readonly string[];
  readonly folded: readonly string[];
}

export interface Lexicon {
  readonly language: Language;
  readonly decimalSeparator: ',' | '.';
  readonly numbers: readonly (Phrase & { readonly value: number })[];
  /** Single CJK characters that are numerals: digits, 十 (10) and 百 (100). */
  readonly numerals: ReadonlyMap<string, number>;
  readonly stopWords: ReadonlySet<string>;
  readonly vague: readonly Phrase[];
  readonly negators: readonly Phrase[];
  readonly contrast: readonly Phrase[];
  readonly months: ReadonlyMap<string, number>;
  /** Every currency marker, this language's and the universal ones, lower-cased. */
  readonly currencies: ReadonlyMap<string, string | null>;
}

export function phraseOf(text: string): Phrase {
  const cjk = [...text].some(isCjk);
  const tokens = cjk ? [] : phraseTokens(text);
  return {
    text: text.normalize('NFKC').toLowerCase(),
    cjk,
    tokens: tokens.map((t) => t.text),
    folded: tokens.map((t) => t.folded),
  };
}

const FILES = { en, sv, da, nb, fi, is, de, fr, es, zh, ja, ru } as const;
const MARKERS = CurrencyFile.parse(currency).markers;

function load(language: Language): Lexicon {
  const file = LexiconFile.parse(FILES[language]);
  if (file.language !== language)
    throw new Error(`gazetteers/${language}.json says ${file.language}`);
  const numbers = Object.entries(file.numbers);
  const numeral = ([text]: [string, number]) => [...text].length === 1 && isCjk(text);
  return {
    language,
    decimalSeparator: file.decimalSeparator,
    numbers: numbers
      .filter((n) => !numeral(n))
      .map(([text, value]) => ({ ...phraseOf(text), value })),
    numerals: new Map(numbers.filter(numeral)),
    stopWords: new Set(file.stopWords.map((w) => w.normalize('NFKC').toLowerCase())),
    vague: file.vague.map(phraseOf),
    negators: file.negators.map(phraseOf),
    contrast: file.contrast.map(phraseOf),
    months: new Map(Object.entries(file.months).map(([m, n]) => [m.toLowerCase(), n])),
    currencies: new Map([
      ...Object.entries(MARKERS).map(([m, c]) => [m.toLowerCase(), c] as const),
      ...Object.entries(file.currencies).map(([m, c]) => [m.toLowerCase(), c] as const),
    ]),
  };
}

const LEXICONS = new Map(LANGUAGES.map((language) => [language, load(language)]));

export function lexiconFor(language: Language): Lexicon {
  return LEXICONS.get(language)!;
}

/** Where a phrase occurs: its input span, its clause, and the tokens it covers (none for CJK). */
export interface Occurrence {
  readonly start: number;
  readonly end: number;
  readonly clause: number;
  readonly tokens: readonly number[];
}

/**
 * Every occurrence of any of the phrases. A phrase of words matches a run of tokens in one clause,
 * each on its primary or its folded form; a CJK phrase matches the probed text, in one clause.
 */
export function occurrences(
  phrases: readonly Phrase[],
  p: Probed,
  tokens: readonly Token[],
): Occurrence[] {
  const found: Occurrence[] = [];
  let clauses: number[] | null = null;
  const lower = p.text.toLowerCase();
  const sameLength = lower.length === p.text.length;
  for (const phrase of phrases) {
    if (phrase.cjk) {
      if (!sameLength) continue;
      clauses ??= clauseAt(p);
      for (let at = lower.indexOf(phrase.text); at >= 0; at = lower.indexOf(phrase.text, at + 1)) {
        const end = at + phrase.text.length;
        if (clauses[at] !== clauses[end - 1]) continue;
        found.push({ start: p.from[at]!, end: p.to[end - 1]!, clause: clauses[at]!, tokens: [] });
      }
      continue;
    }
    const n = phrase.tokens.length;
    if (n === 0) continue;
    for (let i = 0; i + n <= tokens.length; i += 1) {
      let ok = true;
      for (let k = 0; k < n && ok; k += 1) {
        const token = tokens[i + k]!;
        ok =
          token.clause === tokens[i]!.clause &&
          (token.text === phrase.tokens[k] || token.folded === phrase.folded[k]);
      }
      if (ok) {
        const covered = Array.from({ length: n }, (_, k) => i + k);
        found.push({
          start: tokens[i]!.start,
          end: tokens[i + n - 1]!.end,
          clause: tokens[i]!.clause,
          tokens: covered,
        });
      }
    }
  }
  return found.sort((a, b) => a.start - b.start || b.end - a.end);
}
