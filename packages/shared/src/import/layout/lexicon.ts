import { z } from 'zod';
import data from './lexicon.json';

/**
 * Stage 2's word lists — `IMPORT-PIPELINE.md` §2.6 (page numbers) and §2.11 (the document's
 * language) — as data (ADR 0021: JSON, provenance in a field, schema-validated on load).
 */

/** The twelve languages the product ships, as BCP 47 language subtags. */
export const LAYOUT_LANGUAGES = [
  'da',
  'de',
  'en',
  'es',
  'fi',
  'fr',
  'is',
  'ja',
  'nb',
  'ru',
  'sv',
  'zh',
] as const;
export type LayoutLanguage = (typeof LAYOUT_LANGUAGES)[number];

const words = z.array(z.string().min(1)).min(1);
const perLanguage = <T extends z.ZodTypeAny>(schema: T) =>
  z
    .object(
      Object.fromEntries(LAYOUT_LANGUAGES.map((language) => [language, schema])) as Record<
        LayoutLanguage,
        T
      >,
    )
    .strict();

const LexiconSchema = z
  .object({
    source: z.string().min(1),
    lexiconVersion: z.literal(1),
    pageNumbers: perLanguage(words).extend({ all: words }).strict(),
    conjunctions: perLanguage(words),
    stopwords: perLanguage(words),
  })
  .strict();

export type LayoutLexicon = z.infer<typeof LexiconSchema>;

export const LAYOUT_LEXICON: LayoutLexicon = LexiconSchema.parse(data);

/**
 * The key a margin line is compared by (§2.6): NFKC, lower case, every digit run replaced by `#`,
 * whitespace collapsed. "Sida 2 av 3" and "Sida 3 av 3" have one key, "sida # av #".
 */
export function furnitureKey(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\p{Nd}+/gu, '#')
    .replace(/\s+/gu, ' ')
    .trim();
}

const PAGE_NUMBER_KEYS: ReadonlySet<string> = new Set(
  Object.values(LAYOUT_LEXICON.pageNumbers).flat(),
);

/** A key that is a page number in one of the shipped languages ("#", "sida # av #", "第#页"). */
export function isPageNumberKey(key: string): boolean {
  return PAGE_NUMBER_KEYS.has(key);
}

const CONJUNCTIONS: ReadonlySet<string> = new Set(
  Object.values(LAYOUT_LEXICON.conjunctions).flat(),
);

/** §2.4: a word a suspended compound's hyphen stands before — "för-" is not broken before "och". */
export function isConjunction(word: string): boolean {
  return CONJUNCTIONS.has(word.normalize('NFKC').toLowerCase());
}

const ALL_STOPWORDS: ReadonlyMap<LayoutLanguage, ReadonlySet<string>> = new Map(
  LAYOUT_LANGUAGES.map((language) => [language, new Set(LAYOUT_LEXICON.stopwords[language])]),
);

/**
 * Each language's stop words, less every word another language lists too: "som", "på" and "med"
 * are as Norwegian and Danish as they are Swedish, so they tell none of the three apart.
 */
const OWN_STOPWORDS: ReadonlyMap<LayoutLanguage, ReadonlySet<string>> = (() => {
  const languagesOf = new Map<string, number>();
  for (const words of ALL_STOPWORDS.values()) {
    for (const word of words) languagesOf.set(word, (languagesOf.get(word) ?? 0) + 1);
  }
  return new Map(
    [...ALL_STOPWORDS].map(([language, words]) => [
      language,
      new Set([...words].filter((word) => languagesOf.get(word) === 1)),
    ]),
  );
})();

/** The words that tell a language apart: its stop words that no other language lists. */
export function distinctiveStopwords(language: LayoutLanguage): ReadonlySet<string> {
  return OWN_STOPWORDS.get(language) ?? new Set();
}

/** §2.11: the language needs at least this many stop words, shared ones included — enough prose; */
export const LOCALE_MIN_HITS = 20;
/** and at least this many of its own, and twice the runner-up's own — enough to tell it apart. */
export const LOCALE_MIN_OWN = 5;

/**
 * Tokens as §2.11 counts them: NFKC, lower case; a Chinese or Japanese character is a token of its
 * own (neither language puts spaces between words), any other run of letters is one token.
 */
export function localeTokens(text: string): string[] {
  const spaced = text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}])/gu, ' $1 ');
  return spaced.match(/[\p{L}\p{M}]+/gu) ?? [];
}

export interface LocaleCount {
  /** The language, or null when §2.11 is not sure. */
  locale: LayoutLanguage | null;
  /** The language with the most words of its own (the first in order of equals), and its counts. */
  best: LayoutLanguage | null;
  /** Its stop words, shared ones included. */
  hits: number;
  /** Its own stop words, and the runner-up's. */
  own: number;
  runnerUp: number;
}

/**
 * §2.11: the document's language from its stop words, or null when it is not sure. There must be
 * enough prose in the language — 20 of its stop words, shared ones included — and enough words of
 * its own to tell it from its neighbours: at least 5, and twice the runner-up's. Swedish, Danish
 * and Norwegian share most of their commonest words, so counting shared words for all three, as
 * §2.11 was first written, made every Scandinavian document a near tie.
 */
export function documentLocale(texts: readonly string[]): LocaleCount {
  const hits = new Map<LayoutLanguage, number>();
  const own = new Map<LayoutLanguage, number>();
  for (const text of texts) {
    for (const token of localeTokens(text)) {
      for (const language of LAYOUT_LANGUAGES) {
        if (ALL_STOPWORDS.get(language)?.has(token))
          hits.set(language, (hits.get(language) ?? 0) + 1);
        if (OWN_STOPWORDS.get(language)?.has(token))
          own.set(language, (own.get(language) ?? 0) + 1);
      }
    }
  }
  let best: LayoutLanguage | null = null;
  let top = 0;
  let runnerUp = 0;
  for (const language of LAYOUT_LANGUAGES) {
    const n = own.get(language) ?? 0;
    if (n > top) {
      runnerUp = top;
      top = n;
      best = language;
    } else if (n > runnerUp) {
      runnerUp = n;
    }
  }
  const total = best ? (hits.get(best) ?? 0) : 0;
  const sure = total >= LOCALE_MIN_HITS && top >= LOCALE_MIN_OWN && top >= runnerUp * 2;
  return { locale: sure ? best : null, best, hits: total, own: top, runnerUp };
}

/** G1b: at least this many letters in a script one language owns, and more than half of all. */
export const SCRIPT_MIN_LETTERS = 20;

export interface ScriptCount {
  /** The language whose script the letters are in, or null when G1b does not decide. */
  locale: LayoutLanguage | null;
  /** The script, as Unicode names it ('Han' with kana counts as Japanese). */
  script: 'Cyrillic' | 'Japanese' | 'Han' | null;
  /** The letters in that script, and every letter read. */
  inScript: number;
  letters: number;
}

/**
 * G1b (#145): the language a script tells, whatever the stop words. Of the twelve, only Russian
 * writes Cyrillic, only Japanese writes kana, and Chinese writes Han with no kana at all — so a
 * short form in one of them, too short for §2.11's twenty stop words, is still known. Latin is
 * shared, so it tells nothing. NFKC first, as `localeTokens` does: a full-width Latin letter is Latin.
 */
export function scriptLocale(texts: readonly string[]): ScriptCount {
  let letters = 0;
  let cyrillic = 0;
  let kana = 0;
  let han = 0;
  for (const text of texts) {
    for (const char of text.normalize('NFKC')) {
      if (!/\p{L}/u.test(char)) continue;
      letters += 1;
      if (/\p{Script=Cyrillic}/u.test(char)) cyrillic += 1;
      else if (/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(char)) kana += 1;
      else if (/\p{Script=Han}/u.test(char)) han += 1;
    }
  }
  const owns = (n: number) => n >= SCRIPT_MIN_LETTERS && n * 2 > letters;
  if (owns(cyrillic)) return { locale: 'ru', script: 'Cyrillic', inScript: cyrillic, letters };
  if (kana > 0 && owns(kana + han))
    return { locale: 'ja', script: 'Japanese', inScript: kana + han, letters };
  if (kana === 0 && owns(han)) return { locale: 'zh', script: 'Han', inScript: han, letters };
  return { locale: null, script: null, inScript: 0, letters };
}
