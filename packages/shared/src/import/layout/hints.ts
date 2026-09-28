import type { LineHints } from '../ir/types.js';

/**
 * What a line's text alone says for certain — `LAYOUT-IR.md`, `LineHints`: a blank to write in, a
 * checkbox, a closing colon. Shared by every producer (the paste layout, stage 2), so a pasted line
 * and a line read from a PDF are described by the same rule.
 */

/** The checkbox glyphs `LineHints.checkboxes` counts. */
export const CHECKBOX_GLYPHS = '☐☑☒□■▢○●◯◻◼';
const CHECKBOXES = new RegExp(`[${CHECKBOX_GLYPHS}]`, 'gu');

/** A run of dots, counted with "…" as three. */
const dotCount = (run: string) => [...run].reduce((n, c) => n + (c === '…' ? 3 : 1), 0);

/** At least three `_`, or at least four leader dots. */
function hasBlankRun(text: string): boolean {
  if (/_{3,}/u.test(text)) return true;
  return (text.match(/[.…]{2,}/gu) ?? []).some((run) => dotCount(run) >= 4);
}

/** The text with its blank runs removed, for `endsWithColon`. */
function withoutBlanks(text: string): string {
  return text
    .replace(/_{3,}/gu, '')
    .replace(/[.…]{2,}/gu, (run) => (dotCount(run) >= 4 ? '' : run));
}

/** A word that is nothing but a blank to write in: `______`, `……`, `.........`. */
export function isBlankWord(text: string): boolean {
  return hasBlankRun(text) && /^[_.…:]+$/u.test(text);
}

/** A word that is one checkbox glyph. */
export function isCheckboxWord(text: string): boolean {
  return [...text].length === 1 && CHECKBOX_GLYPHS.includes(text);
}

/** The hints a line's text gives. `ruleBelow` and `docxNumbering` are the caller's facts. */
export function textHints(
  text: string,
  facts: Pick<LineHints, 'ruleBelow' | 'docxNumbering'> = { ruleBelow: false, docxNumbering: null },
): LineHints {
  return {
    blankRun: hasBlankRun(text),
    checkboxes: (text.match(CHECKBOXES) ?? []).length,
    endsWithColon: withoutBlanks(text).trim().endsWith(':'),
    ruleBelow: facts.ruleBelow,
    docxNumbering: facts.docxNumbering,
  };
}
