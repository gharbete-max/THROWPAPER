import { inputSha256, type Decision, type Evidence, type StageResult } from '../debug.js';
import { IrError } from '../ir/validate.js';
import type { BlockRole, IrBlock, IrColumn, IrLine, LayoutDocument } from '../ir/types.js';
import { gazetteerForm, isContinuationNotice, isMonth, isUnitWord } from './gazetteers.js';
import { grammar, type MarkerMatch, type Reading } from './grammar.js';
import type {
  EnumerateResult,
  Family,
  Flag,
  Item,
  Marker,
  RejectRule,
  Rejected,
  Style,
} from './types.js';

/**
 * Stage 3, enumerate: which lines start list items, how the items nest, and how sure that is —
 * exactly `docs/plan/NUMBERING-RULES.md`. Each function below names the section it implements; a
 * disagreement between the two is a bug in whichever one a fixture proves wrong.
 *
 * The input is a valid layout document (`parseLayoutDocument`); there is no other input: no
 * locale, no options, no clock. The pass keeps its state in one closure per call, so two calls
 * share nothing and the same document always gives the same bytes.
 *
 * Not here yet: a line carrying `hints.docxNumbering` is read like any other line. §11 makes
 * Word's numbering a fact that bypasses these rules; that lands with the DOCX extractor (S7), with
 * its fixture, because no producer sets the hint before then.
 */

/** Bumped when the stage's output changes on purpose (the debug artifact records it). */
export const ENUMERATE_STAGE_VERSION = 1;

/** MAX_ARABIC (§2): a first component above this is not a list number (V4). */
export const MAX_ARABIC = 199;

const UNREAD: ReadonlySet<BlockRole> = new Set(['page-furniture', 'footnote', 'table']);

/** A line with what the rules ask about it, in reading order. */
interface Line {
  readonly ir: IrLine;
  readonly block: IrBlock;
  /** The lines of its block, in order, and its position among them (P3, P4, J1). */
  readonly siblings: readonly Line[];
  readonly indexInBlock: number;
  /** Its position in the document's reading order. */
  readonly order: number;
  /** §2: `w`, the width of the line's column region, and where that region starts. */
  readonly width: number;
  readonly columnX0: number;
  /** §2: `relX(L) = L.box.x0 − column.x0`. */
  readonly relX: number;
}

interface Run {
  readonly id: string;
  readonly family: Family;
  readonly style: Style;
  readonly relX: number;
  level: number;
  parent: WorkItem | null;
  readonly firstPath: readonly number[];
  lastPath: readonly number[];
  readonly items: WorkItem[];
  readonly flags: Set<Flag>;
}

interface WorkItem {
  readonly id: string;
  readonly line: Line;
  readonly run: Run;
  readonly marker: Marker;
  readonly lineIds: string[];
  readonly detailLineIds: string[];
  level: number;
  parent: WorkItem | null;
  label: string;
  /** `textX(item)`: relX of the first label word on the marker line, or of the P4 label line. */
  readonly textX: number;
  readonly flags: Set<Flag>;
}

/** What a read line belongs to, for P3 (a wrapped line joins whatever its predecessor is part of). */
type Owner =
  | { readonly kind: 'label'; readonly item: WorkItem }
  | { readonly kind: 'detail'; readonly item: WorkItem }
  | { readonly kind: 'prose' };

/** How §7 handled a line that is not a marker. */
interface NonMarker {
  readonly rule: 'R6a' | 'V7' | 'J1' | 'R6b';
  readonly verdict: 'prose' | 'detail';
  readonly evidence: Evidence;
}

/** §2 `SAME_BAND`: two relX values within 2% of the column width. */
const sameBand = (a: number, b: number, width: number) => Math.abs(a - b) * 50 <= width;

/** §2 `WRAPPED`: the line reaches 90% of its column: the layout wrapped it. */
const wrapped = (line: Line) => (line.ir.box.x1 - line.columnX0) * 10 >= line.width * 9;

const samePath = (a: readonly number[], b: readonly number[]) =>
  a.length === b.length && a.every((value, i) => value === b[i]);

const pathText = (path: readonly number[]) => path.join('.');

/** §6 `isFirst(reading, parent)`. */
function isFirst(reading: Reading, parent: WorkItem | null): boolean {
  if (reading.family === 'bullet' || samePath(reading.path, [1])) return true;
  return (
    reading.family === 'arabic' &&
    parent?.marker.family === 'arabic' &&
    samePath(reading.path, [...parent.marker.path, 1])
  );
}

/** §6 `expectedNext(r)`. */
function expectedNext(run: Run): number[][] {
  const p = run.lastPath;
  if (run.family === 'bullet') return [[]];
  if (run.family !== 'arabic') return [[(p[0] ?? 0) + 1]];
  const next = p.map((value, depth) => [...p.slice(0, depth), value + 1]);
  if (p.length < 4) next.push([...p, 1]);
  return next;
}

function readingOrder(doc: LayoutDocument): Line[] {
  const lines: Line[] = [];
  for (const page of doc.pages) {
    for (const block of page.blocks) {
      const column: IrColumn | undefined = page.columns[block.columnIndex];
      if (!column) throw new IrError([`${block.id}: no column ${block.columnIndex}`]);
      const siblings: Line[] = [];
      block.lines.forEach((ir, indexInBlock) => {
        const line: Line = {
          ir,
          block,
          siblings,
          indexInBlock,
          order: lines.length,
          width: column.x1 - column.x0,
          columnX0: column.x0,
          relX: ir.box.x0 - column.x0,
        };
        siblings.push(line);
        lines.push(line);
      });
    }
  }
  return lines;
}

export function enumerate(doc: LayoutDocument): StageResult<EnumerateResult> {
  const lines = readingOrder(doc);
  const byId = new Map(lines.map((line) => [line.ir.id, line]));

  /** S: the open runs, outermost first. */
  const stack: Run[] = [];
  const runs: Run[] = [];
  const placed: WorkItem[] = [];
  const rejected: Rejected[] = [];
  const skipped: string[] = [];
  const owners = new Map<string, Owner>();
  const consumed = new Set<string>();
  const decisions: Decision[] = [];
  let openItem: WorkItem | null = null;

  const decide = (
    subject: string,
    rule: string,
    verdict: string,
    evidence: Evidence,
    also: string[] = [],
  ) => {
    decisions.push({
      id: `enumerate:${subject}`,
      rule,
      subject: [subject, ...also],
      verdict,
      evidence,
    });
  };

  const ownerOf = (line: Line): Owner => {
    const owner = owners.get(line.ir.id);
    if (!owner) throw new Error(`enumerate: ${line.ir.id} was read before it was placed`);
    return owner;
  };

  /** Close every open run the predicate picks; returns how many closed. */
  const close = (shouldClose: (run: Run) => boolean): number => {
    const before = stack.length;
    const kept = stack.filter((run) => !shouldClose(run));
    stack.splice(0, stack.length, ...kept);
    return before - kept.length;
  };
  const closeDeeperThan = (run: Run) => {
    stack.splice(stack.indexOf(run) + 1);
  };

  // ------------------------------------------------------------------ §5 vetoes
  const vetoOf = (line: Line, match: MarkerMatch): RejectRule | null => {
    const reading = match.preferred; // a match with two readings is a letter, never arabic
    const arabic = reading.family === 'arabic';
    const F = line.ir.words[match.wordCount];
    const f = F ? gazetteerForm(F.text) : null;
    if (match.production === 'M4' && F && /^\p{Ll}/u.test(F.text)) return 'V1';
    if (arabic && f !== null && isUnitWord(f)) return 'V2';
    const dot = reading.style === 'dot' || reading.style === 'spaced-dot';
    if (arabic && dot && f !== null && isMonth(f)) return 'V3';
    if (arabic && (reading.path[0] ?? 0) > MAX_ARABIC) return 'V4';
    if (reading.style === 'spaced-dash' && F && /^\p{Nd}/u.test(F.text)) return 'V5';
    return null;
  };

  // ------------------------------------------------------------------ §6 runs
  /** R1: the innermost open run at this band that one of the readings continues. */
  const continuing = (match: MarkerMatch, line: Line): { run: Run; reading: Reading } | null => {
    for (let i = stack.length - 1; i >= 0; i -= 1) {
      const run = stack[i];
      if (!run || !sameBand(run.relX, line.relX, line.width)) continue;
      const expected = expectedNext(run);
      const reading = match.readings.find(
        (r) => r.family === run.family && expected.some((path) => samePath(path, r.path)),
      );
      if (reading) return { run, reading };
    }
    return null;
  };

  /** APPEND(r, L, reading). `labelLine` is the P4 label line, when the marker is the whole line. */
  const append = (
    run: Run,
    line: Line,
    match: MarkerMatch,
    reading: Reading,
    labelLine: Line | null,
    itemFlags: readonly Flag[] = [],
  ): WorkItem => {
    if (reading.family === run.family && reading.style !== run.style) {
      run.flags.add('style-inconsistent');
    }
    run.lastPath = reading.path;
    const arabic = reading.family === 'arabic';
    const prefix = reading.path.slice(0, -1);
    const inRunParent =
      arabic && reading.path.length >= 2
        ? run.items.findLast(
            (it) => it.marker.family === 'arabic' && samePath(it.marker.path, prefix),
          )
        : undefined;

    const words = line.ir.words;
    const firstLabelWord = words[match.wordCount];
    const lineIds = [line.ir.id];
    let label: string;
    let textX: number;
    if (firstLabelWord) {
      label = line.ir.text.slice(firstLabelWord.start);
      textX = firstLabelWord.box.x0 - line.columnX0;
    } else if (labelLine) {
      label = labelLine.ir.text;
      textX = labelLine.relX;
      lineIds.push(labelLine.ir.id);
      consumed.add(labelLine.ir.id);
    } else {
      throw new Error(`enumerate: ${line.ir.id} has a marker and no label`);
    }

    const item: WorkItem = {
      id: `i-${line.ir.id}`,
      line,
      run,
      marker: {
        raw: match.raw,
        family: reading.family,
        style: reading.style,
        path: [...reading.path],
        wordCount: match.wordCount,
      },
      lineIds,
      detailLineIds: [],
      level: arabic
        ? run.level + Math.max(0, reading.path.length - run.firstPath.length)
        : run.level,
      parent: inRunParent ?? run.parent,
      label,
      textX,
      flags: new Set(itemFlags),
    };
    run.items.push(item);
    placed.push(item);
    for (const id of lineIds) owners.set(id, { kind: 'label', item });
    return item;
  };

  /** Open a run whose first item is this line. */
  const startRun = (
    level: number,
    parent: WorkItem | null,
    runFlags: readonly Flag[],
    line: Line,
    match: MarkerMatch,
    reading: Reading,
    labelLine: Line | null,
    itemFlags: readonly Flag[] = [],
  ): WorkItem => {
    const run: Run = {
      id: `r-${line.ir.id}`,
      family: reading.family,
      style: reading.style,
      relX: line.relX,
      level,
      parent,
      firstPath: reading.path,
      lastPath: reading.path,
      items: [],
      flags: new Set(runFlags),
    };
    stack.push(run);
    runs.push(run);
    return append(run, line, match, reading, labelLine, itemFlags);
  };

  /** PLACE(L, m): which run the marker joins or opens, and the rule that said so. */
  const place = (
    line: Line,
    match: MarkerMatch,
    labelLine: Line | null,
  ): { item: WorkItem; rule: string; evidence: Evidence } => {
    // R1 — continue a run.
    const next = continuing(match, line);
    if (next) {
      closeDeeperThan(next.run);
      return {
        item: append(next.run, line, match, next.reading, labelLine),
        rule: 'R1',
        evidence: {},
      };
    }

    // R5a, R5b, R7, R4 — a run at this band that the marker does not simply continue.
    const reading = match.preferred;
    const atBand = stack.findLast((run) => sameBand(run.relX, line.relX, line.width));
    if (atBand) {
      closeDeeperThan(atBand);
      const last = atBand.items.at(-1) ?? null;
      if (reading.family !== atBand.family) {
        if (isFirst(reading, last)) {
          const item = startRun(atBand.level + 1, last, [], line, match, reading, labelLine);
          return { item, rule: 'R5a', evidence: {} };
        }
        atBand.flags.add('scheme-inconsistent');
        return { item: append(atBand, line, match, reading, labelLine), rule: 'R5b', evidence: {} };
      }
      if (isFirst(reading, atBand.parent)) {
        stack.pop();
        const flags: Flag[] = ['restart-without-boundary'];
        const item = startRun(atBand.level, atBand.parent, flags, line, match, reading, labelLine);
        return { item, rule: 'R7', evidence: {} };
      }
      atBand.flags.add('sequence-jump');
      return { item: append(atBand, line, match, reading, labelLine), rule: 'R4', evidence: {} };
    }

    // R3 — an indent to the left closes what is to its right.
    const closed = close((run) => (run.relX - line.relX) * 50 > line.width);
    // R2 — an indent to the right nests.
    const inner = stack.at(-1);
    let parent = inner?.items.at(-1) ?? null;
    let level = inner ? inner.level + 1 : 1;
    const runFlags: Flag[] = [];
    const itemFlags: Flag[] = [];
    let rule = 'R2';
    const evidence: Evidence = { closed };
    if (!isFirst(reading, parent)) {
      if (reading.family === 'arabic' && reading.path.length >= 2) {
        // R9 — a dotted sub-number finds its parent.
        rule = 'R9';
        const prefix = reading.path.slice(0, -1);
        const found = placed.findLast(
          (it) => it.marker.family === 'arabic' && samePath(it.marker.path, prefix),
        );
        evidence.found = found?.id ?? '';
        if (found && parent === null) {
          parent = found;
          level = found.level + 1;
        }
        if (!found) itemFlags.push('orphan-subnumber');
      } else {
        runFlags.push('starts-mid-sequence');
      }
    }
    const item = startRun(level, parent, runFlags, line, match, reading, labelLine, itemFlags);
    return { item, rule, evidence };
  };

  // ------------------------------------------------------------------ §3 P3
  /** P3: a soft-wrapped line continues whatever its predecessor belongs to. */
  const continuation = (line: Line): boolean => {
    if (line.ir.source !== 'text-layer' && line.ir.source !== 'ocr') return false;
    const previous = line.siblings[line.indexInBlock - 1];
    if (!previous || !wrapped(previous)) return false;
    const owner = ownerOf(previous);

    let rule: 'P3a' | 'P3b';
    let evidence: Evidence;
    if (owner.kind === 'label' && sameBand(line.relX, owner.item.textX, line.width)) {
      rule = 'P3a';
      evidence = { relX: line.relX, textX: owner.item.textX, width: line.width };
    } else if (line.relX * 50 <= previous.relX * 50 + line.width) {
      const match = grammar(line.ir.words);
      if (match && !vetoOf(line, match) && continuing(match, line)) return false;
      rule = 'P3b';
      evidence = { relX: line.relX, previousRelX: previous.relX, width: line.width };
    } else {
      return false;
    }

    const id = line.ir.id;
    owners.set(id, owner);
    if (owner.kind === 'label') {
      owner.item.lineIds.push(id);
      owner.item.label += ` ${line.ir.text}`;
    } else if (owner.kind === 'detail') {
      owner.item.detailLineIds.push(id);
    }
    decide(id, rule, owner.kind, evidence, [previous.ir.id]);
    return true;
  };

  // ------------------------------------------------------------------ §7 non-markers
  const nonMarker = (line: Line): NonMarker => {
    const id = line.ir.id;
    // R6a — a heading resets every list.
    if (line.block.role === 'heading') {
      const closed = close(() => true);
      owners.set(id, { kind: 'prose' });
      openItem = null;
      return { rule: 'R6a', verdict: 'prose', evidence: { closed } };
    }
    // V7 — continuation notices change nothing.
    if (isContinuationNotice(line.ir.text)) {
      owners.set(id, { kind: 'prose' });
      openItem = null;
      return { rule: 'V7', verdict: 'prose', evidence: {} };
    }
    // J1 — a detail line under the open item, at its text indent.
    if (openItem) {
      const lastId = openItem.detailLineIds.at(-1) ?? openItem.lineIds.at(-1) ?? '';
      const last = byId.get(lastId);
      if (last?.block === line.block && sameBand(line.relX, openItem.textX, line.width)) {
        openItem.detailLineIds.push(id);
        owners.set(id, { kind: 'detail', item: openItem });
        const evidence = { relX: line.relX, textX: openItem.textX, width: line.width };
        return { rule: 'J1', verdict: 'detail', evidence: { ...evidence, item: openItem.id } };
      }
    }
    // R6b — anything else is prose, and an outdent closes lists.
    const closed = close((run) => (run.relX - line.relX) * 50 > line.width);
    owners.set(id, { kind: 'prose' });
    openItem = null;
    return {
      rule: 'R6b',
      verdict: 'prose',
      evidence: { relX: line.relX, width: line.width, closed },
    };
  };

  // ------------------------------------------------------------------ §3 the pass
  for (const line of lines) {
    const id = line.ir.id;
    if (UNREAD.has(line.block.role)) {
      skipped.push(id); // P2
      decide(id, 'P2', 'skipped', { role: line.block.role });
      continue;
    }
    if (consumed.has(id)) continue;
    if (continuation(line)) continue;

    const match = grammar(line.ir.words);
    if (!match) {
      const handled = nonMarker(line);
      decide(id, handled.rule, handled.verdict, handled.evidence);
      continue;
    }

    const next = line.siblings[line.indexInBlock + 1];
    const wholeLine = line.ir.words.length === match.wordCount;
    const labelLine = wholeLine && next && !grammar(next.ir.words) ? next : null;
    const rule = vetoOf(line, match) ?? (wholeLine && !labelLine ? 'P4' : null);
    if (rule) {
      rejected.push({ lineId: id, raw: match.raw, rule });
      const handled = nonMarker(line);
      const firstLabelWord = line.ir.words[match.wordCount]?.text;
      decide(id, rule, 'rejected', {
        production: match.production,
        raw: match.raw,
        ...(firstLabelWord === undefined ? {} : { next: firstLabelWord }),
        then: handled.rule,
      });
      continue;
    }

    const { item, rule: placedBy, evidence } = place(line, match, labelLine);
    openItem = item;
    decide(
      id,
      placedBy,
      'item',
      {
        production: match.production,
        raw: match.raw,
        family: item.marker.family,
        path: pathText(item.marker.path),
        relX: line.relX,
        width: line.width,
        run: item.run.id,
        level: item.level,
        ...evidence,
      },
      labelLine ? [labelLine.ir.id] : [],
    );
  }

  // ------------------------------------------------------------------ §8 verdicts
  const hasFieldEvidence = (item: WorkItem) =>
    [...item.lineIds, ...item.detailLineIds].some((lineId) => {
      const hints = byId.get(lineId)?.ir.hints;
      return !!hints && (hints.blankRun || hints.checkboxes > 0 || hints.ruleBelow);
    });
  const hasBandEvidence = (item: WorkItem) => {
    const { words, fontSize, indentBand } = item.line.ir;
    const markerEnd = words[item.marker.wordCount - 1];
    const textStart = words[item.marker.wordCount];
    // HANGING_GAP (§2): at least one em between the marker and its text — a tab, not a space.
    const hanging = !!markerEnd && !!textStart && textStart.box.x0 - markerEnd.box.x1 >= fontSize;
    return hanging || indentBand >= 1;
  };
  /** D3's "its path extends its parent's path": an arabic sub-item of an arabic item. */
  const extendsParent = (item: WorkItem) =>
    item.marker.family === 'arabic' &&
    item.parent?.marker.family === 'arabic' &&
    samePath(item.marker.path.slice(0, -1), item.parent.marker.path);

  const removed = new Set<WorkItem>();
  const verdicts = new Map<WorkItem, Pick<Item, 'verdict' | 'flags' | 'decidedBy'>>();
  runs.forEach((run, runIndex) => {
    const only = run.items.length === 1 ? run.items[0] : undefined;

    // D4 — a lone letter with nothing to fill in is a word.
    if (only && run.family.startsWith('alpha') && !hasFieldEvidence(only)) {
      removed.add(only);
      rejected.push({ lineId: only.line.ir.id, raw: only.marker.raw, rule: 'D4' });
      // Everything below it moves up one level; its direct children take its parent. A run's
      // parent is always in an earlier run, so one pass in creation order reaches every descendant.
      const lifted = new Set<WorkItem>([only]);
      let liftedRuns = 0;
      for (const later of runs.slice(runIndex + 1)) {
        if (!later.parent || !lifted.has(later.parent)) continue;
        liftedRuns += 1;
        if (later.parent === only) later.parent = only.parent;
        later.level -= 1;
        for (const item of later.items) {
          if (item.parent === only) item.parent = only.parent;
          item.level -= 1;
          lifted.add(item);
        }
      }
      decide(only.id, 'D4', 'inline-text', { run: run.id, field: false, lifted: liftedRuns });
      return;
    }

    for (const item of run.items) {
      const flags = new Set<Flag>([...item.flags, ...run.flags]);
      if (run.items.length >= 2 || extendsParent(item) || flags.has('orphan-subnumber')) {
        // D1 / D2 — a list of two or more (or a sub-item, or an orphan).
        const sorted = [...flags].sort();
        const verdict = sorted.length === 0 ? 'accept' : 'accept-flagged';
        const decidedBy = sorted.length === 0 ? 'D1' : 'D2';
        verdicts.set(item, { verdict, flags: sorted, decidedBy });
        decide(item.id, decidedBy, verdict, {
          run: run.id,
          runItems: run.items.length,
          flags: sorted.join(','),
        });
        continue;
      }
      // D3 — a list of one.
      const band = hasBandEvidence(item);
      const field = hasFieldEvidence(item);
      const accepted = band && field;
      if (!accepted) flags.add('single-item');
      const sorted = [...flags].sort();
      const verdict = !accepted ? 'candidate' : sorted.length === 0 ? 'accept' : 'accept-flagged';
      verdicts.set(item, { verdict, flags: sorted, decidedBy: 'D3' });
      decide(item.id, 'D3', verdict, { run: run.id, band, field, flags: sorted.join(',') });
    }
  });

  // ------------------------------------------------------------------ output
  const items: Item[] = placed
    .filter((item) => !removed.has(item))
    .sort((a, b) => a.line.order - b.line.order)
    .map((item) => {
      const verdict = verdicts.get(item);
      if (!verdict) throw new Error(`enumerate: ${item.id} has no verdict`);
      return {
        id: item.id,
        runId: item.run.id,
        lineIds: [...item.lineIds],
        detailLineIds: [...item.detailLineIds],
        marker: { ...item.marker, path: [...item.marker.path] },
        level: item.level,
        parentId: item.parent?.id ?? null,
        label: item.label,
        verdict: verdict.verdict,
        flags: verdict.flags,
        decidedBy: verdict.decidedBy,
      };
    });

  const inItems = new Set(items.flatMap((item) => [...item.lineIds, ...item.detailLineIds]));
  const skippedIds = new Set(skipped);
  const orderOf = (lineId: string) => byId.get(lineId)?.order ?? 0;

  return {
    output: {
      items,
      rejected: [...rejected].sort((a, b) => orderOf(a.lineId) - orderOf(b.lineId)),
      proseLineIds: lines
        .map((line) => line.ir.id)
        .filter((lineId) => !skippedIds.has(lineId) && !inItems.has(lineId)),
      skippedLineIds: skipped,
    },
    debug: {
      stage: 'enumerate',
      stageVersion: ENUMERATE_STAGE_VERSION,
      irVersion: 1,
      inputSha256: inputSha256(doc),
      decisions,
    },
  };
}
