import { probe } from '../import/enumerate/grammar.js';

/**
 * What typed text becomes before any tier reads it — `docs/plan/INTENT-LADDER.md`,
 * "Normalisation".
 *
 * Everything keeps the way back to what was typed. The input is cut into segments — a code point
 * and the combining marks that follow it — and each segment is normalised by itself, so every
 * character of the result knows the segment it came from. An evidence span is therefore always a
 * span of the input as typed, however NFKC reshaped it (`ﬁ` → `fi`, `３` → `3`), and the folded
 * form is never shown to anyone.
 */

/** The input, probed (`NUMBERING-RULES.md` §4: NFKC, quotes, dashes, fixed-width spaces). */
export interface Probed {
  readonly text: string;
  /** For each UTF-16 unit of `text`: where its segment starts and ends in the input. */
  readonly from: readonly number[];
  readonly to: readonly number[];
}

export interface Token {
  /** Lower-cased, from `Probed.text`. */
  readonly text: string;
  /** With combining marks removed after NFD: `å` → `a`. A match on it costs 50 per mille. */
  readonly folded: string;
  /** UTF-16 offsets into the input. */
  readonly start: number;
  readonly end: number;
  /** Which clause it is in: clauses end at `, ; : . ! ?` (and their CJK forms) and line breaks. */
  readonly clause: number;
  /** A character bigram of a Chinese or Japanese run — never compared fuzzily. */
  readonly cjk: boolean;
}

/** A code point with the combining marks that follow it. */
const SEGMENT = /\P{M}\p{M}*|\p{M}+/gu;

export function probed(input: string): Probed {
  let text = '';
  const from: number[] = [];
  const to: number[] = [];
  for (const match of input.matchAll(SEGMENT)) {
    const start = match.index;
    const end = start + match[0].length;
    const piece = probe(match[0]);
    text += piece;
    for (let i = 0; i < piece.length; i += 1) {
      from.push(start);
      to.push(end);
    }
  }
  return { text, from, to };
}

/** The input span of `text.slice(start, end)`. */
export function spanOf(p: Probed, start: number, end: number): [number, number] {
  if (end <= start) return [p.from[start] ?? 0, p.from[start] ?? 0];
  return [p.from[start]!, p.to[end - 1]!];
}

/** Letters, digits and marks make words; everything else separates them. */
const WORD = /[\p{L}\p{N}\p{M}]+/gu;
const CLAUSE_END = /[,;:.!?\n\r、。，；：！？]/u;
/** Han, Hiragana, Katakana, the prolonged-sound mark and the iteration mark. */
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー々]/u;

export const isCjk = (character: string): boolean => CJK.test(character);

type Kind = 'cjk' | 'digit' | 'word';
const MARK = /\p{M}/u;
const DIGIT = /\p{Nd}/u;
const kindOf = (character: string): Kind =>
  isCjk(character) ? 'cjk' : DIGIT.test(character) ? 'digit' : 'word';

export function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '');
}

/**
 * The tokens of probed text: words, lower-cased, each with its folded form, span and clause. A run
 * of Chinese or Japanese characters has no spaces to split on, so it becomes overlapping character
 * bigrams instead (one character alone stays itself).
 */
export function tokenise(p: Probed): Token[] {
  const tokens: Token[] = [];
  let clause = 0;
  let scanned = 0;
  const push = (start: number, end: number, cjk: boolean) => {
    const text = p.text.slice(start, end).toLowerCase();
    const [from, to] = spanOf(p, start, end);
    tokens.push({ text, folded: fold(text), start: from, end: to, clause, cjk });
  };
  for (const match of p.text.matchAll(WORD)) {
    for (const character of p.text.slice(scanned, match.index)) {
      if (CLAUSE_END.test(character)) clause += 1;
    }
    scanned = match.index + match[0].length;
    // Split the word into runs of CJK, of digits and of everything else: `4个` and `4st` are a
    // number and a word, as `4 个` and `4 st` are.
    let offset = match.index;
    let run: { start: number; kind: Kind; characters: string[] } | null = null;
    const flush = () => {
      if (!run) return;
      if (run.kind !== 'cjk' || run.characters.length === 1) {
        push(run.start, run.start + run.characters.join('').length, run.kind === 'cjk');
      } else {
        let at = run.start;
        for (let i = 0; i + 1 < run.characters.length; i += 1) {
          const first = run.characters[i]!;
          push(at, at + first.length + run.characters[i + 1]!.length, true);
          at += first.length;
        }
      }
      run = null;
    };
    for (const character of match[0]) {
      // A combining mark stays with what it marks.
      const kind: Kind = run && MARK.test(character) ? run.kind : kindOf(character);
      if (!run || run.kind !== kind) {
        flush();
        run = { start: offset, kind, characters: [] };
      }
      run.characters.push(character);
      offset += character.length;
    }
    flush();
  }
  return tokens;
}

/** The clause indices of probed text, per UTF-16 unit — for matching CJK phrases by position. */
export function clauseAt(p: Probed): number[] {
  const clauses: number[] = [];
  let clause = 0;
  for (const character of p.text) {
    for (let i = 0; i < character.length; i += 1) clauses.push(clause);
    if (CLAUSE_END.test(character)) clause += 1;
  }
  return clauses;
}

/** A phrase from a word list or an alias, as the tokens it must match. */
export function phraseTokens(phrase: string): Token[] {
  return tokenise(probed(phrase));
}

/** Text as T0 compares it: its tokens, joined by one space. `Side-by-side!` is `side by side`. */
export function keyOf(text: string): string {
  return phraseTokens(text)
    .map((token) => token.text)
    .join(' ');
}

/** Code-point order, which JavaScript's `<` on strings is not beyond the BMP. */
export function compareCodePoints(a: string, b: string): number {
  const ca = [...a];
  const cb = [...b];
  for (let i = 0; i < ca.length && i < cb.length; i += 1) {
    const d = ca[i]!.codePointAt(0)! - cb[i]!.codePointAt(0)!;
    if (d !== 0) return d;
  }
  return ca.length - cb.length;
}
