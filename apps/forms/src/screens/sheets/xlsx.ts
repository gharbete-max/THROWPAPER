/**
 * Excel workbooks (`.xlsx`) read and written in the window, with no library: a workbook is a zip of
 * XML parts (`docs/plan/SPREADSHEETS.md` §4). Pure apart from the browser's own
 * `DecompressionStream`, which Node has too.
 *
 * **Reading is for values, not for fidelity.** A sheet comes back as rows of text: numbers as Excel
 * stores them, dates as `yyyy-mm-dd` (found by the cell's number format), formulas as their last
 * result, rich text as plain text. Charts, pivots, styles and macros are not read and never written.
 * **Writing** makes a new workbook of one sheet: numbers as numbers, everything else as text, so
 * `00123` and a twenty-digit id stay what they were.
 */
export type XlsxFailure = 'not-xlsx' | 'encrypted' | 'unsupported' | 'corrupt' | 'too-large';

export class XlsxError extends Error {
  constructor(readonly code: XlsxFailure) {
    super(code);
  }
}

const MAX_ENTRIES = 500;
const MAX_PART_BYTES = 64 * 1024 * 1024;
const MAX_ROWS = 1_048_576;
const MAX_COLUMNS = 16_384;

// ---- zip, reading -----------------------------------------------------------------------------

interface ZipEntry {
  name: string;
  method: number;
  compressed: number;
  size: number;
  offset: number;
}

const u16 = (b: Uint8Array, o: number) => b[o]! | (b[o + 1]! << 8);
const u32 = (b: Uint8Array, o: number) => (u16(b, o) | (u16(b, o + 2) << 16)) >>> 0;

function listEntries(bytes: Uint8Array): Map<string, ZipEntry> {
  if (bytes.length < 22 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new XlsxError('not-xlsx');
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i -= 1) {
    if (u32(bytes, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new XlsxError('corrupt');
  const count = u16(bytes, eocd + 10);
  const start = u32(bytes, eocd + 16);
  if (count === 0xffff || start === 0xffffffff) throw new XlsxError('unsupported');
  if (count > MAX_ENTRIES) throw new XlsxError('too-large');
  const entries = new Map<string, ZipEntry>();
  let p = start;
  for (let i = 0; i < count; i += 1) {
    if (p + 46 > bytes.length || u32(bytes, p) !== 0x02014b50) throw new XlsxError('corrupt');
    const flags = u16(bytes, p + 8);
    if (flags & 1) throw new XlsxError('encrypted');
    const compressed = u32(bytes, p + 20);
    const size = u32(bytes, p + 24);
    const nameLength = u16(bytes, p + 28);
    const offset = u32(bytes, p + 42);
    if (compressed === 0xffffffff || size === 0xffffffff) throw new XlsxError('unsupported');
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLength));
    if (!name.endsWith('/')) {
      entries.set(name, { name, method: u16(bytes, p + 10), compressed, size, offset });
    }
    p += 46 + nameLength + u16(bytes, p + 30) + u16(bytes, p + 32);
  }
  return entries;
}

async function inflateRaw(data: Uint8Array, expected: number): Promise<Uint8Array> {
  const reader = new Blob([data as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'))
    .getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    // Counted as it arrives, so a part that lies about its size cannot fill the memory.
    if (total > expected) {
      void reader.cancel();
      throw new XlsxError('corrupt');
    }
    chunks.push(value);
  }
  if (total !== expected) throw new XlsxError('corrupt');
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

async function part(bytes: Uint8Array, entries: Map<string, ZipEntry>, name: string) {
  const entry = entries.get(name);
  if (!entry) return null;
  if (entry.size > MAX_PART_BYTES) throw new XlsxError('too-large');
  if (entry.offset + 30 > bytes.length || u32(bytes, entry.offset) !== 0x04034b50) {
    throw new XlsxError('corrupt');
  }
  const start = entry.offset + 30 + u16(bytes, entry.offset + 26) + u16(bytes, entry.offset + 28);
  if (start + entry.compressed > bytes.length) throw new XlsxError('corrupt');
  const data = bytes.subarray(start, start + entry.compressed);
  try {
    if (entry.method === 0) {
      if (data.length !== entry.size) throw new XlsxError('corrupt');
      return new TextDecoder().decode(data);
    }
    if (entry.method === 8) return new TextDecoder().decode(await inflateRaw(data, entry.size));
  } catch (error) {
    throw error instanceof XlsxError ? error : new XlsxError('corrupt');
  }
  throw new XlsxError('unsupported');
}

// ---- xml, just enough -------------------------------------------------------------------------

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function unescapeXml(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|\w+);/g, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[body] ?? whole;
  });
}

function attributes(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    out[m[1]!] = unescapeXml(m[2] ?? m[3] ?? '');
  }
  return out;
}

/** All the text of a rich-text or plain item: every `<t>`, none of the phonetic guides. */
function textOf(xml: string): string {
  return [...xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
    .map((m) => unescapeXml(m[1]!))
    .join('');
}

// ---- workbook ---------------------------------------------------------------------------------

export interface SheetInfo {
  name: string;
  path: string;
}

export interface Workbook {
  sheets: SheetInfo[];
  date1904: boolean;
  read(index: number): Promise<string[][]>;
}

/** Number formats that mean a date or a time: Excel's built-in ids, or a custom code with date letters. */
function isDateFormat(id: number, code: string | undefined): boolean {
  if (code === undefined) {
    return (
      (id >= 14 && id <= 22) ||
      (id >= 27 && id <= 36) ||
      (id >= 45 && id <= 47) ||
      (id >= 50 && id <= 58)
    );
  }
  const bare = code
    .replace(/"[^"]*"/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\\./g, '');
  return /[ymdhs]/i.test(bare) && !/e[+-]/i.test(bare) && !/general/i.test(bare);
}

/** An Excel serial date as `yyyy-mm-dd` (with `hh:mm:ss` when it has a time). */
export function serialToText(serial: number, date1904: boolean): string {
  let days = Math.floor(serial);
  let seconds = Math.round((serial - days) * 86400);
  if (seconds >= 86400) {
    days += 1;
    seconds -= 86400;
  }
  const pad = (n: number) => String(n).padStart(2, '0');
  const time = `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor((seconds % 3600) / 60))}:${pad(seconds % 60)}`;
  if (days === 0 && !date1904) return time;
  // 1900 counts a 29 February that did not exist; serial 60 is that day.
  if (!date1904 && days === 60) return `1900-02-29${seconds ? ` ${time}` : ''}`;
  const base = date1904
    ? Date.UTC(1904, 0, 1)
    : days < 60
      ? Date.UTC(1899, 11, 31)
      : Date.UTC(1899, 11, 30);
  const d = new Date(base + days * 86400000);
  const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  return seconds ? `${date} ${time}` : date;
}

function columnIndex(letters: string): number {
  let n = 0;
  for (const c of letters.toUpperCase()) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
}

export async function openWorkbook(bytes: Uint8Array): Promise<Workbook> {
  const entries = listEntries(bytes);
  const workbookXml = await part(bytes, entries, 'xl/workbook.xml');
  if (workbookXml === null) throw new XlsxError('not-xlsx');
  const relsXml = (await part(bytes, entries, 'xl/_rels/workbook.xml.rels')) ?? '';
  const targets = new Map<string, string>();
  for (const m of relsXml.matchAll(/<Relationship\b[^>]*>/g)) {
    const a = attributes(m[0]);
    if (a['Id'] && a['Target'] && /\/worksheet$/.test(a['Type'] ?? '')) {
      const target = a['Target'];
      targets.set(
        a['Id'],
        target.startsWith('/') ? target.slice(1) : `xl/${target}`.replace(/xl\/\.\.\//, ''),
      );
    }
  }
  const sheets: SheetInfo[] = [];
  for (const m of workbookXml.matchAll(/<sheet\b[^>]*>/g)) {
    const a = attributes(m[0]);
    const path = targets.get(a['r:id'] ?? a['id'] ?? '');
    if (a['name'] && path) sheets.push({ name: a['name'], path });
  }
  if (sheets.length === 0) throw new XlsxError('not-xlsx');
  const date1904 = /<workbookPr\b[^>]*date1904="(1|true)"/.test(workbookXml);

  let shared: string[] | null = null;
  let dateStyles: boolean[] | null = null;

  async function sharedStrings(): Promise<string[]> {
    if (shared) return shared;
    const xml = await part(bytes, entries, 'xl/sharedStrings.xml');
    shared =
      xml === null
        ? []
        : [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g)].map((m) =>
            textOf(m[1] ?? ''),
          );
    return shared;
  }

  async function styles(): Promise<boolean[]> {
    if (dateStyles) return dateStyles;
    const xml = await part(bytes, entries, 'xl/styles.xml');
    dateStyles = [];
    if (xml !== null) {
      const codes = new Map<number, string>();
      for (const m of xml.matchAll(/<numFmt\b[^>]*>/g)) {
        const a = attributes(m[0]);
        if (a['numFmtId'] && a['formatCode'] !== undefined)
          codes.set(Number(a['numFmtId']), a['formatCode']);
      }
      const block = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml)?.[1] ?? '';
      for (const m of block.matchAll(/<xf\b[^>]*>/g)) {
        const id = Number(attributes(m[0])['numFmtId'] ?? 0);
        dateStyles.push(isDateFormat(id, codes.get(id)));
      }
    }
    return dateStyles;
  }

  return {
    sheets,
    date1904,
    async read(index) {
      const sheet = sheets[index];
      if (!sheet) throw new XlsxError('corrupt');
      const xml = await part(bytes, entries, sheet.path);
      if (xml === null) throw new XlsxError('corrupt');
      const strings = await sharedStrings();
      const dates = await styles();
      const rows: string[][] = [];
      let row = -1;
      let col = -1;
      let width = 0;
      for (const m of xml.matchAll(/<row\b([^>]*)>|<c\b([^>]*?)(\/>|>([\s\S]*?)<\/c>)/g)) {
        if (m[1] !== undefined) {
          const r = attributes(`<x ${m[1]}>`)['r'];
          row = r ? Number(r) - 1 : row + 1;
          col = -1;
          if (row >= MAX_ROWS) throw new XlsxError('too-large');
          continue;
        }
        const a = attributes(`<c ${m[2]}>`);
        const ref = /^([A-Za-z]+)(\d+)$/.exec(a['r'] ?? '');
        if (ref) {
          col = columnIndex(ref[1]!);
          row = Number(ref[2]) - 1;
        } else col += 1;
        if (row < 0) row = 0;
        if (col >= MAX_COLUMNS || row >= MAX_ROWS) throw new XlsxError('too-large');
        const body = m[4] ?? '';
        let text = '';
        const v = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body)?.[1];
        switch (a['t']) {
          case 's':
            text = strings[Number(unescapeXml(v ?? ''))] ?? '';
            break;
          case 'inlineStr':
            text = textOf(body);
            break;
          case 'b':
            text = v === '1' ? 'TRUE' : 'FALSE';
            break;
          case 'str':
          case 'e':
          case 'd':
            text = unescapeXml(v ?? '');
            break;
          default: {
            text = unescapeXml(v ?? '');
            const n = Number(text);
            if (text !== '' && Number.isFinite(n) && dates[Number(a['s'] ?? 0)])
              text = serialToText(n, date1904);
          }
        }
        if (text === '') continue;
        while (rows.length <= row) rows.push([]);
        const cells = rows[row]!;
        while (cells.length <= col) cells.push('');
        cells[col] = text;
        width = Math.max(width, col + 1);
      }
      while (rows.length > 0 && rows[rows.length - 1]!.every((c) => c === '' || c === undefined))
        rows.pop();
      return rows.map((cells) => {
        const full = [...cells];
        while (full.length < width) full.push('');
        return full.map((c) => c ?? '');
      });
    },
  };
}

// ---- writing ----------------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of data) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A zip with every part stored, not compressed: larger, but valid everywhere and the same bytes every time. */
function zipStore(parts: readonly { name: string; text: string }[]): Uint8Array {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const header = (size: number) => {
    const view = new DataView(new ArrayBuffer(size));
    return view;
  };
  for (const { name, text } of parts) {
    const nameBytes = encoder.encode(name);
    const data = encoder.encode(text);
    const crc = crc32(data);
    const local = header(30);
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true);
    local.setUint16(10, 0, true);
    local.setUint16(12, 0x0021, true); // 1980-01-01, so the output does not depend on the clock
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, nameBytes.length, true);
    chunks.push(new Uint8Array(local.buffer), nameBytes, data);
    const entry = header(46);
    entry.setUint32(0, 0x02014b50, true);
    entry.setUint16(4, 20, true);
    entry.setUint16(6, 20, true);
    entry.setUint16(8, 0x0800, true);
    entry.setUint16(14, 0x0021, true);
    entry.setUint32(16, crc, true);
    entry.setUint32(20, data.length, true);
    entry.setUint32(24, data.length, true);
    entry.setUint16(28, nameBytes.length, true);
    entry.setUint32(42, offset, true);
    central.push(new Uint8Array(entry.buffer), nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const centralSize = central.reduce((n, c) => n + c.length, 0);
  const end = header(22);
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, parts.length, true);
  end.setUint16(10, parts.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  const all = [...chunks, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const chunk of all) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

const escapeXml = (text: string) =>
  text
    // eslint-disable-next-line no-control-regex -- characters XML 1.0 cannot hold
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

function columnLetters(index: number): string {
  let n = index + 1;
  let out = '';
  while (n > 0) {
    out = String.fromCharCode(65 + ((n - 1) % 26)) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/** A number Excel would keep as one: no leading zero, no more than 15 digits. */
const PLAIN_NUMBER = /^-?(0|[1-9]\d*)(\.\d+)?$/;
function isNumber(text: string): boolean {
  return PLAIN_NUMBER.test(text) && text.replace(/[-.]/g, '').length <= 15;
}

/** A one-sheet workbook: numbers as numbers, everything else as text (`00123` and long ids stay text). */
export function writeXlsx(rows: readonly (readonly string[])[], sheetName = 'Sheet1'): Uint8Array {
  if (rows.length > MAX_ROWS || rows.some((r) => r.length > MAX_COLUMNS))
    throw new XlsxError('too-large');
  const name = escapeXml(sheetName.replace(/[[\]:*?/\\]/g, '_').slice(0, 31) || 'Sheet1');
  const sheetRows = rows
    .map((cells, r) => {
      const cs = cells
        .map((text, c) => {
          if (text === '') return '';
          const ref = `${columnLetters(c)}${r + 1}`;
          if (isNumber(text)) return `<c r="${ref}"><v>${text}</v></c>`;
          const space = /^\s|\s$|\n/.test(text) ? ' xml:space="preserve"' : '';
          return `<c r="${ref}" t="inlineStr"><is><t${space}>${escapeXml(text)}</t></is></c>`;
        })
        .join('');
      return `<row r="${r + 1}">${cs}</row>`;
    })
    .join('');
  const xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  return zipStore([
    {
      name: '[Content_Types].xml',
      text: `${xml}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
    },
    {
      name: '_rels/.rels',
      text: `${xml}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    },
    {
      name: 'xl/workbook.xml',
      text: `${xml}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${name}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      text: `${xml}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    },
    {
      name: 'xl/worksheets/sheet1.xml',
      text: `${xml}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`,
    },
  ]);
}
