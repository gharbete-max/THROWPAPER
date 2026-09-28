import { occurrences, type Lexicon } from './lexicon.js';
import { probed, tokenise } from './text.js';

/**
 * T5's clauses (`docs/plan/INTENT-LADDER.md`, T5): a sentence cut where it says several things —
 * at `, ; : . ! ?`, their CJK forms and line breaks, as every rung reads clauses, and at the
 * language's conjunctions ("and", "och", "und", 和). Each is a span of what was typed, trimmed to
 * its first and last letter or digit, so what a clause decides points at what was typed.
 */

export interface Clause {
  readonly start: number;
  readonly end: number;
}

const ENDS = /[,;:.!?\n\r、。，；：！？]/gu;
const WORD = /[\p{L}\p{N}\p{M}]/u;
const HIRAGANA = /\p{Script=Hiragana}/u;

export function clausesOf(input: string, lexicon: Lexicon): Clause[] {
  const cuts: [number, number][] = [...input.matchAll(ENDS)].map((m) => [
    m.index,
    m.index + m[0].length,
  ]);
  const p = probed(input);
  for (const conjunction of occurrences(lexicon.conjunctions, p, tokenise(p))) {
    // A conjunction written without spaces cuts only where it cannot be part of a word: Japanese
    // と after a kana word ending (ひとつ, "one") is inside it.
    const before = input.slice(0, conjunction.start).at(-1) ?? '';
    if (conjunction.tokens.length === 0 && HIRAGANA.test(before)) continue;
    cuts.push([conjunction.start, conjunction.end]);
  }
  cuts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  const clauses: Clause[] = [];
  const add = (from: number, to: number) => {
    let start = from;
    let end = to;
    while (start < end && !WORD.test(input[start]!)) start += 1;
    while (end > start && !WORD.test(input[end - 1]!)) end -= 1;
    if (start < end) clauses.push({ start, end });
  };
  let at = 0;
  for (const [start, end] of cuts) {
    if (start >= at) add(at, start);
    at = Math.max(at, end);
  }
  add(at, input.length);
  return clauses;
}
