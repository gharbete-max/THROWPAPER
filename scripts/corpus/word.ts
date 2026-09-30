import { zipBytes } from '../../apps/forms/src/screens/builder/paper/docx.fixture.js';

/**
 * A small Word writer for the corpus's sources (`scripts/corpus/documents.ts`): paragraphs and
 * runs, Word's own list numbering, tables, sections with columns, page breaks, and a header and a
 * footer with page-number fields. Enough to describe a real form in a few readable lines, not a
 * general writer: LibreOffice reads what this writes and produces the corpus's PDF and DOCX, so
 * the files the tests read are LibreOffice's, never this writer's.
 */

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

export interface Run {
  text: string;
  bold?: boolean;
  /** In points. */
  size?: number;
}

export type Block =
  | {
      kind: 'p';
      runs: Run[];
      style?: 'Title' | 'Heading1' | 'Small';
      /** Word's own numbering: a list defined in the document's `lists`, and its level. */
      list?: { id: number; level: number };
      pageBreakBefore?: boolean;
      /** Left indent in twips. */
      indent?: number;
    }
  | { kind: 'table'; rows: string[][]; widths: number[]; header?: boolean }
  | { kind: 'columns'; count: number; blocks: Block[] };

/** A list definition: each level's `w:numFmt` and `w:lvlText`, level 0 first. */
export interface ListDefinition {
  id: number;
  levels: readonly (readonly [format: string, text: string])[];
}

export interface WordDocument {
  lists?: ListDefinition[];
  header?: string;
  /** `{PAGE}` and `{NUMPAGES}` become Word's fields. */
  footer?: string;
  blocks: Block[];
}

const escape = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function runXml({ text, bold, size }: Run): string {
  const props = `${bold ? '<w:b/>' : ''}${size ? `<w:sz w:val="${size * 2}"/>` : ''}`;
  const rPr = props ? `<w:rPr>${props}</w:rPr>` : '';
  // Tabs are Word's own tab characters, not spaces.
  return text
    .split('\t')
    .map((piece, i) =>
      [
        i > 0 ? `<w:r>${rPr}<w:tab/></w:r>` : '',
        piece ? `<w:r>${rPr}<w:t xml:space="preserve">${escape(piece)}</w:t></w:r>` : '',
      ].join(''),
    )
    .join('');
}

/** "Sida {PAGE} av {NUMPAGES}" as runs and simple fields. */
function fieldText(text: string): string {
  return text
    .split(/(\{PAGE\}|\{NUMPAGES\})/)
    .map((piece) =>
      piece === '{PAGE}' || piece === '{NUMPAGES}'
        ? `<w:fldSimple w:instr="${piece.slice(1, -1)}"><w:r><w:t>1</w:t></w:r></w:fldSimple>`
        : piece
          ? runXml({ text: piece })
          : '',
    )
    .join('');
}

const PAGE =
  '<w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/>';

function sectPr(columns: number, first: boolean, refs: string): string {
  return `<w:sectPr>${refs}<w:type w:val="${first ? 'nextPage' : 'continuous'}"/>${PAGE}<w:cols w:num="${columns}" w:space="567"/></w:sectPr>`;
}

function paragraphXml(block: Extract<Block, { kind: 'p' }>, sect = ''): string {
  const props = [
    block.style ? `<w:pStyle w:val="${block.style}"/>` : '',
    block.pageBreakBefore ? '<w:pageBreakBefore/>' : '',
    block.list
      ? `<w:numPr><w:ilvl w:val="${block.list.level}"/><w:numId w:val="${block.list.id}"/></w:numPr>`
      : '',
    block.indent ? `<w:ind w:left="${block.indent}"/>` : '',
    sect,
  ].join('');
  return `<w:p>${props ? `<w:pPr>${props}</w:pPr>` : ''}${block.runs.map(runXml).join('')}</w:p>`;
}

function tableXml(block: Extract<Block, { kind: 'table' }>): string {
  const border = (side: string) =>
    `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="000000"/>`;
  const borders = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(border).join('');
  const grid = block.widths.map((w) => `<w:gridCol w:w="${w}"/>`).join('');
  const rows = block.rows
    .map(
      (cells, r) =>
        `<w:tr>${cells
          .map(
            (text, c) =>
              `<w:tc><w:tcPr><w:tcW w:w="${block.widths[c] ?? 1000}" w:type="dxa"/></w:tcPr>${paragraphXml(
                {
                  kind: 'p',
                  runs: [{ text, bold: block.header === true && r === 0 }],
                },
              )}</w:tc>`,
          )
          .join('')}</w:tr>`,
    )
    .join('');
  return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders>${borders}</w:tblBorders></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${rows}</w:tbl>`;
}

/** The body: a section ends at every change of column count, as Word writes it. */
function bodyXml(blocks: Block[], refs: string): string {
  const out: string[] = [];
  let first = true;
  const close = (columns: number) => {
    // A section's properties ride on its last paragraph.
    out.push(`<w:p><w:pPr>${sectPr(columns, first, refs)}</w:pPr></w:p>`);
    first = false;
  };
  for (const block of blocks) {
    if (block.kind === 'p') out.push(paragraphXml(block));
    else if (block.kind === 'table') out.push(tableXml(block), '<w:p/>');
    else {
      close(1);
      for (const inner of block.blocks) {
        if (inner.kind === 'p') out.push(paragraphXml(inner));
        else if (inner.kind === 'table') out.push(tableXml(inner), '<w:p/>');
      }
      close(block.count);
    }
  }
  out.push(sectPr(1, first, refs));
  return out.join('');
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="${W}">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Liberation Sans" w:hAnsi="Liberation Sans" w:cs="Liberation Sans"/><w:sz w:val="22"/><w:lang w:val="sv-SE"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="80" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="240"/></w:pPr><w:rPr><w:b/><w:sz w:val="40"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Small"><w:name w:val="Small"/><w:basedOn w:val="Normal"/><w:rPr><w:sz w:val="16"/></w:rPr></w:style>
</w:styles>`;

function numberingXml(lists: readonly ListDefinition[]): string {
  const abstracts = lists
    .map(
      (list) =>
        `<w:abstractNum w:abstractNumId="${list.id}">${list.levels
          .map(
            ([format, text], level) =>
              `<w:lvl w:ilvl="${level}"><w:start w:val="1"/><w:numFmt w:val="${format}"/><w:lvlText w:val="${escape(text)}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${567 * (level + 1)}" w:hanging="425"/></w:pPr></w:lvl>`,
          )
          .join('')}</w:abstractNum>`,
    )
    .join('');
  const nums = lists
    .map((list) => `<w:num w:numId="${list.id}"><w:abstractNumId w:val="${list.id}"/></w:num>`)
    .join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:numbering xmlns:w="${W}">${abstracts}${nums}</w:numbering>`;
}

/** The whole document as .docx bytes, for LibreOffice to read. */
export function wordDocument(doc: WordDocument): Uint8Array {
  const rels: string[] = [
    `<Relationship Id="rStyles" Type="${R}/styles" Target="styles.xml"/>`,
    `<Relationship Id="rNumbering" Type="${R}/numbering" Target="numbering.xml"/>`,
  ];
  const parts: { name: string; data: string }[] = [];
  let refs = '';
  if (doc.header !== undefined) {
    rels.push(`<Relationship Id="rHeader" Type="${R}/header" Target="header1.xml"/>`);
    refs += '<w:headerReference w:type="default" r:id="rHeader"/>';
    parts.push({
      name: 'word/header1.xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:hdr xmlns:w="${W}" xmlns:r="${R}"><w:p>${fieldText(doc.header)}</w:p></w:hdr>`,
    });
  }
  if (doc.footer !== undefined) {
    rels.push(`<Relationship Id="rFooter" Type="${R}/footer" Target="footer1.xml"/>`);
    refs += '<w:footerReference w:type="default" r:id="rFooter"/>';
    parts.push({
      name: 'word/footer1.xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:ftr xmlns:w="${W}" xmlns:r="${R}"><w:p>${fieldText(doc.footer)}</w:p></w:ftr>`,
    });
  }
  const types = [
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>',
    '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>',
    ...(doc.header === undefined
      ? []
      : [
          '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>',
        ]),
    ...(doc.footer === undefined
      ? []
      : [
          '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>',
        ]),
  ].join('');
  return zipBytes([
    {
      name: '[Content_Types].xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">${types}</Types>`,
    },
    {
      name: '_rels/.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rDoc" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`,
    },
    {
      name: 'word/_rels/document.xml.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join('')}</Relationships>`,
    },
    {
      name: 'word/document.xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${bodyXml(doc.blocks, refs)}</w:body></w:document>`,
    },
    { name: 'word/styles.xml', data: STYLES },
    { name: 'word/numbering.xml', data: numberingXml(doc.lists ?? []) },
    ...parts,
  ]);
}

// ------------------------------------------------------------------ the spec's vocabulary
export const title = (text: string): Block => ({ kind: 'p', style: 'Title', runs: [{ text }] });
export const heading = (text: string): Block => ({
  kind: 'p',
  style: 'Heading1',
  runs: [{ text }],
});
export const para = (text: string, more: Partial<Extract<Block, { kind: 'p' }>> = {}): Block => ({
  kind: 'p',
  runs: [{ text }],
  ...more,
});
export const small = (text: string): Block => ({ kind: 'p', style: 'Small', runs: [{ text }] });
export const item = (list: number, text: string, level = 0): Block => ({
  kind: 'p',
  runs: [{ text }],
  list: { id: list, level },
});
export const table = (rows: string[][], widths: number[], header = true): Block => ({
  kind: 'table',
  rows,
  widths,
  header,
});
export const columns = (count: number, blocks: Block[]): Block => ({
  kind: 'columns',
  count,
  blocks,
});
