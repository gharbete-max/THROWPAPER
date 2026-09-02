/**
 * Whether a form author's regular expression can be run against a stranger's answer.
 *
 * ## The problem
 *
 * A `pattern` rule is written by a customer in the builder and then executed by **our** server on
 * text supplied by whoever is filling in the form. JavaScript's regex engine backtracks, so a
 * pattern with a quantifier applied to a group that itself contains one — `(a+)+`, `(\d*)*`,
 * `([a-z]+)*` — takes exponential time on input that nearly matches.
 *
 * That is not a slow request. It is a synchronous loop with no yield, on a single-threaded server:
 * one submission stalls every other tenant sharing the process, for as long as it runs. The
 * previous guard capped the *pattern* at 200 characters and mentioned "no user-supplied flags",
 * neither of which has anything to do with backtracking — 200 characters is far more than enough.
 *
 * ## What this does about it
 *
 * A deliberately conservative structural check: a quantified group whose body also quantifies.
 * That is the shape behind essentially every catastrophic-backtracking example anybody hits by
 * accident, and it is cheap and explainable. It is **not** a proof of safety — writing one would
 * mean implementing a linear-time engine — so it is paired with a length cap on the text being
 * matched, and with refusing such patterns at publish time where a person can be told why.
 */

/** Longer than any answer a `pattern` rule is meant to police, and short enough to bound the work. */
export const MAX_MATCHED_LENGTH = 4096;

const UNBOUNDED = new Set(['*', '+']);

/**
 * True when `pattern` nests one unbounded quantifier inside another.
 *
 * Character classes are skipped, so `[+*]+` — a class *containing* those characters — is read as
 * the literal class it is rather than as a quantifier.
 */
export function isDangerousPattern(pattern: string): boolean {
  const openGroups: number[] = [];

  for (let at = 0; at < pattern.length; at += 1) {
    const character = pattern[at]!;

    if (character === '\\') {
      // An escaped character is a literal, including an escaped bracket or quantifier.
      at += 1;
      continue;
    }

    if (character === '[') {
      // Skip to the end of the class; quantifiers inside it are ordinary characters.
      at += 1;
      while (at < pattern.length && pattern[at] !== ']') {
        if (pattern[at] === '\\') at += 1;
        at += 1;
      }
      continue;
    }

    if (character === '(') {
      openGroups.push(at);
      continue;
    }

    if (character === ')') {
      const start = openGroups.pop();
      if (start === undefined) continue;
      if (!isQuantified(pattern, at)) continue;
      // The group repeats. If its body also repeats, the two nest.
      if (containsUnbounded(pattern.slice(start + 1, at))) return true;
    }
  }

  return false;
}

/** Whether the token ending at `at` is followed by a quantifier that can repeat without bound. */
function isQuantified(pattern: string, at: number): boolean {
  const next = pattern[at + 1];
  if (next === undefined) return false;
  if (UNBOUNDED.has(next)) return true;
  // `{2,}` repeats without an upper bound; `{2,5}` does not.
  if (next !== '{') return false;
  const close = pattern.indexOf('}', at + 1);
  if (close === -1) return false;
  return /^\{\d*,\s*\}$/.test(pattern.slice(at + 1, close + 1));
}

/** An unbounded quantifier somewhere in this fragment, ignoring character classes and escapes. */
function containsUnbounded(body: string): boolean {
  for (let at = 0; at < body.length; at += 1) {
    const character = body[at]!;
    if (character === '\\') {
      at += 1;
      continue;
    }
    if (character === '[') {
      at += 1;
      while (at < body.length && body[at] !== ']') {
        if (body[at] === '\\') at += 1;
        at += 1;
      }
      continue;
    }
    if (UNBOUNDED.has(character)) return true;
    if (character === '{' && /^\{\d*,\s*\}/.test(body.slice(at))) return true;
  }
  return false;
}
