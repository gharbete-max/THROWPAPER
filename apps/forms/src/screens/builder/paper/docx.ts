import { MAX_PAPER_PAGES } from '@tp/shared/forms';
import type { DocxNumbering, RawDocument, RawPage, RawWord } from '@tp/shared/import';
import { TooManyPages } from './extract.js';
import { DocxRefused } from './refusal.js';
import { at, child, childrenNamed, parseXml, type XmlElement } from './xml.js';
import { openZip, type Zip } from './zip.js';

/**
 * A Word document as stage 1's `RawDocument` — `docs/plan/IMPORT-PIPELINE.md` §1, DOCX, and
 * `LAYOUT-IR.md`, "How each source fills it". This is the half of the importer that touches a
 * Word file's bytes; everything after it is `@tp/shared/import`.
 *
 * It reads the main document part, its styles and its numbering, and nothing else: headers,
 * footers, footnotes, comments and text boxes are separate parts and are not read. Word's own list
 * numbering — the "1." Word draws, which is not in the paragraph's text — is computed from
 * `numbering.xml` exactly as Word counts, and handed on as `docxNumbering`, which stage 3 takes as
 * fact (NUMBERING-RULES §11).
 *
 * Geometry is synthetic and says only what the document said: order, indentation, paragraph
 * breaks, page breaks. One paragraph is one line on a virtual A4 page.
 *
 * Nothing here is sent anywhere: the file is read in this browser (ADR 0004), and the caps are
 * counted while reading (`zip.ts`, `xml.ts`).
 */

/** Which adapter made the document, for `source.extractor`. */
export const DOCX_EXTRACTOR = 'docx@1';
/** `IMPORT-PIPELINE.md`, "Caps": the file itself. */
export const MAX_DOCX_BYTES = 10 * 1024 * 1024;

// The synthetic metrics (`LAYOUT-IR.md`): a virtual A4 page, the text area from x 1000, the first
// baseline at 1000 and each next paragraph 180 lower, a new page after 9000, 92 iu a character, a
// tab stop every 368 iu. An A4 page is 11 906 twips wide and 842 points tall.
const LEFT = 1000;
const TOP = 1000;
const BOTTOM = 9000;
const PITCH = 180;
const ADVANCE = 92;
const TAB = 368;
const EDGE = 10_000;
const A4_TWIPS = 11_906;
const A4_POINTS = 842;
/** Word's own default when a document names no size: 10 pt, in half-points. */
const DEFAULT_HALF_POINTS = 20;

// ------------------------------------------------------------------ properties
const on = (element: XmlElement | undefined) =>
  !!element && !['0', 'false', 'off'].includes(element.attrs['w:val'] ?? 'true');
const int = (value: string | undefined) => {
  if (value === undefined || !/^-?\d+$/.test(value.trim())) return undefined;
  return Number.parseInt(value, 10);
};
const val = (element: XmlElement | undefined) => int(element?.attrs['w:val']);

interface Indent {
  left?: number;
  hanging?: number;
  firstLine?: number;
}
function indentOf(ind: XmlElement | undefined): Indent | undefined {
  if (!ind) return undefined;
  return {
    left: int(ind.attrs['w:left'] ?? ind.attrs['w:start']),
    hanging: int(ind.attrs['w:hanging']),
    firstLine: int(ind.attrs['w:firstLine']),
  };
}

interface RunLook {
  bold?: boolean;
  italic?: boolean;
  halfPoints?: number;
  hidden?: boolean;
}
function runLookOf(rPr: XmlElement | undefined): RunLook {
  if (!rPr) return {};
  const b = child(rPr, 'w:b');
  const i = child(rPr, 'w:i');
  const vanish = child(rPr, 'w:vanish');
  return {
    bold: b ? on(b) : undefined,
    italic: i ? on(i) : undefined,
    halfPoints: val(child(rPr, 'w:sz')),
    hidden: vanish ? on(vanish) : undefined,
  };
}
const merge = (under: RunLook, over: RunLook): RunLook => ({
  bold: over.bold ?? under.bold,
  italic: over.italic ?? under.italic,
  halfPoints: over.halfPoints ?? under.halfPoints,
  hidden: over.hidden ?? under.hidden,
});

// ------------------------------------------------------------------ styles
interface Style {
  basedOn?: string;
  numId?: number;
  ilvl?: number;
  indent?: Indent;
  look: RunLook;
}

interface Styles {
  readonly byId: ReadonlyMap<string, Style>;
  readonly defaultParagraph?: string;
  readonly defaults: RunLook;
}

function readStyles(root: XmlElement | undefined): Styles {
  const byId = new Map<string, Style>();
  let defaultParagraph: string | undefined;
  for (const style of root ? childrenNamed(root, 'w:style') : []) {
    const id = style.attrs['w:styleId'];
    if (!id) continue;
    const pPr = child(style, 'w:pPr');
    const numPr = child(pPr, 'w:numPr');
    byId.set(id, {
      basedOn: child(style, 'w:basedOn')?.attrs['w:val'],
      numId: val(child(numPr, 'w:numId')),
      ilvl: val(child(numPr, 'w:ilvl')),
      indent: indentOf(child(pPr, 'w:ind')),
      look: runLookOf(child(style, 'w:rPr')),
    });
    const isDefault = ['1', 'true', 'on'].includes(style.attrs['w:default'] ?? '');
    if (style.attrs['w:type'] === 'paragraph' && isDefault) defaultParagraph = id;
  }
  const defaults = runLookOf(at(root, 'w:docDefaults', 'w:rPrDefault', 'w:rPr'));
  return { byId, defaultParagraph, defaults };
}

/** A style and the ones it is based on, nearest first; a loop is cut where it closes. */
function chain(styles: Styles, id: string | undefined): Style[] {
  const out: Style[] = [];
  const seen = new Set<string>();
  let next = id ?? styles.defaultParagraph;
  while (next && !seen.has(next) && out.length < 32) {
    seen.add(next);
    const style = styles.byId.get(next);
    if (!style) break;
    out.push(style);
    next = style.basedOn;
  }
  return out;
}

// ------------------------------------------------------------------ numbering
interface Level {
  start: number;
  format: string;
  text: string;
  /** `w:lvlRestart`: undefined restarts after any higher level; 0 never; n after level n. */
  restart?: number;
  legal: boolean;
  indent?: Indent;
}

interface Numbering {
  readonly abstracts: ReadonlyMap<string, { levels: Map<number, Level>; styleLink?: string }>;
  readonly nums: ReadonlyMap<
    number,
    { abstractId: string; overrides: Map<number, { start?: number; level?: Level }> }
  >;
}

function levelOf(lvl: XmlElement): Level {
  return {
    start: val(child(lvl, 'w:start')) ?? 1,
    format: child(lvl, 'w:numFmt')?.attrs['w:val'] ?? 'decimal',
    text: child(lvl, 'w:lvlText')?.attrs['w:val'] ?? '',
    restart: val(child(lvl, 'w:lvlRestart')),
    legal: on(child(lvl, 'w:isLgl')),
    indent: indentOf(at(lvl, 'w:pPr', 'w:ind')),
  };
}

function readNumbering(root: XmlElement | undefined): Numbering {
  const abstracts = new Map<string, { levels: Map<number, Level>; styleLink?: string }>();
  const nums = new Map<
    number,
    { abstractId: string; overrides: Map<number, { start?: number; level?: Level }> }
  >();
  for (const abstract of root ? childrenNamed(root, 'w:abstractNum') : []) {
    const id = abstract.attrs['w:abstractNumId'];
    if (id === undefined) continue;
    const levels = new Map<number, Level>();
    for (const lvl of childrenNamed(abstract, 'w:lvl')) {
      const ilvl = int(lvl.attrs['w:ilvl']);
      if (ilvl !== undefined && ilvl >= 0 && ilvl <= 8) levels.set(ilvl, levelOf(lvl));
    }
    abstracts.set(id, { levels, styleLink: child(abstract, 'w:numStyleLink')?.attrs['w:val'] });
  }
  for (const num of root ? childrenNamed(root, 'w:num') : []) {
    const numId = int(num.attrs['w:numId']);
    const abstractId = child(num, 'w:abstractNumId')?.attrs['w:val'];
    if (numId === undefined || abstractId === undefined) continue;
    const overrides = new Map<number, { start?: number; level?: Level }>();
    for (const override of childrenNamed(num, 'w:lvlOverride')) {
      const ilvl = int(override.attrs['w:ilvl']);
      if (ilvl === undefined) continue;
      const lvl = child(override, 'w:lvl');
      overrides.set(ilvl, {
        start: val(child(override, 'w:startOverride')),
        level: lvl ? levelOf(lvl) : undefined,
      });
    }
    nums.set(numId, { abstractId, overrides });
  }
  return { abstracts, nums };
}

const ROMAN: readonly [number, string][] = [
  [1000, 'm'],
  [900, 'cm'],
  [500, 'd'],
  [400, 'cd'],
  [100, 'c'],
  [90, 'xc'],
  [50, 'l'],
  [40, 'xl'],
  [10, 'x'],
  [9, 'ix'],
  [5, 'v'],
  [4, 'iv'],
  [1, 'i'],
];
function roman(n: number): string {
  if (n <= 0 || n >= 4000) return String(n);
  let rest = n;
  let out = '';
  for (const [value, letters] of ROMAN) {
    while (rest >= value) {
      out += letters;
      rest -= value;
    }
  }
  return out;
}
/** Word's letters: a…z, then aa…zz, then aaa…: the letter repeats. */
function letters(n: number, alphabet: string): string {
  if (n <= 0) return String(n);
  const chars = [...alphabet];
  return (chars[(n - 1) % chars.length] ?? '').repeat(Math.floor((n - 1) / chars.length) + 1);
}
const CJK_DIGITS = '〇一二三四五六七八九';
function counting(n: number): string {
  if (n <= 0 || n >= 100) return String(n);
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  const head = tens === 0 ? '' : tens === 1 ? '十' : `${CJK_DIGITS[tens]}十`;
  return head + (ones === 0 ? '' : (CJK_DIGITS[ones] ?? ''));
}
const RUSSIAN = 'абвгдежзиклмнопрстуфхцчшщэюя';

/** A counter, written in a level's `w:numFmt`. */
export function formatCounter(n: number, format: string): string {
  switch (format) {
    case 'decimalZero':
      return n < 10 && n >= 0 ? `0${n}` : String(n);
    case 'lowerRoman':
      return roman(n);
    case 'upperRoman':
      return roman(n).toUpperCase();
    case 'lowerLetter':
      return letters(n, 'abcdefghijklmnopqrstuvwxyz');
    case 'upperLetter':
      return letters(n, 'abcdefghijklmnopqrstuvwxyz').toUpperCase();
    case 'russianLower':
      return letters(n, RUSSIAN);
    case 'russianUpper':
      return letters(n, RUSSIAN).toUpperCase();
    case 'ordinal': {
      const teen = n % 100 >= 11 && n % 100 <= 13;
      const suffix = teen ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
      return `${n}${suffix}`;
    }
    case 'decimalFullWidth':
    case 'decimalFullWidth2':
      return String(n).replace(/\d/g, (d) => String.fromCharCode(0xff10 + Number(d)));
    case 'chineseCounting':
    case 'chineseCountingThousand':
    case 'japaneseCounting':
    case 'taiwaneseCounting':
      return counting(n);
    case 'ideographDigital':
    case 'taiwaneseDigital':
      return String(n).replace(/\d/g, (d) => CJK_DIGITS[Number(d)] ?? d);
    case 'none':
      return '';
    default:
      return String(n);
  }
}

/**
 * Symbol-font characters: Word stores Wingdings' box as U+F0A8, Symbol's bullet as U+F0B7, and so
 * on — private-use code points that mean nothing outside that font. The boxes and bullets a form
 * uses are given their Unicode selves; any other private-use character is dropped.
 */
const SYMBOLS: Readonly<Record<number, string>> = {
  0xb7: '•',
  0xa7: '▪',
  0x6f: '□',
  0x71: '□',
  0xa8: '◻',
  0xfe: '☑',
  0xfd: '☒',
  0x6e: '■',
  0x6c: '●',
  0xa1: '○',
  0xd8: '➢',
  0xfc: '✓',
  0x76: '❖',
};
function unsymbol(text: string): string {
  return text.replace(/[\uF000-\uF0FF]/g, (c) => SYMBOLS[c.charCodeAt(0) - 0xf000] ?? '');
}

/** Word's counters, kept as Word keeps them: by abstract list, restarted by a list's overrides. */
class Counters {
  private readonly counts = new Map<string, (number | undefined)[]>();
  private readonly used = new Set<number>();

  constructor(
    private readonly numbering: Numbering,
    private readonly styles: Styles,
  ) {}

  /** The abstract list a `numId` uses, following a list style's link. */
  private abstractOf(numId: number): string | undefined {
    let abstractId = this.numbering.nums.get(numId)?.abstractId;
    for (let hops = 0; abstractId !== undefined && hops < 4; hops += 1) {
      const link = this.numbering.abstracts.get(abstractId)?.styleLink;
      if (!link) return abstractId;
      const linked = this.styles.byId.get(link)?.numId;
      const next = linked === undefined ? undefined : this.numbering.nums.get(linked)?.abstractId;
      if (next === undefined || next === abstractId) return abstractId;
      abstractId = next;
    }
    return abstractId;
  }

  level(numId: number, ilvl: number): Level {
    const override = this.numbering.nums.get(numId)?.overrides.get(ilvl)?.level;
    const abstractId = this.abstractOf(numId);
    const defined = abstractId
      ? this.numbering.abstracts.get(abstractId)?.levels.get(ilvl)
      : undefined;
    return (
      override ?? defined ?? { start: 1, format: 'decimal', text: `%${ilvl + 1}.`, legal: false }
    );
  }

  /** Counts a paragraph at `ilvl` of `numId`; its marker, or null when Word draws none. */
  next(numId: number, ilvl: number): DocxNumbering | null {
    const abstractId = this.abstractOf(numId);
    const num = this.numbering.nums.get(numId);
    if (abstractId === undefined || !num) return null;
    const counts = this.counts.get(abstractId) ?? [];
    this.counts.set(abstractId, counts);
    if (!this.used.has(numId)) {
      // A list's start overrides restart it the first time it is used.
      this.used.add(numId);
      for (const [level, { start }] of num.overrides) {
        if (start !== undefined) counts[level] = start - 1;
      }
    }
    const level = this.level(numId, ilvl);
    const current = counts[ilvl];
    counts[ilvl] = current === undefined ? level.start : current + 1;
    for (let deeper = ilvl + 1; deeper <= 8; deeper += 1) {
      const restart = this.level(numId, deeper).restart;
      if (restart === undefined || (restart > 0 && ilvl < restart)) counts[deeper] = undefined;
    }
    const rendered = unsymbol(
      level.text.replace(/%([1-9])/g, (_, n: string) => {
        const k = Number(n) - 1;
        const at = this.level(numId, k);
        const format = level.legal && at.format !== 'bullet' ? 'decimal' : at.format;
        return formatCounter(counts[k] ?? at.start, format);
      }),
    ).trim();
    if (rendered === '') return null;
    return { numId, ilvl, rendered, format: level.format };
  }
}

// ------------------------------------------------------------------ paragraphs
interface Piece {
  text: string;
  look: RunLook;
}

/** The text of a paragraph's runs, in order, as Word shows it. */
function piecesOf(paragraph: XmlElement, base: RunLook): Piece[] {
  const pieces: Piece[] = [];
  /** Complex fields: the instructions between begin and separate are not text. */
  const fields: ('code' | 'result')[] = [];
  const add = (text: string, look: RunLook) => {
    if (look.hidden || fields.includes('code')) return;
    const shown = unsymbol(text);
    if (shown !== '') pieces.push({ text: shown, look });
  };
  const run = (r: XmlElement) => {
    const look = merge(base, runLookOf(child(r, 'w:rPr')));
    for (const node of r.children) {
      if (typeof node === 'string') continue;
      switch (node.name) {
        case 'w:t':
          add(node.children.filter((c): c is string => typeof c === 'string').join(''), look);
          break;
        case 'w:tab':
        case 'w:ptab':
          add('\t', look);
          break;
        case 'w:br':
        case 'w:cr':
          add(' ', look);
          break;
        case 'w:noBreakHyphen':
          add('\u2011', look);
          break;
        case 'w:sym': {
          const code = Number.parseInt(node.attrs['w:char'] ?? '', 16);
          if (Number.isFinite(code))
            add(String.fromCharCode(code >= 0xf000 ? code : 0xf000 + code), look);
          break;
        }
        case 'w:fldChar': {
          const type = node.attrs['w:fldCharType'];
          if (type === 'begin') fields.push('code');
          else if (type === 'separate' && fields.length > 0) fields[fields.length - 1] = 'result';
          else if (type === 'end') fields.pop();
          break;
        }
        default:
          break;
      }
    }
  };
  const walk = (parent: XmlElement) => {
    for (const node of parent.children) {
      if (typeof node === 'string') continue;
      switch (node.name) {
        case 'w:r':
          run(node);
          break;
        case 'w:hyperlink':
        case 'w:ins':
        case 'w:moveTo':
        case 'w:smartTag':
        case 'w:customXml':
        case 'w:fldSimple':
        case 'w:dir':
        case 'w:bdo':
          walk(node);
          break;
        case 'w:sdt':
          if (child(node, 'w:sdtContent')) walk(child(node, 'w:sdtContent')!);
          break;
        default:
          break; // deletions, drawings, bookmarks, comments: not text anyone reads here
      }
    }
  };
  walk(paragraph);
  return pieces;
}

interface Paragraph {
  pieces: Piece[];
  numbering: DocxNumbering | null;
  /** In twips from the text area's left edge: where the first word starts. */
  indent: number;
  cell: { row: number; col: number } | null;
  pageBreakBefore: boolean;
}

function paragraphOf(
  p: XmlElement,
  styles: Styles,
  counters: Counters,
  cell: Paragraph['cell'],
): Paragraph {
  const pPr = child(p, 'w:pPr');
  const styleChain = chain(styles, child(pPr, 'w:pStyle')?.attrs['w:val']);
  const numPr = child(pPr, 'w:numPr');
  const numId =
    val(child(numPr, 'w:numId')) ?? styleChain.find((s) => s.numId !== undefined)?.numId;
  const ilvl = Math.min(
    8,
    Math.max(
      0,
      val(child(numPr, 'w:ilvl')) ?? styleChain.find((s) => s.ilvl !== undefined)?.ilvl ?? 0,
    ),
  );
  const look = [...styleChain]
    .reverse()
    .reduce((acc, style) => merge(acc, style.look), styles.defaults);
  const pieces = piecesOf(p, look);
  // Word counts an empty numbered paragraph too: it shows its number with nothing after it.
  const counted = numId && numId > 0 ? counters.next(numId, ilvl) : null;
  const numbering = pieces.some((piece) => piece.text.trim() !== '') ? counted : null;
  const levelIndent = numId && numId > 0 ? counters.level(numId, ilvl).indent : undefined;
  const indent =
    indentOf(child(pPr, 'w:ind')) ?? levelIndent ?? styleChain.find((s) => s.indent)?.indent ?? {};
  const left = indent.left ?? 0;
  // A numbered paragraph's words start at its text indent; the marker hangs in the space before.
  const start = numbering ? left : left + (indent.firstLine ?? 0) - (indent.hanging ?? 0);
  const pageBreakBefore =
    on(child(pPr, 'w:pageBreakBefore')) ||
    childrenNamed(p, 'w:r').some((r) =>
      childrenNamed(r, 'w:br').some((br) => br.attrs['w:type'] === 'page'),
    );
  return { pieces, numbering, indent: start, cell, pageBreakBefore };
}

/** The body's paragraphs in reading order; a table's, row by row, cell by cell. */
function paragraphsOf(body: XmlElement, styles: Styles, counters: Counters): Paragraph[] {
  const out: Paragraph[] = [];
  const walk = (parent: XmlElement, cell: Paragraph['cell']) => {
    for (const node of parent.children) {
      if (typeof node === 'string') continue;
      if (node.name === 'w:p') out.push(paragraphOf(node, styles, counters, cell));
      else if (node.name === 'w:tbl') {
        childrenNamed(node, 'w:tr').forEach((tr, row) => {
          childrenNamed(tr, 'w:tc').forEach((tc, col) => walk(tc, { row, col }));
        });
      } else if (node.name === 'w:sdt') {
        const content = child(node, 'w:sdtContent');
        if (content) walk(content, cell);
      } else if (node.name === 'w:customXml') walk(node, cell);
    }
  };
  walk(body, null);
  return out;
}

// ------------------------------------------------------------------ geometry
const iuOfTwips = (twips: number) => Math.round((twips * 10_000) / A4_TWIPS);
const sizeOf = (halfPoints: number) => Math.round((halfPoints * 10_000) / (2 * A4_POINTS));
const pinned = (x: number) => Math.min(Math.max(x, 0), EDGE);

/** A paragraph's words on its synthetic line. */
function wordsOf(
  paragraph: Paragraph,
  index: number,
  baseline: number,
  defaults: RunLook,
): RawWord[] {
  const x0 = pinned(LEFT + iuOfTwips(paragraph.indent));
  const words: RawWord[] = [];
  let x = x0;
  let current: { text: string; look: RunLook; x: number } | null = null;
  const flush = () => {
    if (!current) return;
    const size = sizeOf(current.look.halfPoints ?? defaults.halfPoints ?? DEFAULT_HALF_POINTS);
    words.push({
      text: current.text,
      box: {
        x0: pinned(current.x),
        y0: Math.max(0, baseline - Math.round((size * 4) / 5)),
        x1: pinned(current.x + ADVANCE * [...current.text].length),
        y1: Math.min(EDGE, baseline + Math.round(size / 5)),
      },
      baseline,
      fontSize: size,
      fontWeight: current.look.bold ? 700 : 400,
      italic: !!current.look.italic,
      ocrConfidence: null,
      repair: null,
      source: 'docx',
      paragraph: index,
      docxNumbering: words.length === 0 ? paragraph.numbering : null,
      cell: paragraph.cell,
    });
    current = null;
  };
  for (const piece of paragraph.pieces) {
    for (const c of piece.text) {
      if (c === '\t') {
        flush();
        x = x0 + (Math.floor((x - x0) / TAB) + 1) * TAB;
      } else if (/\s/u.test(c)) {
        flush();
        x += ADVANCE;
      } else {
        if (!current) current = { text: '', look: piece.look, x };
        current.text += c;
        x += ADVANCE;
      }
    }
  }
  flush();
  return words;
}

// ------------------------------------------------------------------ the adapter
async function part(zip: Zip, name: string): Promise<XmlElement | undefined> {
  const bytes = await zip.read(name);
  if (!bytes) return undefined;
  return parseXml(new TextDecoder('utf-8').decode(bytes));
}

/** A relationship's target, from a `.rels` part, resolved against `base` ("word/"). */
function target(rels: XmlElement | undefined, type: string, base: string): string | undefined {
  const relationship = (rels ? childrenNamed(rels, 'Relationship') : []).find((r) =>
    (r.attrs['Type'] ?? '').endsWith(`/${type}`),
  );
  const to = relationship?.attrs['Target'];
  if (!to || relationship?.attrs['TargetMode'] === 'External') return undefined;
  if (to.startsWith('/')) return to.slice(1);
  const parts = `${base}${to}`.split('/');
  const out: string[] = [];
  for (const piece of parts) {
    if (piece === '..') out.pop();
    else if (piece !== '.' && piece !== '') out.push(piece);
  }
  return out.join('/');
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)));
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Reads a Word document. Throws `DocxRefused`, or `TooManyPages`. */
export async function readDocx(file: ArrayBuffer | Uint8Array): Promise<RawDocument> {
  const bytes = file instanceof Uint8Array ? file : new Uint8Array(file);
  if (bytes.length > MAX_DOCX_BYTES) throw new DocxRefused('too-large', 'file size');
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf) {
    // An OLE compound file: an encrypted .docx, or an old .doc.
    throw new DocxRefused('protected', 'a compound file');
  }
  const zip = openZip(bytes);
  const main = target(await part(zip, '_rels/.rels'), 'officeDocument', '') ?? 'word/document.xml';
  const slash = main.lastIndexOf('/');
  const dir = slash < 0 ? '' : main.slice(0, slash + 1);
  const rels = await part(zip, `${dir}_rels/${main.slice(slash + 1)}.rels`);
  const document = await part(zip, main);
  const body = at(document, 'w:body');
  if (!document || document.name !== 'w:document' || !body) {
    throw new DocxRefused('unreadable', 'no WordprocessingML document');
  }
  const styles = readStyles(await part(zip, target(rels, 'styles', dir) ?? `${dir}styles.xml`));
  const numbering = readNumbering(
    await part(zip, target(rels, 'numbering', dir) ?? `${dir}numbering.xml`),
  );
  const paragraphs = paragraphsOf(body, styles, new Counters(numbering, styles));

  const size = at(body, 'w:sectPr', 'w:pgSz');
  const widthPt = Math.round((int(size?.attrs['w:w']) ?? A4_TWIPS) / 20);
  const heightPt = Math.round((int(size?.attrs['w:h']) ?? A4_POINTS * 20) / 20);
  const pages: RawPage[] = [];
  let words: RawWord[] = [];
  let baseline = TOP;
  const newPage = () => {
    pages.push({ pageNo: pages.length + 1, widthPt, heightPt, words, rules: [] });
    if (pages.length > MAX_PAPER_PAGES) throw new TooManyPages(pages.length);
    words = [];
    baseline = TOP;
  };
  paragraphs.forEach((paragraph, index) => {
    if ((paragraph.pageBreakBefore && words.length > 0) || baseline > BOTTOM) newPage();
    words.push(...wordsOf(paragraph, index, baseline, styles.defaults));
    baseline += PITCH;
  });
  if (words.length > 0 || pages.length === 0) newPage();

  return {
    irVersion: 1,
    source: { kind: 'docx', extractor: DOCX_EXTRACTOR, sha256: await sha256(bytes) },
    pages,
  };
}

/** Whether a file is a Word document, by its type or, failing that, its name. */
export function isDocx(file: { type: string; name: string }): boolean {
  return (
    file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    /\.docx$/i.test(file.name)
  );
}
