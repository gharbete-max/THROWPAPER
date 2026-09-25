import { z } from 'zod';
import data from './gazetteers.json';
import { probe } from './grammar.js';

/**
 * The word lists the vetoes and V7 match against — `docs/plan/NUMBERING-RULES.md` §9, as data
 * (ADR 0021: JSON, provenance in a field, schema-validated on load).
 */

const GazetteersSchema = z
  .object({
    source: z.string().min(1),
    unitWords: z.array(z.string().min(1)).min(1),
    months: z.array(z.string().min(1)).min(1),
    continuation: z
      .array(
        z
          .object({
            language: z.string().min(2),
            /** `word`: whole words; `substring`: anywhere (CJK, which has no spaces). */
            match: z.enum(['word', 'substring']),
            phrases: z.array(z.string().min(1)).min(1),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

export type Gazetteers = z.infer<typeof GazetteersSchema>;

export const GAZETTEERS: Gazetteers = GazetteersSchema.parse(data);

/** CONT_MAX (§2): a continuation notice is at most this many code points of probe. */
export const CONT_MAX = 60;

const UNIT_WORDS = new Set(GAZETTEERS.unitWords);
const MONTHS = new Set(GAZETTEERS.months);
const WHOLE_WORD = GAZETTEERS.continuation.flatMap((l) => (l.match === 'word' ? l.phrases : []));
const ANYWHERE = GAZETTEERS.continuation.flatMap((l) => (l.match === 'substring' ? l.phrases : []));

/**
 * `f` of §5: the word as the gazetteers are matched against it — probe, lower-cased, with any
 * trailing `. , ; : ! ? )` removed.
 */
export function gazetteerForm(word: string): string {
  return probe(word)
    .toLowerCase()
    .replace(/[.,;:!?)]+$/, '');
}

export const isUnitWord = (f: string): boolean => UNIT_WORDS.has(f);
export const isMonth = (f: string): boolean => MONTHS.has(f);

/** A letter, a digit or a combining mark: what may not touch a whole-word match on either side. */
const WORD_CHARACTER = /[\p{L}\p{N}\p{M}]/u;

function containsWholeWord(text: string, phrase: string): boolean {
  for (let at = text.indexOf(phrase); at >= 0; at = text.indexOf(phrase, at + 1)) {
    // Whole code points, not UTF-16 units: a letter outside the BMP is still a letter.
    const before = [...text.slice(0, at)].at(-1) ?? '';
    const after = [...text.slice(at + phrase.length)][0] ?? '';
    if (!WORD_CHARACTER.test(before) && !WORD_CHARACTER.test(after)) return true;
  }
  return false;
}

/** V7: a short line that says the list goes on elsewhere ("Forts. på nästa sida", "PTO"). */
export function isContinuationNotice(text: string): boolean {
  const probed = probe(text);
  if ([...probed].length > CONT_MAX) return false;
  const lower = probed.toLowerCase();
  return (
    ANYWHERE.some((phrase) => lower.includes(phrase)) ||
    WHOLE_WORD.some((phrase) => containsWholeWord(lower, phrase))
  );
}
