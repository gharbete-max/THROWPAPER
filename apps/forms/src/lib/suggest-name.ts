/**
 * A file name for a kept PDF, by rules and never by a model: the first heading-like line of the
 * page's own text, and a date found on it; otherwise "Scan YYYY-MM-DD". Names keep every script
 * (Cyrillic, Chinese, Japanese stay as written) and lose only what a filesystem refuses.
 */
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const MAX_CHARS = 80;

/** Fit to be a file name stem on Windows, macOS and Linux, in any script. */
export function safeName(text: string): string {
  let out = [...text.normalize('NFC')]
    .map((c) => (c.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(c) ? ' ' : c))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  out = [...out]
    .slice(0, MAX_CHARS)
    .join('')
    .replace(/[. ]+$/, '')
    .trim();
  if (out.startsWith('.')) out = out.replace(/^\.+/, '').trim();
  return RESERVED.test(out) ? `_${out}` : out;
}

const pad = (n: number) => String(n).padStart(2, '0');
const valid = (y: number, m: number, d: number) =>
  y >= 1990 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31;

/** The first date on the text as YYYY-MM-DD. Numeric forms only; day first when it is not ISO. */
export function findDate(text: string): string | null {
  const forms: Array<[RegExp, (m: RegExpExecArray) => [number, number, number]]> = [
    [/(?<!\d)(\d{4})-(\d{1,2})-(\d{1,2})(?!\d)/, (m) => [+m[1]!, +m[2]!, +m[3]!]],
    [/(?<!\d)(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日/, (m) => [+m[1]!, +m[2]!, +m[3]!]],
    [/(?<!\d)(\d{1,2})[./](\d{1,2})[./](\d{4})(?!\d)/, (m) => [+m[3]!, +m[2]!, +m[1]!]],
  ];
  let best: { at: number; date: string } | null = null;
  for (const [pattern, parts] of forms) {
    const match = pattern.exec(text);
    if (!match) continue;
    const [y, m, d] = parts(match);
    if (valid(y, m, d) && (!best || match.index < best.at)) {
      best = { at: match.index, date: `${y}-${pad(m)}-${pad(d)}` };
    }
  }
  return best?.date ?? null;
}

/** A line that reads as a title: has letters, is not only a date, number, address or link. */
function isTitle(line: string): boolean {
  if (![...line].some((c) => /\p{L}/u.test(c))) return false;
  if (/@|https?:\/\/|www\./i.test(line)) return false;
  const length = [...line].length;
  if (length < 3 || length > 70) return false;
  if (findDate(line) === null) return true;
  // A line that is a label for a date ("Datum: 2.3.2026") is not a title; "Möte 2026-03-02" is.
  const rest = line.replace(/[\d\-./年月日\s]+/g, ' ').trim();
  return !/[:：]$/.test(rest) && [...rest].filter((c) => /\p{L}/u.test(c)).length >= 3;
}

export function suggestName(text: string, scanWord: string, today = new Date()): string {
  const iso = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 12);
  const title = safeName(lines.find(isTitle)?.replace(/[#*_]+/g, '') ?? '');
  const date = findDate(text);
  if (title === '') return safeName(`${scanWord} ${date ?? iso}`);
  const lead = title.includes(date ?? '\0') ? '' : date ? ` ${date}` : '';
  return safeName(`${title}${lead}`);
}

/**
 * The top of a page as lines of text, from the runs the PDF reader gives (page fractions). Kept
 * here, small, because the summary centre's own reader may not be imported from outside it.
 */
export function topLines(runs: ReadonlyArray<{ x: number; y: number; h: number; text: string }>) {
  const sorted = [...runs].sort((a, b) => a.y - b.y || a.x - b.x);
  const lines: Array<{ y: number; h: number; parts: string[] }> = [];
  for (const run of sorted) {
    const line = lines.at(-1);
    if (line && Math.abs(run.y - line.y) <= Math.max(line.h, run.h) * 0.5) {
      line.parts.push(run.text);
    } else {
      lines.push({ y: run.y, h: run.h, parts: [run.text] });
    }
  }
  return lines
    .map((line) => line.parts.join(' ').trim())
    .filter(Boolean)
    .join('\n');
}

export const withPdf = (name: string) => `${safeName(name.replace(/\.pdf$/i, '')) || 'Scan'}.pdf`;
