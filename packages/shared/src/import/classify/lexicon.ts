import { z } from 'zod';
import { probed, tokenise, type Token } from '../../interpret/text.js';
import { LAYOUT_LANGUAGES, type LayoutLanguage } from '../layout/lexicon.js';
import da from './lexicon/da.json';
import de from './lexicon/de.json';
import en from './lexicon/en.json';
import es from './lexicon/es.json';
import fi from './lexicon/fi.json';
import fr from './lexicon/fr.json';
import is from './lexicon/is.json';
import ja from './lexicon/ja.json';
import nb from './lexicon/nb.json';
import ru from './lexicon/ru.json';
import sv from './lexicon/sv.json';
import zh from './lexicon/zh.json';
import { WORD_FEATURES, type WordFeature } from './types.js';

/**
 * Stage 5's word lists — `IMPORT-PIPELINE.md` §5, one file per language (ADR 0021: JSON,
 * provenance in a field, schema-validated on load) — and how a label is matched against them.
 *
 * Words are the interpreter's (`interpret/text.ts`): lower-cased, split at anything that is not a
 * letter, digit or mark, Chinese and Japanese as character pairs. Each word of a label is claimed
 * by at most one entry: whole words and phrases first, longest first, then the entries marked to
 * match the start (`telefon*`) or the end (`*adress`) of a word — so "E-mail address" is an
 * e-mail word and not also an address word, and "e-postadress" is not "adress".
 */

const LexiconSchema = z
  .object({
    source: z.string().min(1),
    lexiconVersion: z.literal(1),
    language: z.enum(LAYOUT_LANGUAGES),
    features: z
      .object(
        Object.fromEntries(WORD_FEATURES.map((f) => [f, z.array(z.string().min(1))])) as Record<
          WordFeature,
          z.ZodArray<z.ZodString>
        >,
      )
      .strict(),
    formats: z
      .object({ personnummerWord: z.string().min(1), orgNrWord: z.string().min(1) })
      .strict()
      .or(z.object({}).strict()),
  })
  .strict();
type Lexicon = z.infer<typeof LexiconSchema>;

const FILES: Record<LayoutLanguage, unknown> = { da, de, en, es, fi, fr, is, ja, nb, ru, sv, zh };
export const CLASSIFY_LEXICONS: Record<LayoutLanguage, Lexicon> = Object.fromEntries(
  LAYOUT_LANGUAGES.map((language) => {
    const lexicon = LexiconSchema.parse(FILES[language]);
    if (lexicon.language !== language) throw new Error(`classify/lexicon/${language}.json`);
    return [language, lexicon];
  }),
) as Record<LayoutLanguage, Lexicon>;

interface Entry {
  feature: WordFeature;
  language: LayoutLanguage;
  text: string;
  /** `symbol`: a sign that is no word at all (€, £, ₽), found anywhere in the label. */
  mode: 'exact' | 'prefix' | 'suffix' | 'symbol';
  /** The entry's words, as a label's words are made. */
  tokens: string[];
}

const ENTRIES: Entry[] = LAYOUT_LANGUAGES.flatMap((language) =>
  WORD_FEATURES.flatMap((feature) =>
    CLASSIFY_LEXICONS[language].features[feature].map((raw): Entry => {
      const text = raw.replace(/^\*|\*$/gu, '');
      const tokens = tokenise(probed(text.normalize('NFKC'))).map((token) => token.text);
      const mode =
        tokens.length === 0
          ? 'symbol'
          : raw.startsWith('*')
            ? 'suffix'
            : raw.endsWith('*')
              ? 'prefix'
              : 'exact';
      if (mode === 'symbol' && [...text].length !== 1) {
        throw new Error(
          `classify/lexicon/${language}.json: "${raw}" is neither words nor one sign`,
        );
      }
      if ((mode === 'prefix' || mode === 'suffix') && tokens.length !== 1) {
        throw new Error(
          `classify/lexicon/${language}.json: "${raw}" is an affix of more than one word`,
        );
      }
      return { feature, language, text: mode === 'symbol' ? text : raw, mode, tokens };
    }),
  ),
);

/** Whole phrases before affixes; longer before shorter; then a fixed order, so ties never move. */
const RANK = { exact: 0, prefix: 1, suffix: 1, symbol: 2 } as const;
const byStrength = (a: Entry, b: Entry) =>
  RANK[a.mode] - RANK[b.mode] ||
  b.tokens.length - a.tokens.length ||
  b.tokens.join(' ').length - a.tokens.join(' ').length ||
  WORD_FEATURES.indexOf(a.feature) - WORD_FEATURES.indexOf(b.feature) ||
  LAYOUT_LANGUAGES.indexOf(a.language) - LAYOUT_LANGUAGES.indexOf(b.language);
const ORDERED = [...ENTRIES].sort(byStrength);
/** Where each entry comes in that order, and the entries a label's words could start. */
const ORDER = new Map(ORDERED.map((entry, index) => [entry, index]));
const BY_FIRST_WORD = new Map<string, Entry[]>();
for (const entry of ORDERED) {
  if (entry.mode !== 'exact') continue;
  BY_FIRST_WORD.set(entry.tokens[0]!, [...(BY_FIRST_WORD.get(entry.tokens[0]!) ?? []), entry]);
}
const EVERYWHERE = ORDERED.filter((entry) => entry.mode !== 'exact');

/** The same entry in other languages' lists: a word they share counts for each of them. */
const keyOf = (entry: Entry) => `${entry.feature}|${entry.mode}|${entry.tokens.join(' ')}`;
const SHARED = new Map<string, Entry[]>();
for (const entry of ORDERED) SHARED.set(keyOf(entry), [...(SHARED.get(keyOf(entry)) ?? []), entry]);

export interface WordMatch {
  feature: WordFeature;
  language: LayoutLanguage;
  /** The entry as its file writes it. */
  entry: string;
  /** Indices of the label's words the entry claimed, and their span in the label. */
  from: number;
  to: number;
  start: number;
  end: number;
}

export interface LabelWords {
  tokens: Token[];
  matches: WordMatch[];
}

/** The lexicon's words in a label, from the given languages' lists. */
export function wordsIn(label: string, languages: readonly LayoutLanguage[]): LabelWords {
  const tokens = tokenise(probed(label));
  const texts = tokens.map((token) => token.text);
  const claimed = new Array<boolean>(tokens.length).fill(false);
  const matches: WordMatch[] = [];
  const allowed = new Set(languages);
  // Only entries that could match, in the same order as all of them: the result is the same.
  const candidates = [
    ...new Set([...texts.flatMap((text) => BY_FIRST_WORD.get(text) ?? []), ...EVERYWHERE]),
  ].sort((a, b) => ORDER.get(a)! - ORDER.get(b)!);
  for (const entry of candidates) {
    if (!allowed.has(entry.language)) continue;
    if (entry.mode === 'symbol') {
      const start = label.indexOf(entry.text);
      if (
        start >= 0 &&
        !matches.some((m) => m.entry === entry.text && m.feature === entry.feature)
      ) {
        matches.push({
          feature: entry.feature,
          language: entry.language,
          entry: entry.text,
          from: tokens.length,
          to: tokens.length,
          start,
          end: start + entry.text.length,
        });
      }
      continue;
    }
    const n = entry.tokens.length;
    for (let i = 0; i + n <= tokens.length; i += 1) {
      if (claimed.slice(i, i + n).some(Boolean)) continue;
      const word = texts[i]!;
      const hit =
        entry.mode === 'exact'
          ? entry.tokens.every((token, k) => texts[i + k] === token)
          : entry.mode === 'prefix'
            ? word.startsWith(entry.tokens[0]!)
            : word.endsWith(entry.tokens[0]!);
      if (!hit) continue;
      for (let k = i; k < i + n; k += 1) claimed[k] = true;
      for (const shared of SHARED.get(keyOf(entry))!) {
        if (shared === entry || !allowed.has(shared.language)) continue;
        matches.push({
          feature: shared.feature,
          language: shared.language,
          entry: shared.text,
          from: i,
          to: i + n,
          start: tokens[i]!.start,
          end: tokens[i + n - 1]!.end,
        });
      }
      matches.push({
        feature: entry.feature,
        language: entry.language,
        entry: entry.text,
        from: i,
        to: i + n,
        start: tokens[i]!.start,
        end: tokens[i + n - 1]!.end,
      });
    }
  }
  matches.sort(
    (a, b) =>
      a.start - b.start ||
      a.from - b.from ||
      LAYOUT_LANGUAGES.indexOf(a.language) - LAYOUT_LANGUAGES.indexOf(b.language),
  );
  return { tokens, matches };
}

/** The languages whose words are read: the document's and English, or all when it is unknown. */
export function languagesFor(locale: string | null): LayoutLanguage[] {
  const known = LAYOUT_LANGUAGES.find((language) => language === locale);
  return known ? [...new Set<LayoutLanguage>([known, 'en'])] : [...LAYOUT_LANGUAGES];
}

/** The format a language's personnummer or organisation-number word proposes, if it has one. */
export function formatOf(
  language: LayoutLanguage,
  feature: 'personnummerWord' | 'orgNrWord',
): string | null {
  const formats = CLASSIFY_LEXICONS[language].formats;
  return feature in formats ? (formats as Record<string, string>)[feature]! : null;
}
