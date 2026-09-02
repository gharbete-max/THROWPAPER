import type { FormDefinition } from '@tp/shared/forms';

/**
 * Undo and redo for the builder — the logic, with no React in it.
 *
 * The builder autosaves 800ms after you stop typing. Without undo, removing a field is permanent
 * within a second, and a confirmation dialog is a poor substitute for being able to change your
 * mind. Every tool in this market has Ctrl+Z; one that autosaves and has no undo is worse than one
 * that does neither.
 *
 * ## Coalescing
 *
 * Typing a label fires an edit per keystroke. One undo step per character would make Ctrl+Z
 * useless — twenty presses to get back past a word. So **property edits in quick succession
 * collapse into one step**, while structural changes always begin a new one. Undo takes back
 * "renaming that question", not "the letter g".
 *
 * Structure is *compared* rather than declared: `edit` does not say what kind of change it is, and
 * asking every caller to would be one more thing to get wrong. The field ids in order are the
 * signature — different ids mean the shape changed.
 *
 * Kept free of React so it can be tested as a plain function, which is how everything else in this
 * repository is tested. The hook beside it is a five-line wrapper.
 */

/** Deep enough for a work session, shallow enough not to hold a form's whole history. */
export const MAX_DEPTH = 50;

/** Edits closer together than this are treated as one continuing change. */
export const COALESCE_MS = 700;

export interface History {
  /** Records `previous` as an undo point, given what it is being replaced by. */
  record: (previous: FormDefinition, next: FormDefinition) => void;
  /** What to go back to, or `null` when there is nothing to undo. */
  undo: (current: FormDefinition) => FormDefinition | null;
  redo: (current: FormDefinition) => FormDefinition | null;
  canUndo: () => boolean;
  canRedo: () => boolean;
  /** Forgets everything — used when a different form is loaded into the same screen. */
  reset: () => void;
}

export function createHistory(now: () => number = Date.now): History {
  let past: FormDefinition[] = [];
  let future: FormDefinition[] = [];
  let lastAt = 0;

  return {
    record(previous, next) {
      const at = now();
      const structural = shapeOf(previous) !== shapeOf(next);
      const continuing = !structural && at - lastAt < COALESCE_MS && past.length > 0;
      lastAt = at;

      // A redo stack only means anything while nothing new has happened.
      future = [];
      if (continuing) return;

      past.push(previous);
      if (past.length > MAX_DEPTH) past.shift();
    },

    undo(current) {
      const previous = past.pop();
      if (!previous) return null;
      future.push(current);
      // The next edit after an undo starts its own step rather than merging into what came before.
      lastAt = 0;
      return previous;
    },

    redo(current) {
      const next = future.pop();
      if (!next) return null;
      past.push(current);
      lastAt = 0;
      return next;
    },

    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,

    reset() {
      past = [];
      future = [];
      lastAt = 0;
    },
  };
}

/** The field ids in order — what changes when the form's shape changes rather than its wording. */
function shapeOf(definition: FormDefinition): string {
  return definition.fields.map((field) => field.id).join(',');
}
