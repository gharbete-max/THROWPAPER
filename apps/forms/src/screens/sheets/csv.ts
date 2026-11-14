/**
 * Reading and writing CSV the way the countries that write it differ (`docs/plan/SPREADSHEETS.md`
 * §2, Convert). Pure: bytes and text in, bytes and text out, no DOM.
 *
 * The trouble this fixes: Excel takes a CSV's separator from the computer's regional settings, so a
 * file written with commas opens in one column on a Swedish, German or Spanish machine, and one
 * written with semicolons opens in one column on an English one; and its decimal mark follows the
 * same settings, so `1,5` is a number in one country and text in another. Here the file is read for
 * what it is, shown to the person, and written again the way their Excel wants it.
 */

export type Separator = ';' | ',' | '\t' | '|';
export const SEPARATORS: readonly Separator[] = [';', ',', '\t', '|'];

export type Encoding = 'utf-8' | 'windows-1252' | 'utf-16le' | 'shift_jis';
export const ENCODINGS: readonly Encoding[] = ['utf-8', 'windows-1252', 'utf-16le', 'shift_jis'];

/** What was found when the bytes were first read, so the screen can say it and let it be changed. */
export interface Decoded {
  text: string;
  encoding: Encoding;
  /** A byte-order mark was present and has been removed. */
  bom: boolean;
}

/** Strips a UTF-8 or UTF-16 mark if there is one. UTF-16 and BOM-less UTF-8 are told apart by it or by validity. */
export function decode(bytes: Uint8Array, force?: Encoding): Decoded {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return {
      text: new TextDecoder('utf-8').decode(bytes.subarray(3)),
      encoding: 'utf-8',
      bom: true,
    };
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return {
      text: new TextDecoder('utf-16le').decode(bytes.subarray(2)),
      encoding: 'utf-16le',
      bom: true,
    };
  }
  if (force) return { text: new TextDecoder(force).decode(bytes), encoding: force, bom: false };
  try {
    // Strict: a Windows-1252 file with å ä ö is not valid UTF-8, and says so.
    return {
      text: new TextDecoder('utf-8', { fatal: true }).decode(bytes),
      encoding: 'utf-8',
      bom: false,
    };
  } catch {
    return {
      text: new TextDecoder('windows-1252').decode(bytes),
      encoding: 'windows-1252',
      bom: false,
    };
  }
}

/** The separator that splits the first lines into the same number of fields most often. */
export function detectSeparator(text: string): Separator {
  const lines = splitLines(text, 25);
  let best: Separator = ',';
  let bestScore = 0;
  for (const sep of SEPARATORS) {
    const counts = lines.map((line) => countOutsideQuotes(line, sep)).filter((n) => n > 0);
    if (counts.length === 0) continue;
    // A separator that appears the same number of times on most lines is the real one.
    const mode = counts.sort((a, b) => a - b)[Math.floor(counts.length / 2)]!;
    const consistent = counts.filter((n) => n === mode).length;
    const score = consistent * 1000 + mode;
    if (score > bestScore) {
      bestScore = score;
      best = sep;
    }
  }
  return best;
}

function splitLines(text: string, limit: number): string[] {
  const lines: string[] = [];
  let line = '';
  let inQuotes = false;
  for (const c of text) {
    if (c === '"') inQuotes = !inQuotes;
    if ((c === '\n' || c === '\r') && !inQuotes) {
      if (line !== '') lines.push(line);
      line = '';
      if (lines.length >= limit) break;
    } else line += c;
  }
  if (line !== '' && lines.length < limit) lines.push(line);
  return lines;
}

function countOutsideQuotes(line: string, sep: string): number {
  let n = 0;
  let inQuotes = false;
  for (const c of line) {
    if (c === '"') inQuotes = !inQuotes;
    else if (!inQuotes && c === sep) n += 1;
  }
  return n;
}

/** RFC 4180: quoted fields, `""` for a quote, line breaks inside quotes; CRLF, LF or CR between rows. */
export function parse(text: string, separator: Separator): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"' && field === '') inQuotes = true;
    else if (c === separator) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Fields are quoted when they must be (separator, quote or line break inside) or when `all` is asked. */
export function serialize(
  rows: readonly (readonly string[])[],
  separator: Separator,
  quote: 'needed' | 'all' = 'needed',
): string {
  const field = (value: string) =>
    quote === 'all' || /["\r\n]/.test(value) || value.includes(separator)
      ? `"${value.replaceAll('"', '""')}"`
      : value;
  return rows.map((row) => row.map(field).join(separator)).join('\r\n') + '\r\n';
}

export type DecimalMark = ',' | '.';

/** A cell that is a number written with this mark: optional sign, digits, optional thousands marks, a decimal part. */
const NUMBER: Record<DecimalMark, RegExp> = {
  ',': /^[+-]?(\d{1,3}([ .\u00a0\u202f]\d{3})+|\d+),\d+$/,
  '.': /^[+-]?(\d{1,3}([ ,\u00a0\u202f]\d{3})+|\d+)\.\d+$/,
};

/** Which decimal mark the numbers in the file use, or null when there is no number with a decimal part, or both. */
export function detectDecimal(rows: readonly (readonly string[])[]): DecimalMark | null {
  let comma = 0;
  let dot = 0;
  for (const row of rows) {
    for (const cell of row) {
      const v = cell.trim();
      if (NUMBER[',']!.test(v)) comma += 1;
      else if (NUMBER['.']!.test(v)) dot += 1;
    }
  }
  if (comma > 0 && dot === 0) return ',';
  if (dot > 0 && comma === 0) return '.';
  if (comma > 0 && dot > 0) return comma >= dot * 3 ? ',' : dot >= comma * 3 ? '.' : null;
  return null;
}

/**
 * Rewrites the decimal mark of whole-cell numbers only, and drops thousands marks (a number with
 * a mark in the wrong place is the one Excel turns into text). Anything else, such as `1,5 kg`, an
 * id with leading zeros or a date, is left as it is.
 */
export function changeDecimal(
  rows: readonly (readonly string[])[],
  from: DecimalMark,
  to: DecimalMark,
): { rows: string[][]; changed: number } {
  let changed = 0;
  const out = rows.map((row) =>
    row.map((cell) => {
      const v = cell.trim();
      if (!NUMBER[from]!.test(v)) return cell;
      const digits = v.replace(/[ .,\u00a0\u202f]/g, (m) => (m === from ? '.' : ''));
      const [whole = '', frac = ''] = digits.split('.');
      // A leading zero is an identifier, not a number: 00,5 stays as written.
      if (/^[+-]?0\d/.test(whole)) return cell;
      changed += 1;
      return `${whole}${to}${frac}`;
    }),
  );
  return { rows: out, changed };
}

export type OutEncoding = 'utf-8-bom' | 'utf-8' | 'windows-1252';

const CP1252_HIGH = new Map<number, number>(
  Object.entries({
    0x20ac: 0x80,
    0x201a: 0x82,
    0x0192: 0x83,
    0x201e: 0x84,
    0x2026: 0x85,
    0x2020: 0x86,
    0x2021: 0x87,
    0x02c6: 0x88,
    0x2030: 0x89,
    0x0160: 0x8a,
    0x2039: 0x8b,
    0x0152: 0x8c,
    0x017d: 0x8e,
    0x2018: 0x91,
    0x2019: 0x92,
    0x201c: 0x93,
    0x201d: 0x94,
    0x2022: 0x95,
    0x2013: 0x96,
    0x2014: 0x97,
    0x02dc: 0x98,
    0x2122: 0x99,
    0x0161: 0x9a,
    0x203a: 0x9b,
    0x0153: 0x9c,
    0x017e: 0x9e,
    0x0178: 0x9f,
  }).map(([k, v]) => [Number(k), v]),
);

/** Text to bytes in the encoding Excel on the person's machine reads; characters Windows-1252 lacks become `?` and are counted. */
export function encode(text: string, to: OutEncoding): { bytes: Uint8Array; unencodable: number } {
  if (to === 'utf-8') return { bytes: new TextEncoder().encode(text), unencodable: 0 };
  if (to === 'utf-8-bom') {
    const body = new TextEncoder().encode(text);
    const bytes = new Uint8Array(body.length + 3);
    bytes.set([0xef, 0xbb, 0xbf]);
    bytes.set(body, 3);
    return { bytes, unencodable: 0 };
  }
  const bytes: number[] = [];
  let unencodable = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (code < 0x80 || (code >= 0xa0 && code <= 0xff)) bytes.push(code);
    else if (CP1252_HIGH.has(code)) bytes.push(CP1252_HIGH.get(code)!);
    else {
      bytes.push(0x3f);
      unencodable += 1;
    }
  }
  return { bytes: Uint8Array.from(bytes), unencodable };
}

/** Everything the screen shows about a file as first read, and what changing a choice re-reads. */
export function analyse(bytes: Uint8Array, force?: Encoding | null, separator?: Separator | null) {
  const decoded = decode(bytes, force ?? undefined);
  const sep = separator ?? detectSeparator(decoded.text);
  const rows = parse(decoded.text, sep);
  return { decoded, separator: sep, rows, decimal: detectDecimal(rows) };
}

export interface ConvertOptions {
  separator: Separator;
  /** The mark the numbers have now (from `detectDecimal`) and the one to write; `keep` leaves them. */
  from: DecimalMark | null;
  to: DecimalMark | 'keep';
  encoding: OutEncoding;
}

/** The file to save: numbers rewritten if asked, fields joined by the chosen separator, text encoded. */
export function convert(rows: readonly (readonly string[])[], options: ConvertOptions) {
  const changing = options.from !== null && options.to !== 'keep' && options.from !== options.to;
  const done = changing
    ? changeDecimal(rows, options.from!, options.to as DecimalMark)
    : { rows: rows.map((r) => [...r]), changed: 0 };
  const { bytes, unencodable } = encode(serialize(done.rows, options.separator), options.encoding);
  return { bytes, changed: done.changed, unencodable };
}
