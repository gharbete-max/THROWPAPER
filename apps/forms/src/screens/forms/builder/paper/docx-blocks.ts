import { WORD_PDF_LIMITS } from '@tp/shared/api';
import type { WordBlock, WordRun } from '@tp/shared/api';
import { DocxRefused } from './refusal.js';
import {
  Counters,
  MAX_DOCX_BYTES,
  paragraphOf,
  part,
  readNumbering,
  readStyles,
  targetOf,
  type Paragraph,
} from './docx.js';
import { at, child, childrenNamed, type XmlElement } from './xml.js';
import { openZip, type Zip } from './zip.js';

/**
 * A Word document as the blocks the rough Word-to-PDF route takes (`@tp/shared/api`'s
 * `word-pdf.ts`, Phase 1c). It reuses `docx.ts` for everything Word-specific — styles, Word's own
 * list numbering, the text of runs, bold and italic, page breaks — and adds what the importer's
 * line-per-paragraph view throws away: tables as tables, and pictures.
 *
 * What it does not carry over is counted, never silently lost: `dropped` names each kind and how
 * many there were, for the screen to say. Pure and deterministic: the same bytes, the same blocks.
 */

export type DroppedKind =
  'headerFooter' | 'textBox' | 'footnote' | 'trackedChange' | 'field' | 'image';
export interface Dropped {
  kind: DroppedKind;
  count: number;
}
export interface WordBlocks {
  blocks: WordBlock[];
  dropped: Dropped[];
}

type Mime = 'image/png' | 'image/jpeg' | 'image/gif';
const EMU_PER_POINT = 12_700;

/** The picture formats Chromium draws that this carries. Sniffed from the bytes, not the name. */
function mimeOf(bytes: Uint8Array): Mime | null {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'image/png';
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
    return 'image/gif';
  }
  return null;
}

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** Depth-first, in document order. `visit` returns false to leave a subtree unvisited. */
function walk(node: XmlElement, visit: (element: XmlElement) => boolean | void): void {
  if (visit(node) === false) return;
  for (const next of node.children) if (typeof next !== 'string') walk(next, visit);
}

const textOf = (element: XmlElement): string =>
  element.children.map((node) => (typeof node === 'string' ? node : textOf(node))).join('');

/** Adjacent pieces that look alike are one run; a tab is four spaces. */
function runsOf(paragraph: Paragraph): WordRun[] {
  const runs: WordRun[] = [];
  for (const piece of paragraph.pieces) {
    const text = piece.text.replace(/\t/g, '    ');
    const bold = piece.look.bold === true;
    const italic = piece.look.italic === true;
    const last = runs.at(-1);
    if (last && !!last.bold === bold && !!last.italic === italic) last.text += text;
    else runs.push({ text, ...(bold ? { bold } : {}), ...(italic ? { italic } : {}) });
  }
  return runs;
}

const hasText = (runs: readonly WordRun[]) => runs.some((run) => run.text.trim() !== '');

/** "Heading1"… "Heading6", and "Title", are headings; Word keeps those ids in every language. */
function headingLevel(styleId: string | undefined): number | null {
  if (!styleId) return null;
  const match = /^heading\s*([1-6])$/i.exec(styleId);
  if (match) return Number(match[1]);
  return /^title$/i.test(styleId) ? 1 : null;
}

const NONE: XmlElement = { name: '', attrs: {}, children: [] };

/** Reads a Word document into blocks. Throws `DocxRefused`. */
export async function readWordBlocks(file: ArrayBuffer | Uint8Array): Promise<WordBlocks> {
  const bytes = file instanceof Uint8Array ? file : new Uint8Array(file);
  if (bytes.length > MAX_DOCX_BYTES) throw new DocxRefused('too-large', 'file size');
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf) throw new DocxRefused('protected', 'a compound file');
  const zip = openZip(bytes);

  const rootRels = await part(zip, '_rels/.rels');
  const main =
    targetOf(
      childrenNamed(rootRels ?? NONE, 'Relationship').find((r) =>
        (r.attrs['Type'] ?? '').endsWith('/officeDocument'),
      ),
      '',
    ) ?? 'word/document.xml';
  const slash = main.lastIndexOf('/');
  const dir = slash < 0 ? '' : main.slice(0, slash + 1);
  const rels = await part(zip, `${dir}_rels/${main.slice(slash + 1)}.rels`);
  const relationships = new Map<string, XmlElement>();
  for (const r of childrenNamed(rels ?? NONE, 'Relationship')) {
    if (r.attrs['Id']) relationships.set(r.attrs['Id'], r);
  }
  const typed = (type: string) =>
    targetOf(
      [...relationships.values()].find((r) => (r.attrs['Type'] ?? '').endsWith(`/${type}`)),
      dir,
    );

  const document = await part(zip, main);
  const body = at(document, 'w:body');
  if (!document || document.name !== 'w:document' || !body) {
    throw new DocxRefused('unreadable', 'no WordprocessingML document');
  }
  const styles = readStyles(await part(zip, typed('styles') ?? `${dir}styles.xml`));
  const numbering = readNumbering(await part(zip, typed('numbering') ?? `${dir}numbering.xml`));
  const counters = new Counters(numbering, styles);

  const dropped = await droppedParts(zip, body, relationships, dir);

  // ---- pictures: sniffed, capped one by one and in all; what does not fit is counted
  let imageBytes = 0;
  let skipped = 0;
  const loaded = new Map<string, { mime: Mime; data: string } | null>();
  async function imagesOf(paragraph: XmlElement): Promise<WordBlock[]> {
    const found: { id: string; widthPt?: number }[] = [];
    walk(paragraph, (element) => {
      // Text boxes are dropped whole, and the Fallback of an AlternateContent repeats its Choice.
      if (element.name === 'w:txbxContent' || element.name === 'mc:Fallback') return false;
      if (element.name === 'wp:inline' || element.name === 'wp:anchor') {
        let id: string | undefined;
        walk(element, (inner) => {
          if (inner.name === 'a:blip') id ??= inner.attrs['r:embed'];
        });
        const cx = Number(child(element, 'wp:extent')?.attrs['cx']);
        if (id) {
          found.push({
            id,
            ...(Number.isFinite(cx) && cx > 0 ? { widthPt: cx / EMU_PER_POINT } : {}),
          });
        }
        return false;
      }
      return;
    });
    const out: WordBlock[] = [];
    for (const { id, widthPt } of found) {
      const path = targetOf(relationships.get(id), dir);
      if (!path) {
        skipped += 1;
        continue;
      }
      if (!loaded.has(path)) {
        const raw = await zip.read(path);
        const mime = raw ? mimeOf(raw) : null;
        if (
          raw &&
          mime &&
          raw.length <= WORD_PDF_LIMITS.imageBytes &&
          imageBytes + raw.length <= WORD_PDF_LIMITS.imagesBytes
        ) {
          imageBytes += raw.length;
          loaded.set(path, { mime, data: base64(raw) });
        } else loaded.set(path, null);
      }
      const picture = loaded.get(path);
      if (!picture) {
        skipped += 1;
        continue;
      }
      out.push({
        kind: 'image',
        mime: picture.mime,
        data: picture.data,
        ...(widthPt === undefined ? {} : { widthPt: Math.min(2_000, Math.max(1, widthPt)) }),
      });
    }
    return out;
  }

  // ---- the body, in order
  const blocks: WordBlock[] = [];
  const push = (block: WordBlock) => {
    if (blocks.length >= WORD_PDF_LIMITS.blocks) throw new DocxRefused('too-complex', 'blocks');
    blocks.push(block);
  };

  async function paragraphBlocks(p: XmlElement) {
    const paragraph = paragraphOf(p, styles, counters, null);
    if (paragraph.pageBreakBefore && blocks.length > 0) push({ kind: 'pageBreak' });
    const runs = runsOf(paragraph);
    if (hasText(runs)) {
      const level = headingLevel(child(child(p, 'w:pPr'), 'w:pStyle')?.attrs['w:val']);
      if (level) push({ kind: 'heading', level, runs });
      else {
        push({
          kind: 'paragraph',
          runs,
          ...(paragraph.numbering
            ? { marker: paragraph.numbering.rendered, depth: Math.min(8, paragraph.numbering.ilvl) }
            : {}),
        });
      }
    }
    for (const picture of await imagesOf(p)) push(picture);
  }

  async function tableBlock(tbl: XmlElement) {
    const pictures: WordBlock[] = [];
    const rows = [];
    for (const tr of childrenNamed(tbl, 'w:tr')) {
      const cells = [];
      for (const tc of childrenNamed(tr, 'w:tc')) {
        const paragraphs: WordRun[][] = [];
        const visit = async (parent: XmlElement) => {
          for (const node of parent.children) {
            if (typeof node === 'string') continue;
            if (node.name === 'w:p') {
              const paragraph = paragraphOf(node, styles, counters, { row: 0, col: 0 });
              const runs = runsOf(paragraph);
              if (paragraph.numbering) runs.unshift({ text: `${paragraph.numbering.rendered} ` });
              if (hasText(runs)) paragraphs.push(runs);
              pictures.push(...(await imagesOf(node)));
            } else if (node.name === 'w:tbl' || node.name === 'w:tr' || node.name === 'w:tc') {
              await visit(node); // a table inside a cell is read into the cell, flat
            }
          }
        };
        await visit(tc);
        const span = Number(child(child(tc, 'w:tcPr'), 'w:gridSpan')?.attrs['w:val']);
        cells.push({
          colSpan: Number.isInteger(span) && span >= 1 ? Math.min(64, span) : 1,
          paragraphs: paragraphs.slice(0, 200),
        });
      }
      rows.push(cells.slice(0, 64));
    }
    if (rows.length > 0) push({ kind: 'table', rows: rows.slice(0, 2_000) });
    for (const picture of pictures) push(picture);
  }

  async function content(parent: XmlElement) {
    for (const node of parent.children) {
      if (typeof node === 'string') continue;
      if (node.name === 'w:p') await paragraphBlocks(node);
      else if (node.name === 'w:tbl') await tableBlock(node);
      else if (node.name === 'w:sdt') await content(child(node, 'w:sdtContent') ?? NONE);
      else if (node.name === 'w:customXml') await content(node);
    }
  }
  await content(body);

  addCount(dropped, 'image', skipped);
  return { blocks, dropped: dropped.filter((item) => item.count > 0) };
}

function addCount(list: Dropped[], kind: DroppedKind, count: number) {
  const existing = list.find((item) => item.kind === kind);
  if (existing) existing.count += count;
  else list.push({ kind, count });
}

/**
 * Counts what the PDF will not show. Headers and footers count only when they hold text (Word
 * writes empty ones); fields count except hyperlinks, whose text is kept either way. A field's
 * shown result is kept as Word last saved it; tracked insertions are kept and deletions are not.
 */
async function droppedParts(
  zip: Zip,
  body: XmlElement,
  relationships: ReadonlyMap<string, XmlElement>,
  dir: string,
): Promise<Dropped[]> {
  const list: Dropped[] = [];
  const headerFooterIds = new Set<string>();
  let textBoxes = 0;
  let footnotes = 0;
  let tracked = 0;
  let fields = 0;
  const open: { instruction: string; decided: boolean }[] = [];
  const decide = (field: { instruction: string; decided: boolean } | undefined) => {
    if (!field || field.decided) return;
    field.decided = true;
    if (!/^\s*HYPERLINK\b/i.test(field.instruction)) fields += 1;
  };

  walk(body, (element) => {
    switch (element.name) {
      case 'mc:Fallback':
        return false;
      case 'w:txbxContent':
        textBoxes += 1;
        return false;
      case 'w:rPr':
        return false; // a paragraph mark's or a run's own `w:ins`/`w:del` is not a change to text
      case 'w:headerReference':
      case 'w:footerReference': {
        const id = element.attrs['r:id'];
        if (id) headerFooterIds.add(id);
        return;
      }
      case 'w:footnoteReference':
      case 'w:endnoteReference':
        footnotes += 1;
        return;
      case 'w:ins':
      case 'w:del':
      case 'w:moveFrom':
      case 'w:moveTo':
        tracked += 1;
        return;
      case 'w:fldSimple':
        if (!/^\s*HYPERLINK\b/i.test(element.attrs['w:instr'] ?? '')) fields += 1;
        return;
      case 'w:instrText':
        if (open.length > 0) open[open.length - 1]!.instruction += textOf(element);
        return;
      case 'w:fldChar': {
        const type = element.attrs['w:fldCharType'];
        if (type === 'begin') open.push({ instruction: '', decided: false });
        else if (type === 'separate') decide(open.at(-1));
        else if (type === 'end') decide(open.pop());
        return;
      }
      default:
        return;
    }
  });
  for (const unfinished of open) decide(unfinished);

  let headerFooters = 0;
  const seen = new Set<string>();
  for (const id of headerFooterIds) {
    const path = targetOf(relationships.get(id), dir);
    if (!path || seen.has(path)) continue;
    seen.add(path);
    const xml = await part(zip, path);
    let words = false;
    if (xml) {
      walk(xml, (element) => {
        if (element.name === 'w:t' && textOf(element).trim() !== '') words = true;
      });
    }
    if (words) headerFooters += 1;
  }

  addCount(list, 'headerFooter', headerFooters);
  addCount(list, 'textBox', textBoxes);
  addCount(list, 'footnote', footnotes);
  addCount(list, 'trackedChange', tracked);
  addCount(list, 'field', fields);
  return list;
}
