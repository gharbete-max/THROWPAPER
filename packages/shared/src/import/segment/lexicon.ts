import { z } from 'zod';
import { LAYOUT_LANGUAGES, type LayoutLanguage } from '../layout/lexicon.js';
import data from './lexicon.json';

/**
 * Stage 4's word lists — `IMPORT-PIPELINE.md` §4 — as data (ADR 0021: JSON, provenance in a
 * field, schema-validated on load). Every language's list is used whatever the document's
 * language: a yes/no pair or a pointer at "the table below" means the same wherever it is found,
 * and the document's language is often unknown.
 */

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

const SegmentLexiconSchema = z
  .object({
    source: z.string().min(1),
    lexiconVersion: z.literal(1),
    booleanPairs: perLanguage(z.array(z.tuple([z.string().min(1), z.string().min(1)])).min(1)),
    tableWords: perLanguage(words),
    metaWords: perLanguage(words),
  })
  .strict();

const LEXICON = SegmentLexiconSchema.parse(data);

/** Text as the lists are compared: NFKC, lower-cased. */
export const folded = (text: string) => text.normalize('NFKC').toLowerCase();

const PAIRS = new Set(
  LAYOUT_LANGUAGES.flatMap((language) =>
    LEXICON.booleanPairs[language].map(([yes, no]) => `${folded(yes)}\u0000${folded(no)}`),
  ),
);

/** Two options that are a yes/no pair in a shipped language, in that order (rule 4). */
export function isBooleanPair(options: readonly string[]): boolean {
  return options.length === 2 && PAIRS.has(`${folded(options[0]!)}\u0000${folded(options[1]!)}`);
}

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
const TABLE_WORDS = LAYOUT_LANGUAGES.flatMap((language) => LEXICON.tableWords[language]).map(
  folded,
);

/** Text that points at a table: a word starting with a table word, or a CJK one inside it. */
export function mentionsTable(text: string): boolean {
  const lower = folded(text);
  const tokens = lower.match(/[\p{L}\p{M}]+/gu) ?? [];
  return TABLE_WORDS.some((word) =>
    CJK.test(word) ? lower.includes(word) : tokens.some((token) => token.startsWith(word)),
  );
}

const META_WORDS = new Set(
  LAYOUT_LANGUAGES.flatMap((language) => LEXICON.metaWords[language]).map(folded),
);
/** A form number or revision: upper case, digits and their punctuation, with a digit in it. */
const META_CODE = /^(?:nr\.?|no\.?|#)?[\p{Lu}\d][\p{Lu}\d./-]*$/u;

/**
 * Rule 9: a line that is a form number or a revision and nothing else — "Blankett 1234",
 * "Form A-12", "Rev. 2024-03" — at most four words, the first a form or revision word.
 */
export function isMetaLine(text: string): boolean {
  const parts = text.split(' ');
  if (parts.length < 2 || parts.length > 4) return false;
  const head = folded(parts[0]!).replace(/[.:]+$/u, '');
  const rest = parts.slice(1);
  return (
    META_WORDS.has(head) &&
    rest.every((part) => META_CODE.test(part)) &&
    rest.some((part) => /\d/u.test(part))
  );
}
