import type { LineHints } from '../ir/types.js';

/**
 * What a line's text alone says for certain — `LAYOUT-IR.md`, `LineHints`: a blank to write in, a
 * checkbox, a closing colon. Shared by every producer (the paste layout, stage 2), so a pasted line
 * and a line read from a PDF are described by the same rule.
 */

/** The checkbox glyphs `LineHints.checkboxes` counts. */
export const CHECKBOX_GLYPHS = '☐☑☒□■▢○●◯◻◼';
const CHECKBOXES = new RegExp(`[${CHECKBOX_GLYPHS}]`, 'gu');

/** The full-width forms Chinese and Japanese write a blank, a colon and a question with (#144). */
const FULL_WIDTH: Readonly<Record<string, string>> = { '＿': '_', '：': ':', '？': '?', '．': '.' };

/**
 * Full-width punctuation as its ASCII form, one code point for one, so positions in the text are
 * kept: "氏名：＿＿＿" reads as "氏名:___" (#144). For matching only; nothing stored is folded.
 */
export const halfWidth = (text: string) => text.replace(/[＿：？．]/gu, (c) => FULL_WIDTH[c] ?? c);

/**
 * A Chinese or Japanese character, its punctuation and its full-width forms: "、", "。", "（", "＿",
 * and the katakana block's "ー".
 */
const CJK =
  '[\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\u3000-\\u303F\\u30A0-\\u30FF\\uFF00-\\uFFEF]';
const ENDS_CJK = new RegExp(`${CJK}$`, 'u');
const STARTS_CJK = new RegExp(`^${CJK}`, 'u');
/** Whether a text ends, or starts, with a Chinese or Japanese character. */
export const endsWithCjk = (text: string) => ENDS_CJK.test(text);
export const startsWithCjk = (text: string) => STARTS_CJK.test(text);

/**
 * Lines of one paragraph or label as one text: one space between them, except between two Chinese
 * or Japanese characters, where the page has none (#147) — "…のうえ、" and "事務局まで…" are one
 * sentence the line broke, not two words.
 */
export function joinLines(texts: readonly string[]): string {
  let joined = '';
  for (const text of texts) {
    if (joined === '') joined = text;
    else if (text === '') continue;
    else joined += endsWithCjk(joined) && startsWithCjk(text) ? text : ` ${text}`;
  }
  return joined;
}

/** A run of dots, counted with "…" as three. */
const dotCount = (run: string) => [...run].reduce((n, c) => n + (c === '…' ? 3 : 1), 0);

/** At least three `_`, or at least four leader dots. */
function hasBlankRun(text: string): boolean {
  const folded = halfWidth(text);
  if (/_{3,}/u.test(folded)) return true;
  return (folded.match(/[.…]{2,}/gu) ?? []).some((run) => dotCount(run) >= 4);
}

/** The text with its blank runs removed, for `endsWithColon`. */
function withoutBlanks(text: string): string {
  return halfWidth(text)
    .replace(/_{3,}/gu, '')
    .replace(/[.…]{2,}/gu, (run) => (dotCount(run) >= 4 ? '' : run));
}

/**
 * Where a text's blank runs are, as code-point ranges `[start, end)`: the same runs `hasBlankRun`
 * finds — at least three `_`, or at least four leader dots. The paper twin's boxes (S12) need where
 * a blank glued to its label begins.
 */
export function blankRuns(text: string): { start: number; end: number }[] {
  const chars = [...halfWidth(text)];
  const runs: { start: number; end: number }[] = [];
  let i = 0;
  while (i < chars.length) {
    const c = chars[i]!;
    const underscore = c === '_';
    if (!underscore && c !== '.' && c !== '…') {
      i += 1;
      continue;
    }
    let j = i;
    while (
      j < chars.length &&
      (underscore ? chars[j] === '_' : chars[j] === '.' || chars[j] === '…')
    ) {
      j += 1;
    }
    const run = chars.slice(i, j).join('');
    if (underscore ? j - i >= 3 : j - i >= 2 && dotCount(run) >= 4) runs.push({ start: i, end: j });
    i = j;
  }
  return runs;
}

/** A word that is nothing but a blank to write in: `______`, `……`, `.........`. */
export function isBlankWord(text: string): boolean {
  return hasBlankRun(text) && /^[_.…:]+$/u.test(halfWidth(text));
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
