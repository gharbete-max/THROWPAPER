/**
 * Inline formatting for a text block: bold, italic, underline.
 *
 * ## Why a markup string and not HTML
 *
 * The obvious implementation is to store HTML and render it with `dangerouslySetInnerHTML`. That
 * hands every form author the ability to run script on a public page, and sanitising HTML properly
 * is a library and a permanent obligation to keep up with it.
 *
 * So the content stays a plain string with three markers, and this turns it into a list of spans
 * the renderer maps to `<strong>`, `<em>` and `<u>`. Nothing here can produce an element that was
 * not asked for, because the parser only ever emits those three flags — an author who types
 * `<script>` gets the literal text `<script>`, which is what they asked for.
 *
 *   `*bold*`  `/italic/`  `_underline_`
 *
 * Chosen over Markdown's `**` and `_` because a single character is what people already type in
 * chat, and because `_` for italic would collide with the underline marker.
 */

export interface RichSpan {
  text: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
}

export const RICH_MARKERS = { bold: '*', italic: '/', underline: '_' } as const;

const MARKER_FLAGS: Record<string, keyof Omit<RichSpan, 'text'>> = {
  '*': 'bold',
  '/': 'italic',
  _: 'underline',
};

/**
 * Splits a line into styled spans.
 *
 * An unclosed marker is *not* an error and does not start formatting — a lone asterisk in
 * "2 * 3" is far more likely to be arithmetic than an author who forgot to close a bold. The
 * marker only takes effect once its partner is found.
 */
export function parseRichText(line: string): RichSpan[] {
  const spans: RichSpan[] = [];
  const active = { bold: false, italic: false, underline: false };
  let buffer = '';

  const flush = () => {
    if (buffer === '') return;
    spans.push({ text: buffer, ...active });
    buffer = '';
  };

  for (let at = 0; at < line.length; at += 1) {
    const character = line[at]!;
    const flag = MARKER_FLAGS[character];

    if (!flag) {
      buffer += character;
      continue;
    }

    if (active[flag]) {
      // Closing marker.
      flush();
      active[flag] = false;
      continue;
    }

    // Opening only if the same marker appears again later; otherwise it is ordinary text.
    if (line.indexOf(character, at + 1) === -1) {
      buffer += character;
      continue;
    }

    flush();
    active[flag] = true;
  }

  flush();
  return spans;
}

/** Every line of a block, each already split into spans. Blank lines are preserved as gaps. */
export function parseRichTextBlock(content: string): RichSpan[][] {
  return content.split('\n').map((line) => parseRichText(line));
}

/** Wraps a selection in a marker, or removes it when it is already wrapped. Drives the toolbar. */
export function toggleMarker(
  value: string,
  start: number,
  end: number,
  marker: '*' | '/' | '_',
): { value: string; start: number; end: number } {
  const selected = value.slice(start, end);
  if (selected === '') return { value, start, end };

  const alreadyWrapped =
    value.slice(Math.max(0, start - 1), start) === marker && value.slice(end, end + 1) === marker;

  if (alreadyWrapped) {
    return {
      value: value.slice(0, start - 1) + selected + value.slice(end + 1),
      start: start - 1,
      end: end - 1,
    };
  }

  return {
    value: `${value.slice(0, start)}${marker}${selected}${marker}${value.slice(end)}`,
    start: start + 1,
    end: end + 1,
  };
}
