import { deflateRawSync } from 'node:zlib';

/**
 * Word documents written out by hand for the tests (`docx.test.ts`, `e2e/paper-import.spec.ts`),
 * so a test reads as the XML it feeds the reader and needs no Word and no binary fixture. Test
 * support only: nothing in the app imports it, and it uses Node's zlib.
 */

export interface ZipEntry {
  name: string;
  data: string | Uint8Array;
  /** Deflated (method 8) unless false: stored (method 0). */
  deflate?: boolean;
  /** Mark the entry encrypted (general-purpose flag bit 0). */
  encrypted?: boolean;
  /** Write this compression method instead. */
  method?: number;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A zip archive of the entries, as a zip tool writes one. */
export function zipBytes(entries: readonly ZipEntry[]): Uint8Array {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const raw = typeof entry.data === 'string' ? encoder.encode(entry.data) : entry.data;
    const deflate = entry.deflate !== false;
    const data = deflate ? new Uint8Array(deflateRawSync(raw)) : raw;
    const method = entry.method ?? (deflate ? 8 : 0);
    const name = encoder.encode(entry.name);
    const flags = entry.encrypted ? 1 : 0;
    const crc = crc32(raw);

    const local = new Uint8Array(30 + name.length + data.length);
    const l = new DataView(local.buffer);
    l.setUint32(0, 0x04034b50, true);
    l.setUint16(4, 20, true);
    l.setUint16(6, flags, true);
    l.setUint16(8, method, true);
    l.setUint32(14, crc, true);
    l.setUint32(18, data.length, true);
    l.setUint32(22, raw.length, true);
    l.setUint16(26, name.length, true);
    local.set(name, 30);
    local.set(data, 30 + name.length);

    const central = new Uint8Array(46 + name.length);
    const c = new DataView(central.buffer);
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 20, true);
    c.setUint16(6, 20, true);
    c.setUint16(8, flags, true);
    c.setUint16(10, method, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, data.length, true);
    c.setUint32(24, raw.length, true);
    c.setUint16(28, name.length, true);
    c.setUint32(42, offset, true);
    central.set(name, 46);

    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const directory = centrals.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, Math.min(entries.length, 0xffff), true);
  e.setUint16(10, Math.min(entries.length, 0xffff), true);
  e.setUint32(12, directory, true);
  e.setUint32(16, offset, true);
  const parts = [...locals, ...centrals, end];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

export const WORDML = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>`;
const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
const DOCUMENT_RELS = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>`;

/** `<w:document>` around a body's worth of XML. */
export function documentXml(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="${WORDML}"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>`;
}

/** A paragraph of one run; `pPr` and `rPr` are inner XML. */
export function paragraph(text: string, pPr = '', rPr = ''): string {
  const run =
    text === ''
      ? ''
      : `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}<w:t xml:space="preserve">${text}</w:t></w:r>`;
  return `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}${run}</w:p>`;
}

/** A numbered paragraph: `numId` and `ilvl` as Word writes them. */
export function numbered(text: string, numId: number, ilvl = 0): string {
  return paragraph(text, `<w:numPr><w:ilvl w:val="${ilvl}"/><w:numId w:val="${numId}"/></w:numPr>`);
}

export function stylesXml(inner: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<w:styles xmlns:w="${WORDML}">${inner}</w:styles>`;
}

export function numberingXml(inner: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<w:numbering xmlns:w="${WORDML}">${inner}</w:numbering>`;
}

/** An abstract list whose levels are `[numFmt, lvlText, more?]`, level 0 first. */
export function abstractList(
  id: number,
  levels: readonly (readonly [string, string, string?])[],
): string {
  const lvls = levels
    .map(
      ([format, text, more = ''], ilvl) =>
        `<w:lvl w:ilvl="${ilvl}"><w:start w:val="1"/><w:numFmt w:val="${format}"/><w:lvlText w:val="${text}"/><w:pPr><w:ind w:left="${720 * (ilvl + 1)}" w:hanging="360"/></w:pPr>${more}</w:lvl>`,
    )
    .join('');
  return `<w:abstractNum w:abstractNumId="${id}">${lvls}</w:abstractNum>`;
}

/** A list instance of an abstract list, with optional `<w:lvlOverride>` XML. */
export function list(numId: number, abstractId: number, overrides = ''): string {
  return `<w:num w:numId="${numId}"><w:abstractNumId w:val="${abstractId}"/>${overrides}</w:num>`;
}

/** A whole .docx: the document's body, and optionally its styles, numbering and more entries. */
export function docxBytes(parts: {
  body: string;
  styles?: string;
  numbering?: string;
  extra?: readonly ZipEntry[];
}): Uint8Array {
  return zipBytes([
    { name: '[Content_Types].xml', data: CONTENT_TYPES },
    { name: '_rels/.rels', data: ROOT_RELS },
    { name: 'word/_rels/document.xml.rels', data: DOCUMENT_RELS },
    { name: 'word/document.xml', data: documentXml(parts.body) },
    ...(parts.styles === undefined ? [] : [{ name: 'word/styles.xml', data: parts.styles }]),
    ...(parts.numbering === undefined
      ? []
      : [{ name: 'word/numbering.xml', data: parts.numbering }]),
    ...(parts.extra ?? []),
  ]);
}
