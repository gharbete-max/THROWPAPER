/**
 * Cutting a long text into pieces that fit the model's 4,096-token window (spike S1, section 5).
 *
 * Pieces end on paragraph boundaries. A paragraph that is itself too long is cut at line ends,
 * then at sentence ends, then by characters, so no piece ever exceeds the budget. The model's own
 * tokeniser is passed in as `count`, so this file stays free of any model.
 */
export type TokenCounter = (text: string) => number;

/** Map pieces and the notes' budget (spike S1: 2,200 tokens of text next to the instructions). */
export const MAP_CHUNK_TOKENS = 2200;
/** Translation groups: the output is as long as the input, so the groups are small (<= 700). */
export const TRANSLATE_GROUP_TOKENS = 700;
/** A text that fits this goes through one call, no map and reduce. */
export const ONE_CALL_TOKENS = 2300;

const SENTENCE_END = /(?<=[.!?。！？…])\s*/u;

/** Splits `text` into pieces that each fit `budget` tokens, in order, losing nothing but blanks. */
export function chunkParagraphs(text: string, budget: number, count: TokenCounter): string[] {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p !== '');
  const pieces: string[] = [];
  for (const paragraph of paragraphs) pieces.push(...fit(paragraph, budget, count));

  const chunks: string[] = [];
  let current: string[] = [];
  let used = 0;
  for (const piece of pieces) {
    const size = count(piece) + 2;
    if (current.length > 0 && used + size > budget) {
      chunks.push(current.join('\n\n'));
      current = [];
      used = 0;
    }
    current.push(piece);
    used += size;
  }
  if (current.length > 0) chunks.push(current.join('\n\n'));
  return chunks;
}

/** One paragraph as one or more pieces that each fit. */
function fit(paragraph: string, budget: number, count: TokenCounter): string[] {
  if (count(paragraph) + 2 <= budget) return [paragraph];
  for (const split of [(p: string) => p.split(/\n/), (p: string) => p.split(SENTENCE_END)]) {
    const parts = split(paragraph)
      .map((p) => p.trim())
      .filter((p) => p !== '');
    if (parts.length > 1) return parts.flatMap((part) => fit(part, budget, count));
  }
  // One unbroken run: halve it until each half fits (a single character always does).
  if (paragraph.length <= 1) return [paragraph];
  const middle = Math.ceil(paragraph.length / 2);
  return [
    ...fit(paragraph.slice(0, middle), budget, count),
    ...fit(paragraph.slice(middle), budget, count),
  ];
}
