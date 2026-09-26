/**
 * The conversation's keys — `docs/plan/DESIGN-LANGUAGE.md`, "Keyboard and assistive technology" —
 * as a function from a key press to what it does, so every rule is a test (`keyboard.test.ts`,
 * `CAVEATS.md` #51) and the component only has to call it.
 *
 * | Key | Does |
 * | --- | --- |
 * | 1–9 | pick an answer, when no text box has focus |
 * | Alt+1–9 | pick an answer, anywhere |
 * | ⌘/Ctrl+1–9 | pick an answer — in the desktop app only: a browser keeps these for its tabs |
 * | Escape, ⌘/Ctrl+Z | back one step — but inside a text box with something in it, the box's own undo and clearing come first |
 * | Backspace | back one step, only when the text box it would edit is empty |
 * | ↑ ↓ ← → | move between answers, when no text box has focus |
 * | ? | the help line, when no text box has focus |
 *
 * Enter is not here: every answer is a real button, and a focused button already answers to it.
 */

export type KeyAction =
  | { readonly kind: 'pick'; readonly index: number }
  | { readonly kind: 'back' }
  | { readonly kind: 'move'; readonly by: -1 | 1 }
  | { readonly kind: 'help' };

export interface KeyPress {
  readonly key: string;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
}

export interface KeyContext {
  /** Focus is in a text box. */
  readonly typing: boolean;
  /** That text box is empty (meaningless when not typing). */
  readonly boxEmpty: boolean;
  /** Running in the desktop app, where ⌘/Ctrl+digit is ours to use. */
  readonly desktop: boolean;
  /** How many answers the node shows, in order. */
  readonly answers: number;
}

/** The action for a key press, or null to leave it to the browser. */
export function keyAction(press: KeyPress, context: KeyContext): KeyAction | null {
  const { key } = press;
  const command = press.ctrlKey || press.metaKey;

  // Physical digits: `key` is '1'…'9' without a modifier and with Ctrl/⌘, and Alt on a Mac types
  // '¡', '™'… — so Alt+digit is recognised by its position in the digit row as well.
  const digit = /^[1-9]$/.test(key) ? Number(key) : null;
  if (digit !== null) {
    const allowed = press.altKey ? true : command ? context.desktop : !context.typing;
    if (!allowed || press.shiftKey || digit > context.answers) return null;
    return { kind: 'pick', index: digit - 1 };
  }

  if (key === 'Escape') {
    if (context.typing && !context.boxEmpty) return null;
    return { kind: 'back' };
  }
  if (command && !press.shiftKey && !press.altKey && key.toLowerCase() === 'z') {
    // Inside a text box, ⌘Z undoes the typing first — it is the box's, not ours.
    if (context.typing) return null;
    return { kind: 'back' };
  }
  if (key === 'Backspace') {
    if (command || press.altKey) return null;
    if (context.typing && !context.boxEmpty) return null;
    return { kind: 'back' };
  }

  if (context.typing || command || press.altKey) return null;
  if (key === 'ArrowDown' || key === 'ArrowRight') return { kind: 'move', by: 1 };
  if (key === 'ArrowUp' || key === 'ArrowLeft') return { kind: 'move', by: -1 };
  if (key === '?') return { kind: 'help' };
  return null;
}

/** The digit an Alt+digit press was, from the key's code — Alt on a Mac changes `key`. */
export function digitOfCode(code: string): string | null {
  const match = /^(?:Digit|Numpad)([1-9])$/.exec(code);
  return match ? match[1]! : null;
}
