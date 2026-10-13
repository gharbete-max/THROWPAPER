/**
 * "Select, never reword" (ADR 0023 section 4, ADR 0012, spike S1 section 7).
 *
 * For contracts, consents, declarations and clinical forms the model writes no text. The text is
 * cut into numbered passages here, the model answers with numbers, and the screen shows the
 * original passages by their offsets in the original text. Nothing the model produced reaches the
 * screen; a paraphrase of a consent would be a different consent.
 */
export interface Passage {
  /** 1-based, as the model sees it. */
  number: number;
  /** Offsets into the original text (UTF-16 code units, like `String.slice`). */
  start: number;
  end: number;
}

/** The most passages a person is pointed to. */
export const MAX_SELECTED = 5;
/** How much of a passage the model is shown. The quote is always whole. */
export const SHOWN_CHARS = 400;

/** Paragraphs, then list items, as passages with their offsets. Blank space is not a passage. */
export function splitPassages(text: string): Passage[] {
  const passages: Passage[] = [];
  const separator = /\n\s*\n/g;
  let from = 0;
  const add = (start: number, stop: number) => {
    const raw = text.slice(start, stop);
    const lead = raw.length - raw.trimStart().length;
    const body = raw.trim();
    if (body === '') return;
    passages.push({
      number: passages.length + 1,
      start: start + lead,
      end: start + lead + body.length,
    });
  };
  for (const match of text.matchAll(separator)) {
    add(from, match.index);
    from = match.index + match[0].length;
  }
  add(from, text.length);
  return passages;
}

/**
 * Parses and validates the model's answer. Anything but `{"indices":[...]}` of whole numbers in
 * range is refused whole: a grammar makes that impossible, and this makes it certain anyway.
 */
export function parseSelection(raw: string, passageCount: number): number[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const indices = (parsed as { indices?: unknown } | null)?.indices;
  if (!Array.isArray(indices) || indices.length === 0 || indices.length > MAX_SELECTED) return null;
  if (!indices.every((i) => Number.isInteger(i) && i >= 1 && i <= passageCount)) return null;
  return [...new Set(indices as number[])].sort((a, b) => a - b);
}

/** The original text of the chosen passages, cut out by offset. */
export function quote(
  text: string,
  passages: readonly Passage[],
  numbers: readonly number[],
): string[] {
  return numbers.flatMap((n) => {
    const passage = passages[n - 1];
    return passage ? [text.slice(passage.start, passage.end)] : [];
  });
}
