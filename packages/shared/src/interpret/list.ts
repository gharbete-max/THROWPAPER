import { enumerate } from '../import/enumerate/enumerate.js';
import { MAX_PASTE, pasteDocument } from '../import/paste.js';

/**
 * T6's list (`docs/plan/INTENT-LADDER.md`, T6): two or more items, their labels verbatim.
 *
 * - **Several lines** — typed or pasted — are read the way the importer reads a pasted document:
 *   through the paste layout and the list-number detector (`@tp/shared/import`), so `1. Röd`,
 *   `a) Röd` and `• Red` lose their markers exactly as they would there. A line without a marker
 *   is an item as it stands. A nested list is not a set of options, and is not read as one.
 * - **One line** is cut at `;` when it has one, and otherwise at `,` (and `，`, `、`): a
 *   semicolon lets an item hold a comma, as "3,5 kr; 4,5 kr" needs.
 *
 * Whitespace inside an item is layout, not wording: runs of it are one space, as the paste layout
 * joins a line's words. Nothing else about an item changes — never its case, never its spelling.
 */

export interface ListReading {
  readonly labels: readonly string[];
  /** UTF-16 offsets into the input: from the first item to the last. */
  readonly span: readonly [number, number];
}

const LINE_BREAK = /\r\n|\r|\n/u;

function spanOf(input: string): [number, number] {
  const start = input.search(/\S/u);
  const end = input.length - (/\s*$/u.exec(input)?.[0].length ?? 0);
  return [Math.max(start, 0), end];
}

function linesOf(input: string): string[] | null {
  const doc = pasteDocument(input);
  const { items } = enumerate(doc).output;
  if (items.some((item) => item.level > 1 || item.detailLineIds.length > 0)) return null;
  const labelled = new Map<string, string | null>();
  for (const item of items) {
    if (item.verdict !== 'accept' && item.verdict !== 'accept-flagged') continue;
    item.lineIds.forEach((id, i) => labelled.set(id, i === 0 ? item.label : null));
  }
  const labels: string[] = [];
  for (const page of doc.pages) {
    for (const block of page.blocks) {
      for (const line of block.lines) {
        const label = labelled.has(line.id) ? labelled.get(line.id) : line.text;
        if (label !== null && label !== undefined && label !== '') labels.push(label);
      }
    }
  }
  return labels;
}

/** The input as a list, or null when it is not one. */
export function listOf(input: string): ListReading | null {
  if (input.length > MAX_PASTE) return null;
  const nonBlank = input.split(LINE_BREAK).filter((line) => line.trim() !== '');
  const labels =
    nonBlank.length >= 2
      ? linesOf(input)
      : input
          .split(/[;；]/u.test(input) ? /[;；]/u : /[,，、]/u)
          .map((item) => item.trim().replace(/\s+/gu, ' '))
          .filter((item) => item !== '');
  return labels && labels.length >= 2 ? { labels, span: spanOf(input) } : null;
}
