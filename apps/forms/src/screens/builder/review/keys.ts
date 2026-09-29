/**
 * The review screen's keys — `docs/plan/IMPORT-PIPELINE.md` §8 — as a function from a key press to
 * what it does, so every rule is a test (`keys.test.ts`) and the screen only has to call it.
 *
 * | Key | Does |
 * | --- | --- |
 * | ↑ ↓ | the item before or after |
 * | 1–3 | the item's first, second or third chip |
 * | M | merge it with the item before |
 * | S | split it before its second line |
 * | T | "this is just text" |
 * | Q | "make this a question" |
 * | Enter | accept it — unless focus is on a button or link, which answers Enter itself |
 * | ⌘/Ctrl+Z | undo the last action |
 *
 * None of them while focus is in a text box, and no letter with ⌘, Ctrl or Alt held: those are
 * the browser's.
 */

export type ReviewKey =
  | { readonly kind: 'move'; readonly by: -1 | 1 }
  | { readonly kind: 'chip'; readonly index: 0 | 1 | 2 }
  | { readonly kind: 'merge' }
  | { readonly kind: 'split' }
  | { readonly kind: 'text' }
  | { readonly kind: 'question' }
  | { readonly kind: 'accept' }
  | { readonly kind: 'undo' };

export interface ReviewKeyPress {
  readonly key: string;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
}

export interface ReviewKeyContext {
  /** Focus is in a text box. */
  readonly typing: boolean;
  /** Focus is on a button, link or other control that answers Enter itself. */
  readonly onControl: boolean;
}

const LETTERS: Readonly<Record<string, ReviewKey>> = {
  m: { kind: 'merge' },
  s: { kind: 'split' },
  t: { kind: 'text' },
  q: { kind: 'question' },
};

/** The action for a key press, or null to leave it to the browser. */
export function reviewKey(press: ReviewKeyPress, context: ReviewKeyContext): ReviewKey | null {
  if (context.typing) return null;
  const command = press.ctrlKey || press.metaKey;
  if (command && !press.altKey && !press.shiftKey && press.key.toLowerCase() === 'z') {
    return { kind: 'undo' };
  }
  if (command || press.altKey) return null;
  if (press.key === 'ArrowDown') return { kind: 'move', by: 1 };
  if (press.key === 'ArrowUp') return { kind: 'move', by: -1 };
  if (press.key === '1' || press.key === '2' || press.key === '3') {
    return { kind: 'chip', index: (Number(press.key) - 1) as 0 | 1 | 2 };
  }
  if (press.key === 'Enter') return context.onControl ? null : { kind: 'accept' };
  if (press.shiftKey) return null;
  return LETTERS[press.key.toLowerCase()] ?? null;
}
