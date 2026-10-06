import { inputSha256, type Decision, type Evidence, type StageResult } from '../debug.js';
import { lowerMedian, unionBox } from '../ir/geometry.js';
import type {
  BlockRole,
  Box,
  Cell,
  DocxNumbering,
  IrBlock,
  IrColumn,
  IrLine,
  IrPage,
  IrSource,
  IrWord,
  LayoutDocument,
  RawDocument,
  RawPage,
  RawWord,
  Repair,
} from '../ir/types.js';
import { IrError } from '../ir/validate.js';
import { endsWithCjk, startsWithCjk, textHints } from './hints.js';
import {
  documentLocale,
  furnitureKey,
  isConjunction,
  isPageNumberKey,
  scriptLocale,
} from './lexicon.js';
import { columnRegions, type CutDecision, type Region } from './xycut.js';

/**
 * Stage 2, reassemble: raw words in, a layout document out — `docs/plan/IMPORT-PIPELINE.md` §2,
 * step by step; each function below names the step it implements, and each decision in the debug
 * artifact names its rule (the table in §2).
 *
 * Measured sources (`text-layer`, `ocr`) go through every step. Synthetic ones (`docx`, `paste`)
 * carry only what their source said — order, indentation, paragraph breaks — so the steps that
 * read real geometry are switched off for them by the source, never by a guess: no column cut
 * (one region, the synthetic text area), no hyphenation (a paragraph has no soft wraps), no page
 * furniture or footnotes (a synthetic page has no margins). A line is one paragraph.
 *
 * Pure: no clock, no randomness, integers only; the same document gives the same bytes.
 */

/** Bumped when the stage's output changes on purpose (the debug artifact records it). */
export const REASSEMBLE_STAGE_VERSION = 5;

/** §2.1: the presentation-form ligatures, and what each is. */
const LIGATURES: Readonly<Record<string, string>> = {
  '\uFB00': 'ff',
  '\uFB01': 'fi',
  '\uFB02': 'fl',
  '\uFB03': 'ffi',
  '\uFB04': 'ffl',
  '\uFB05': 'st',
  '\uFB06': 'st',
};
const LIGATURE = /[\uFB00-\uFB06]/gu;

/** The synthetic text area (`LAYOUT-IR.md`, "Synthetic geometry"). */
const TEXT_LEFT = 1000;
const TEXT_RIGHT = 9000;

/** §2.6: the page's top and bottom 8%. */
const TOP_MARGIN = 800;
const BOTTOM_MARGIN = 9200;
/** §2.7: a footnote starts in the bottom quarter. */
const FOOT_QUARTER = 7500;

const SYNTHETIC: ReadonlySet<IrSource> = new Set(['docx', 'paste']);

/** A raw word after §2.1, with where it came from. */
interface Word {
  text: string;
  box: Box;
  baseline: number;
  fontSize: number;
  fontWeight: 400 | 700;
  italic: boolean;
  ocrConfidence: number | null;
  repair: Repair | null;
  readonly source: IrSource;
  readonly paragraph: number | null;
  readonly docxNumbering: DocxNumbering | null;
  readonly cell: Cell | null;
  /** Its index in the raw page: the tie-breaker that keeps every sort total. */
  readonly order: number;
}

/** A line being built: its words, and what it is. */
interface Line {
  words: Word[];
  readonly source: IrSource;
  readonly synthetic: boolean;
  furniture: { rule: 'F1' | 'F2'; margin: 'top' | 'bottom'; pages: number } | null;
  /** Hyphen joins made at its end, for the debug artifact. */
  readonly joins: { rule: 'Y1' | 'Y2' | 'Y3'; raw: string; word: string }[];
  /** Words made of touching parts (L3, L3b), for the debug artifact. */
  readonly touching: { word: string; parts: string[]; rule: 'L3' | 'L3b' }[];
}

interface Block {
  lines: Line[];
  role: BlockRole;
  rule: string;
  evidence: Evidence;
}

interface PageRegion {
  readonly rect: Box;
  readonly synthetic: boolean;
  lines: Line[];
  blocks: Block[];
}

const lineText = (line: Line) => line.words.map((word) => word.text).join(' ');
const lineBox = (line: Line) => unionBox(line.words.map((word) => word.box));
const lineBaseline = (line: Line) => lowerMedian(line.words.map((word) => word.baseline));
const lineFontSize = (line: Line) => lowerMedian(line.words.map((word) => word.fontSize));
const byOrder = (a: Word, b: Word) => a.order - b.order;

// ------------------------------------------------------------------ §2.1 ligatures
function wordsOf(page: RawPage): Word[] {
  const words: Word[] = [];
  page.words.forEach((raw: RawWord, order) => {
    if (raw.text.trim() === '') return;
    const expanded = raw.text.replace(LIGATURE, (c) => LIGATURES[c] ?? c);
    const repair: Repair | null =
      expanded === raw.text ? raw.repair : { kind: 'ligature', raw: raw.repair?.raw ?? raw.text };
    words.push({
      text: expanded,
      box: raw.box,
      baseline: raw.baseline,
      fontSize: raw.fontSize,
      fontWeight: raw.fontWeight,
      italic: raw.italic,
      ocrConfidence: raw.ocrConfidence,
      repair,
      source: raw.source,
      paragraph: raw.paragraph,
      docxNumbering: raw.docxNumbering,
      cell: raw.cell,
      order,
    });
  });
  return words;
}

// ------------------------------------------------------------------ §2.3 lines
/** Measured words into lines: the same baseline within half an em, and the same source. */
function measuredLines(words: readonly Word[]): Line[] {
  const em = lowerMedian(words.map((word) => word.fontSize));
  const sorted = [...words].sort(
    (a, b) => a.baseline - b.baseline || a.box.x0 - b.box.x0 || byOrder(a, b),
  );
  const lines: Line[] = [];
  const open = new Map<IrSource, { line: Line; anchor: number }>();
  for (const word of sorted) {
    const current = open.get(word.source);
    if (current && Math.abs(word.baseline - current.anchor) * 2 <= em) {
      current.line.words.push(word);
      continue;
    }
    const line: Line = {
      words: [word],
      source: word.source,
      synthetic: false,
      furniture: null,
      joins: [],
      touching: [],
    };
    lines.push(line);
    open.set(word.source, { line, anchor: word.baseline });
  }
  for (const line of lines) {
    line.words.sort((a, b) => a.box.x0 - b.box.x0 || byOrder(a, b));
    joinTouching(line);
  }
  return lines;
}

/**
 * L3 — touching words are one word (§2.12, #143): two neighbours no more than a tenth of an em
 * apart are printed as one. pdf.js gives a text item per run, and a run ends where the font changes
 * — "1" in a Latin font, "．姓名：" in a Chinese one — or where it gives a full stop, or a soft
 * hyphen printed at a line's end (#141), on its own. A word after a space never touches: a space is
 * a quarter of an em.
 *
 * L3b (#148): Chinese and Japanese put no space between words, and a typesetter sets a number among
 * them a quarter of an em apart (JIS X 4051's, Word's and LibreOffice's "autospace") — "最多", "8",
 * "人）：" — so digits next to a Chinese or Japanese character, no more than a third of an em apart,
 * are one word with it. Letters keep their spaces: "氏名 Name" is two words on a bilingual form.
 */
function joinTouching(line: Line): void {
  const words: Word[] = [];
  let parts: string[] = [];
  let rule: 'L3' | 'L3b' = 'L3';
  for (const word of line.words) {
    const previous = words.at(-1);
    const gap = previous ? word.box.x0 - previous.box.x1 : 0;
    const touches = !!previous && gap * 10 <= word.fontSize;
    const autospace =
      !!previous &&
      !touches &&
      gap * 3 <= word.fontSize &&
      ((endsWithCjk(previous.text) && /^\d/u.test(word.text)) ||
        (/\d$/u.test(previous.text) && startsWithCjk(word.text)));
    if (!previous || (!touches && !autospace)) {
      if (parts.length > 1) line.touching.push({ word: previous!.text, parts, rule });
      words.push(word);
      parts = [word.text];
      rule = 'L3';
      continue;
    }
    if (autospace) rule = 'L3b';
    // The word is set in what most of its letters are set in.
    const heavier = [...word.text].length > [...previous.text].length ? word : previous;
    words[words.length - 1] = {
      ...previous,
      text: `${previous.text}${word.text}`,
      box: unionBox([previous.box, word.box]),
      fontWeight: heavier.fontWeight,
      italic: heavier.italic,
      ocrConfidence:
        previous.ocrConfidence === null || word.ocrConfidence === null
          ? (previous.ocrConfidence ?? word.ocrConfidence)
          : Math.min(previous.ocrConfidence, word.ocrConfidence),
      repair:
        previous.repair || word.repair
          ? {
              kind: (previous.repair ?? word.repair)!.kind,
              raw: `${previous.repair?.raw ?? previous.text}${word.repair?.raw ?? word.text}`,
            }
          : null,
    };
    parts.push(word.text);
  }
  if (parts.length > 1) line.touching.push({ word: words.at(-1)!.text, parts, rule });
  line.words = words;
}

/** Synthetic words into lines: one paragraph is one line, in the source's own order. */
function syntheticLines(words: readonly Word[]): Line[] {
  const byParagraph = new Map<string, Line>();
  for (const word of [...words].sort(byOrder)) {
    const key = `${word.source}:${word.paragraph ?? `w${word.order}`}`;
    let line = byParagraph.get(key);
    if (!line) {
      line = {
        words: [],
        source: word.source,
        synthetic: true,
        furniture: null,
        joins: [],
        touching: [],
      };
      byParagraph.set(key, line);
    }
    line.words.push(word);
  }
  return [...byParagraph.values()].sort(
    (a, b) => lineBaseline(a) - lineBaseline(b) || byOrder(a.words[0]!, b.words[0]!),
  );
}

// ------------------------------------------------------------------ §2.5 blocks
const fontsAgree = (a: number, b: number) => Math.abs(a - b) * 10 <= Math.max(a, b);

/** The lower quartile: the value a quarter of the way up, rounding down; 0 for no values. */
function lowerQuartile(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[(sorted.length - 1) >> 2] ?? 0;
}

/**
 * Consecutive lines stay in one block when the gap is at most 1.5 × the region's line pitch and
 * their sizes agree within 10% — and when they are the same kind of thing: furniture never shares
 * a block with text, a table cell never with a paragraph outside it (§2.9).
 *
 * The pitch is the lower quartile of the gaps between consecutive baselines. The median, as §2.5
 * was first written, is a paragraph gap on a form of short sections — a heading, two items, a
 * heading — and every heading then joined the list under it (`short-sections`).
 *
 * A Word table is one block, whatever the gaps, until its rows start again (B1t, #152): Word said
 * its cells are one table, and the gaps are the reader's — it stacks every cell, an empty one too,
 * so a table of rows left empty to fill in came apart a row to a block.
 */
function blocksOf(lines: readonly Line[]): Block[] {
  const baselines = lines.map(lineBaseline);
  const pitches = baselines
    .slice(1)
    .map((b, i) => b - (baselines[i] ?? b))
    .filter((d) => d > 0);
  const pitch = lowerQuartile(pitches);
  const blocks: Block[] = [];
  lines.forEach((line, i) => {
    const previous = lines[i - 1];
    const block = blocks.at(-1);
    const before = previous?.words[0]?.cell;
    const cell = line.words[0]?.cell;
    const tables = line.source === 'docx' && !!before && !!cell;
    const sameTable = tables && cell.row >= before.row;
    const together =
      !!previous &&
      !!block &&
      (!tables || sameTable) &&
      (sameTable ||
        (((baselines[i] ?? 0) - (baselines[i - 1] ?? 0)) * 2 <= pitch * 3 &&
          fontsAgree(lineFontSize(previous), lineFontSize(line)))) &&
      !!previous.furniture === !!line.furniture &&
      !!previous.words[0]?.cell === !!line.words[0]?.cell &&
      previous.source === line.source;
    if (together) block.lines.push(line);
    else blocks.push({ lines: [line], role: 'body', rule: 'B1', evidence: {} });
  });
  return blocks;
}

// ------------------------------------------------------------------ §2.4 hyphenation
/** §2 of NUMBERING-RULES, `WRAPPED`: the line reaches 90% of its column. */
const wrapped = (line: Line, rect: Box) =>
  (lineBox(line).x1 - rect.x0) * 10 >= (rect.x1 - rect.x0) * 9;

/**
 * Whether the next line's first word could not have fitted after this line: the line broke where it
 * did because the word did not fit. Exact where `wrapped`'s 90% is a rule of thumb, which a long
 * word defeats: a Swedish compound is a seventh of a line, and a ragged line before one ends short
 * of 90% (#141).
 */
const noRoomFor = (word: Word, line: Line, rect: Box) =>
  lineBox(line).x1 + (word.box.x1 - word.box.x0) > rect.x1;

/**
 * A wrapped line ending in a hyphen after a letter, followed in its block by a line starting with
 * a letter: the next line's first word is joined on. Wrapped is `wrapped`, or the next line's first
 * word would not have fitted after it (`noRoomFor`). The hyphen goes (Y1) when the continuation is
 * lower-case and the fragment has at least three letters, and stays (Y2) otherwise. No dictionary.
 * Before a conjunction nothing is joined (Y3): "för-" / "och efternamn" is a suspended compound,
 * "för- och efternamn", and joining it would write "föroch".
 */
function dehyphenate(block: Block, rect: Box): void {
  for (let i = 0; i + 1 < block.lines.length; i += 1) {
    const line = block.lines[i]!;
    const next = block.lines[i + 1]!;
    const last = line.words.at(-1);
    const first = next.words[0];
    if (!last || !first || line.synthetic) continue;
    const fragment = /(\p{L}+)-$/u.exec(last.text)?.[1];
    if (!fragment || !/^\p{L}/u.test(first.text)) continue;
    if (!wrapped(line, rect) && !noRoomFor(first, line, rect)) continue;
    if (isConjunction(first.text)) {
      line.joins.push({ rule: 'Y3', raw: `${last.text}\n${first.text}`, word: last.text });
      continue;
    }
    const drop = /^\p{Ll}/u.test(first.text) && [...fragment].length >= 3;
    const raw = `${last.repair?.raw ?? last.text}\n${first.repair?.raw ?? first.text}`;
    const text = drop ? `${last.text.slice(0, -1)}${first.text}` : `${last.text}${first.text}`;
    const joined: Word = {
      ...last,
      text,
      repair: { kind: drop ? 'dehyphenated' : 'joined-at-break', raw },
      ocrConfidence:
        last.ocrConfidence === null || first.ocrConfidence === null
          ? last.ocrConfidence
          : Math.min(last.ocrConfidence, first.ocrConfidence),
    };
    line.words[line.words.length - 1] = joined;
    line.joins.push({ rule: drop ? 'Y1' : 'Y2', raw, word: text });
    next.words.shift();
    if (next.words.length === 0) {
      block.lines.splice(i + 1, 1);
      i -= 1; // this line may join the one after the emptied line too
    }
  }
}

// ------------------------------------------------------------------ §2.6 page furniture
/** Marks every margin line that repeats on enough pages, or is a page number. */
function markFurniture(pages: readonly PageRegion[][]): void {
  const margin = (line: Line): 'top' | 'bottom' | null => {
    if (line.synthetic) return null;
    const box = lineBox(line);
    return box.y1 <= TOP_MARGIN ? 'top' : box.y0 >= BOTTOM_MARGIN ? 'bottom' : null;
  };
  const seen = new Map<string, Set<number>>();
  pages.forEach((regions, pageIndex) => {
    for (const line of regions.flatMap((region) => region.lines)) {
      const where = margin(line);
      if (!where) continue;
      const key = `${where}\u0000${furnitureKey(lineText(line))}`;
      const on = seen.get(key) ?? new Set<number>();
      on.add(pageIndex);
      seen.set(key, on);
    }
  });
  for (const regions of pages) {
    for (const line of regions.flatMap((region) => region.lines)) {
      const where = margin(line);
      if (!where) continue;
      const key = furnitureKey(lineText(line));
      const count = seen.get(`${where}\u0000${key}`)?.size ?? 0;
      if (isPageNumberKey(key)) line.furniture = { rule: 'F2', margin: where, pages: count };
      else if (count >= 2 && count * 2 >= pages.length) {
        line.furniture = { rule: 'F1', margin: where, pages: count };
      }
    }
  }
}

// ------------------------------------------------------------------ §2.7–§2.9 roles
const ENDS_IN_PUNCTUATION = /[.,:;?!]$/u;
const FOOTNOTE_MARK = /^[\p{Nd}⁰¹²³⁴⁵⁶⁷⁸⁹*†‡]/u;

function roleOf(block: Block, isLastRegion: boolean, bodyMedian: number): void {
  const lines = block.lines;
  const first = lines[0]!;
  const size = lowerMedian(lines.map(lineFontSize));
  if (first.furniture) {
    block.role = 'page-furniture';
    block.rule = first.furniture.rule;
    block.evidence = { margin: first.furniture.margin, pages: first.furniture.pages };
    return;
  }
  const measured = !first.synthetic;
  const box = unionBox(lines.map(lineBox));
  const firstWord = first.words[0]!;
  const superscript = firstWord.fontSize * 10 <= lineFontSize(first) * 7;
  if (
    measured &&
    isLastRegion &&
    box.y0 >= FOOT_QUARTER &&
    size * 100 <= bodyMedian * 85 &&
    (FOOTNOTE_MARK.test(firstWord.text) || superscript)
  ) {
    block.role = 'footnote';
    block.rule = 'N1';
    block.evidence = { size, body: bodyMedian };
    return;
  }
  if (first.words[0]?.cell) {
    block.role = 'table';
    block.rule = 'T1';
    block.evidence = {};
    return;
  }
  const text = lineText(first);
  const length = [...text].length;
  const hints = textHints(text);
  const letters = (text.match(/\p{L}/gu) ?? []).length;
  const upper = (text.match(/\p{Lu}/gu) ?? []).length;
  const heading: [string, boolean][] = [
    ['H1', lines.length <= 2 && bodyMedian > 0 && size * 5 >= bodyMedian * 6],
    [
      'H2',
      lines.length === 1 &&
        first.words.every((word) => word.fontWeight === 700) &&
        length <= 80 &&
        !ENDS_IN_PUNCTUATION.test(text),
    ],
    [
      'H3',
      lines.length === 1 &&
        upper >= 3 &&
        upper === letters &&
        length <= 60 &&
        !ENDS_IN_PUNCTUATION.test(text) &&
        !hints.blankRun &&
        hints.checkboxes === 0,
    ],
  ];
  const rule = heading.find(([, holds]) => holds)?.[0];
  if (rule) {
    block.role = 'heading';
    block.rule = rule;
    block.evidence = { size, body: bodyMedian, lines: lines.length };
  }
}

// ------------------------------------------------------------------ §2.10 bands, hints
/** `LAYOUT-IR.md`, "Indent bands": each band opened by its first value, 2% of the width. */
function bandsOf(starts: readonly number[], width: number): number[] {
  const bands: number[] = [];
  for (const x of [...new Set(starts)].sort((a, b) => a - b)) {
    const open = bands.at(-1);
    if (open === undefined || (x - open) * 50 > width) bands.push(x);
  }
  return bands;
}

/** The band a line starts in; furniture and footnotes take the one their x0 falls in, else 0. */
function bandIndex(bands: readonly number[], x: number, width: number): number {
  const index = bands.findLastIndex((band) => band <= x && (x - band) * 50 <= width);
  return index < 0 ? 0 : index;
}

/**
 * `ruleBelow` (`LAYOUT-IR.md`, `LineHints`): a rule drawn at or under the baseline, within an em
 * of it, reaching at least 20% of the column's width beyond the line's last word.
 */
function ruleBelow(box: Box, baseline: number, size: number, rules: readonly Box[], width: number) {
  return rules.some(
    (rule) =>
      rule.y1 >= baseline &&
      rule.y0 <= baseline + size &&
      rule.x1 > box.x1 &&
      (rule.x1 - box.x1) * 5 >= width,
  );
}

function irWords(line: Line): IrWord[] {
  let start = 0;
  return line.words.map((word) => {
    const ir: IrWord = {
      text: word.text,
      start,
      box: word.box,
      baseline: word.baseline,
      fontSize: word.fontSize,
      fontWeight: word.fontWeight,
      italic: word.italic,
      ocrConfidence: word.ocrConfidence,
      repair: word.repair,
    };
    start += word.text.length + 1;
    return ir;
  });
}

// ------------------------------------------------------------------ the stage
export function reassemble(raw: RawDocument): StageResult<LayoutDocument> {
  const decisions: Decision[] = [];
  const decide = (id: string, rule: string, verdict: string, subject: string[], ev: Evidence) =>
    decisions.push({ id: `reassemble:${id}`, rule, subject, verdict, evidence: ev });

  // §2.1–§2.3: per page, regions and their lines.
  const pages: PageRegion[][] = raw.pages.map((page) => {
    const words = wordsOf(page);
    const synthetic = words.filter((word) => SYNTHETIC.has(word.source));
    if (synthetic.length > 0 && synthetic.length < words.length) {
      throw new IrError([`page ${page.pageNo}: synthetic and measured words on one page`]);
    }
    if (words.length === 0) return [];
    if (synthetic.length > 0) {
      const extent = unionBox(words.map((word) => word.box));
      const rect = {
        ...extent,
        x0: Math.min(TEXT_LEFT, extent.x0),
        x1: Math.max(TEXT_RIGHT, extent.x1),
      };
      return [{ rect, synthetic: true, lines: syntheticLines(words), blocks: [] }];
    }
    let cuts = 0;
    const regions = columnRegions(words, (d: CutDecision) => {
      cuts += 1;
      decide(`p${page.pageNo}-cut${cuts}`, d.rule, d.verdict, [], d.evidence);
    });
    return regions.map((region: Region<Word>): PageRegion => ({
      rect: region.rect,
      synthetic: false,
      lines: measuredLines(region.words),
      blocks: [],
    }));
  });

  // §2.6 before blocks: furniture never shares a block, and nothing is joined into it.
  markFurniture(pages);

  // §2.5 blocks, then §2.4 hyphenation inside them.
  for (const region of pages.flat()) {
    region.blocks = blocksOf(region.lines);
    for (const block of region.blocks) dehyphenate(block, region.rect);
    region.lines = region.blocks.flatMap((block) => block.lines);
  }

  // §2.7–§2.9 roles, against the page's body median.
  for (const regions of pages) {
    const body = regions.flatMap((region) => region.lines).filter((line) => !line.furniture);
    const bodyMedian = lowerMedian(body.map(lineFontSize));
    regions.forEach((region, index) => {
      for (const block of region.blocks) {
        roleOf(block, index === regions.length - 1, bodyMedian);
      }
    });
  }

  // §2.10: ids, bands and hints, in reading order.
  const irPages: IrPage[] = raw.pages.map((page, pageIndex) => {
    const p = page.pageNo;
    const regions = pages[pageIndex] ?? [];
    let lineNo = 0;
    let blockNo = 0;
    const columns: IrColumn[] = [];
    const blocks: IrBlock[] = [];
    regions.forEach((region, columnIndex) => {
      const width = region.rect.x1 - region.rect.x0;
      const banded = region.blocks.filter(
        (block) => block.role !== 'page-furniture' && block.role !== 'footnote',
      );
      const starts = (banded.length > 0 ? banded : region.blocks).flatMap((block) =>
        block.lines.map((line) => lineBox(line).x0),
      );
      const bands = bandsOf(starts, width);
      columns.push({ index: columnIndex, ...region.rect, bands });

      for (const block of region.blocks) {
        blockNo += 1;
        const blockId = `p${p}-b${blockNo}`;
        const lines: IrLine[] = block.lines.map((line) => {
          lineNo += 1;
          const id = `p${p}-l${lineNo}`;
          const words = irWords(line);
          const text = lineText(line);
          const box = lineBox(line);
          const baseline = lineBaseline(line);
          const fontSize = lineFontSize(line);
          const first = line.words[0]!;
          const ocr = line.source === 'ocr';
          line.words.forEach((word, i) => {
            if (word.repair?.kind === 'ligature') {
              decide(`${id}-w${i + 1}`, 'L1', 'ligature', [id], { raw: word.repair.raw });
            }
            // Stage 1's, from the picture; recorded here, where every repair is.
            if (word.repair?.kind === 'box-mark') {
              decide(`${id}-w${i + 1}`, 'L2', 'box-mark', [id], { raw: word.repair.raw });
            }
          });
          line.touching.forEach((touched, i) => {
            decide(`${id}-touch${i + 1}`, touched.rule, 'touching', [id], {
              word: touched.word,
              parts: touched.parts.join(' + '),
            });
          });
          line.joins.forEach((join, i) => {
            const verdict =
              join.rule === 'Y1'
                ? 'dehyphenated'
                : join.rule === 'Y2'
                  ? 'joined-at-break'
                  : 'suspended-compound';
            decide(`${id}-hyphen${i + 1}`, join.rule, verdict, [id], { word: join.word });
          });
          return {
            id,
            pageNo: p,
            columnIndex,
            blockId,
            text,
            words,
            box,
            baseline,
            fontSize,
            fontWeight: line.words.every((word) => word.fontWeight === 700) ? 700 : 400,
            indentBand: bandIndex(bands, box.x0, width),
            source: line.source,
            ocrConfidence: ocr
              ? Math.min(...line.words.map((word) => word.ocrConfidence ?? 0))
              : null,
            hints: textHints(text, {
              ruleBelow:
                line.source === 'text-layer' &&
                ruleBelow(box, baseline, fontSize, page.rules, width),
              docxNumbering: line.source === 'docx' ? first.docxNumbering : null,
            }),
            cell: line.source === 'docx' ? first.cell : null,
          };
        });
        decide(
          blockId,
          block.rule,
          block.role,
          lines.map((line) => line.id),
          block.evidence,
        );
        blocks.push({
          id: blockId,
          pageNo: p,
          columnIndex,
          role: block.role,
          box: unionBox(lines.map((line) => line.box)),
          lines,
        });
      }
    });
    return { pageNo: p, widthPt: page.widthPt, heightPt: page.heightPt, columns, blocks };
  });

  // §2.11 the document's language, from the text a reader reads.
  const read = irPages.flatMap((page) =>
    page.blocks
      .filter((block) => block.role !== 'page-furniture' && block.role !== 'footnote')
      .flatMap((block) => block.lines.map((line) => line.text)),
  );
  const locale = documentLocale(read);
  const evidence = {
    best: locale.best ?? '',
    hits: locale.hits,
    own: locale.own,
    runnerUp: locale.runnerUp,
  };
  // G1b (#145): a script only one of the twelve writes decides, whatever the stop words.
  const script = scriptLocale(read);
  const documentLanguage = script.locale ?? locale.locale;
  if (script.locale)
    decide('locale', 'G1b', script.locale, [], {
      script: script.script ?? '',
      inScript: script.inScript,
      letters: script.letters,
      ...evidence,
    });
  else decide('locale', 'G1', locale.locale ?? 'unknown', [], evidence);

  return {
    output: { irVersion: 1, source: raw.source, locale: documentLanguage, pages: irPages },
    debug: {
      stage: 'reassemble',
      stageVersion: REASSEMBLE_STAGE_VERSION,
      irVersion: 1,
      inputSha256: inputSha256(raw),
      decisions,
    },
  };
}
