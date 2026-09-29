import type { Bucket, Kind, LayoutDocument, Segment } from '@tp/shared/import';
import type { Reading } from '../paper/reading.js';

/**
 * The review screen's model — `docs/plan/IMPORT-PIPELINE.md` §8 — with nothing on screen, so every
 * rule here is a function a test can call (`review.test.ts`). The screen renders it; it never
 * decides.
 *
 * What the stages read becomes a list of **items** in the document's order: headings, text to read,
 * and questions with what answers them. The person settles the ones Loppa is not sure of — a chip
 * for the right type, merge with the item before, split one in two, "this is just text", "make this
 * a question", or simply accept — and nothing enters the form until "Use these questions".
 *
 * A review is where it started (`base`) and what the person did (`actions`); its `items` are always
 * `replay(base, actions)`, so Undo is dropping the last action, the same way the conversation's
 * Back is (`@tp/shared/builder`). The actions stay on this screen: the form changes once, when the
 * questions are used, as one step in the conversation's log (`importQuestions`), which Back undoes.
 * (`IMPORT-PIPELINE.md` §8 first had every review action in that log, before anything was in the
 * form; see its "as built".)
 */

/** What an item is on the screen. Meta lines (a form's number) are text to read. */
export type ItemKind = 'heading' | 'text' | 'question' | 'grid' | 'table';

export interface ReviewItem {
  /** Stable within a reading: the segment's subject ("p1-l3", "p1-l3#2"), or "field:" + a name. */
  readonly id: string;
  readonly kind: ItemKind;
  /** The document's lines it was read from, in order: the highlight, both ways. */
  readonly lineIds: readonly string[];
  /** Verbatim: a question's label, a grid's or table's (or ""), a heading's or text's words. */
  readonly text: string;
  /** A choice's options, verbatim. */
  readonly options: readonly string[];
  /** Notes printed under a question, verbatim. */
  readonly details: readonly string[];
  /** A grid's rows; empty otherwise. */
  readonly rows: readonly string[];
  /** A grid's or a table's columns. */
  readonly columns: readonly string[];
  /** A table's printed rows: how many entries its group may take. */
  readonly rowCount: number;
  /** What answers a question, grid or table; null for a heading or text. */
  readonly type: Kind | null;
  /** The chips: the types it may be, best first, at most three. Empty where there is no choice. */
  readonly alternatives: readonly Kind[];
  /** Must be answered: only when the document said so (#26); never assumed. */
  readonly required: boolean;
  /** How sure the reading is, as stage 7 put it. */
  readonly bucket: Bucket;
  /** The person settled it: a chip, Accept, merge, split, or what kind it is. */
  readonly decided: boolean;
  /** A PDF's own form field (#54): its type is the field's, never a guess, and it is not merged. */
  readonly field: boolean;
}

export type Action =
  /** One of the chips: the question is this type. */
  | { readonly kind: 'pick'; readonly itemId: string; readonly type: Kind }
  /** It is right as it is. */
  | { readonly kind: 'accept'; readonly itemId: string }
  /** Into the item before it: one question read as two, or a note that belongs to a question. */
  | { readonly kind: 'merge'; readonly itemId: string }
  /** Two items from one: the lines from `at` (1-based within the item) start the second. */
  | { readonly kind: 'split'; readonly itemId: string; readonly at: number }
  /** "This is just text": a question that is not one. */
  | { readonly kind: 'text'; readonly itemId: string }
  /** "Make this a question": text that is one. */
  | { readonly kind: 'question'; readonly itemId: string };

export interface Review {
  readonly base: readonly ReviewItem[];
  readonly actions: readonly Action[];
  readonly items: readonly ReviewItem[];
  /** Each line's words without their answer space, for splitting. */
  readonly lines: ReadonlyMap<string, string>;
}

/** Types a question may be when nothing says which: the classifier's own order for no evidence. */
const UNSURE: readonly Kind[] = ['short_text', 'long_text', 'number'];

const ASKS: ReadonlySet<ItemKind> = new Set(['question', 'grid', 'table']);
export const asks = (item: ReviewItem): boolean => ASKS.has(item.kind);

/** A line's words, less its list marker and its answer space: blanks, leaders and boxes. */
function spokenText(text: string, marker: string | null): string {
  const unmarked = marker && text.startsWith(marker) ? text.slice(marker.length) : text;
  return unmarked
    .split(' ')
    .filter((word) => !/^(?:_{3,}|\.{4,}|…+|[☐☑☒□■▢✓✔✗✘])$/u.test(word))
    .join(' ')
    .replace(/:\s*$/u, '')
    .trim();
}

function linesOf(layout: LayoutDocument, reading: Reading): Map<string, string> {
  const markers = new Map(reading.lists.items.map((item) => [item.lineIds[0]!, item.marker.raw]));
  return new Map(
    layout.pages.flatMap((page) =>
      page.blocks.flatMap((block) =>
        block.lines.map((line) => [line.id, spokenText(line.text, markers.get(line.id) ?? null)]),
      ),
    ),
  );
}

function itemOf(
  segment: Segment,
  id: string,
  bucket: Bucket,
  classification: Reading['classified']['classified'][number] | undefined,
): ReviewItem {
  const common = {
    id,
    lineIds: segment.lineIds,
    options: [] as string[],
    details: [] as string[],
    rows: [] as string[],
    columns: [] as string[],
    rowCount: 0,
    bucket,
    decided: false,
    field: false,
  };
  const sure = bucket === 'auto';
  const typed = {
    type: classification?.kind ?? 'short_text',
    alternatives: sure ? [] : (classification?.alternatives ?? UNSURE),
    required: classification?.required === 'yes',
  };
  switch (segment.kind) {
    case 'heading':
      return {
        ...common,
        kind: 'heading',
        text: segment.text,
        type: null,
        alternatives: [],
        required: false,
      };
    case 'instruction':
    case 'meta':
      return {
        ...common,
        kind: 'text',
        text: segment.text,
        type: null,
        alternatives: [],
        required: false,
      };
    case 'question':
      return {
        ...common,
        ...typed,
        kind: 'question',
        text: segment.label,
        options: segment.options,
        details: segment.details,
      };
    case 'grid':
      return {
        ...common,
        ...typed,
        kind: 'grid',
        text: segment.label ?? '',
        rows: segment.rows,
        columns: segment.columns,
      };
    case 'table':
      return {
        ...common,
        ...typed,
        kind: 'table',
        text: segment.label ?? '',
        columns: segment.columns,
        rowCount: segment.rowCount,
      };
  }
}

/**
 * The items a reading comes to, in the document's order. A PDF's own form fields replace the
 * questions read from the text they sit on (#54), at the first one's place; a field with no text
 * beside it comes at the end.
 */
export function itemsOf(reading: Reading): ReviewItem[] {
  const { segments } = reading.segments;
  const scored = new Map(reading.scored.scored.map((s) => [s.segmentIndex, s]));
  const classified = new Map(reading.classified.classified.map((c) => [c.segmentIndex, c]));
  const fields = reading.fields?.fields ?? [];
  const covering = new Map<number, (typeof fields)[number]>();
  const covered = new Set<number>();
  for (const field of fields) {
    field.covers.forEach((index, n) => {
      covered.add(index);
      if (n === 0) covering.set(index, field);
    });
  }
  const fieldItem = (field: (typeof fields)[number]): ReviewItem => ({
    id: `field:${field.name}`,
    kind: 'question',
    lineIds: field.covers.flatMap((index) => segments[index]?.lineIds ?? []),
    text: field.label ?? '',
    options: [],
    details: [],
    rows: [],
    columns: [],
    rowCount: 0,
    type: field.kind,
    alternatives: [],
    required: false,
    bucket: field.bucket,
    decided: false,
    field: true,
  });

  const items: ReviewItem[] = [];
  segments.forEach((segment, index) => {
    const field = covering.get(index);
    if (field) items.push(fieldItem(field));
    if (covered.has(index)) return;
    const s = scored.get(index);
    items.push(
      itemOf(segment, s?.subject ?? `s${index}`, s?.bucket ?? 'review', classified.get(index)),
    );
  });
  for (const field of fields) if (field.covers.length === 0) items.push(fieldItem(field));
  return items;
}

/** A review of a reading, before the person has done anything. */
export function startReview(reading: Reading): Review {
  const base = itemsOf(reading);
  return { base, actions: [], items: base, lines: linesOf(reading.layout, reading) };
}

// --- The actions -----------------------------------------------------------------------------

/** Why an action cannot be taken on this item now; null when it can. */
export type Refusal = 'no-item' | 'first' | 'form-field' | 'one-line' | 'not-a-chip' | 'already';

const join = (a: string, b: string) => (a === '' ? b : b === '' ? a : `${a} ${b}`);

/** Text to read made of a question: its label, options and notes, each on its own line. */
function asText(item: ReviewItem): string {
  return [item.text, ...item.options, ...item.rows, ...item.details]
    .filter((line) => line !== '')
    .join('\n');
}

function apply(
  items: readonly ReviewItem[],
  lines: ReadonlyMap<string, string>,
  action: Action,
): ReviewItem[] | Refusal {
  const at = items.findIndex((item) => item.id === action.itemId);
  if (at === -1) return 'no-item';
  const item = items[at]!;
  const replaced = (...next: ReviewItem[]) => [
    ...items.slice(0, at),
    ...next,
    ...items.slice(at + 1),
  ];

  switch (action.kind) {
    case 'accept':
      return item.decided ? 'already' : replaced({ ...item, decided: true });
    case 'pick':
      if (!item.alternatives.includes(action.type)) return 'not-a-chip';
      return replaced({ ...item, type: action.type, decided: true });
    case 'text':
      if (item.field) return 'form-field';
      if (!asks(item)) return 'already';
      return replaced({
        ...item,
        kind: 'text',
        text: asText(item),
        options: [],
        details: [],
        rows: [],
        columns: [],
        rowCount: 0,
        type: null,
        alternatives: [],
        required: false,
        decided: true,
      });
    case 'question':
      if (asks(item)) return 'already';
      return replaced({
        ...item,
        kind: 'question',
        type: 'short_text',
        alternatives: UNSURE,
        decided: true,
      });
    case 'merge': {
      if (at === 0) return 'first';
      const before = items[at - 1]!;
      if (item.field || before.field) return 'form-field';
      const lineIds = [...before.lineIds, ...item.lineIds];
      // A note under a question stays its note; anything else is one text, or one question.
      const merged: ReviewItem =
        asks(before) && !asks(item)
          ? { ...before, lineIds, details: [...before.details, asText(item)], decided: true }
          : {
              ...before,
              lineIds,
              text: join(before.text, item.text),
              options: [...before.options, ...item.options],
              details: [...before.details, ...item.details],
              rows: [...before.rows, ...item.rows],
              columns: before.columns.length > 0 ? before.columns : item.columns,
              decided: true,
            };
      return [...items.slice(0, at - 1), merged, ...items.slice(at + 1)];
    }
    case 'split': {
      if (item.field) return 'form-field';
      const cut = action.at;
      if (item.lineIds.length < 2 || cut < 1 || cut >= item.lineIds.length) return 'one-line';
      const words = (ids: readonly string[]) =>
        ids
          .map((id) => lines.get(id) ?? '')
          .filter((text) => text !== '')
          .join(' ');
      const head = item.lineIds.slice(0, cut);
      const tail = item.lineIds.slice(cut);
      return replaced(
        { ...item, lineIds: head, text: words(head), decided: true },
        {
          ...item,
          id: `${item.id}/${cut}`,
          lineIds: tail,
          text: words(tail),
          options: [],
          details: [],
          rows: [],
          decided: true,
        },
      );
    }
  }
}

/** Whether `action` can be taken: null when it can, else why not. */
export function refusal(review: Review, action: Action): Refusal | null {
  const next = apply(review.items, review.lines, action);
  return Array.isArray(next) ? null : next;
}

/** The review after one more action; an action that cannot be taken changes nothing. */
export function act(review: Review, action: Action): Review {
  const next = apply(review.items, review.lines, action);
  if (!Array.isArray(next)) return review;
  return { ...review, actions: [...review.actions, action], items: next };
}

/** The items after these actions, from the start: what Undo returns to. */
export function replay(review: Review, actions: readonly Action[]): Review {
  let here: Review = { ...review, actions: [], items: review.base };
  for (const action of actions) here = act(here, action);
  return here;
}

/** The last action undone; nothing to undo is not an error. */
export function undo(review: Review): Review {
  return review.actions.length === 0 ? review : replay(review, review.actions.slice(0, -1));
}

// --- What the screen says ------------------------------------------------------------------

export interface Counts {
  /** Questions, grids and tables: "I read 14 questions." */
  readonly questions: number;
  /** Anything read with too little confidence, not yet settled: "3 need your eye." */
  readonly needEye: number;
  /** "Check this": sure enough to be accepted by default, with chips. Not yet settled. */
  readonly check: number;
  /** Headings and text to read that come with the questions. */
  readonly texts: number;
}

export function counts(items: readonly ReviewItem[]): Counts {
  const open = (bucket: Bucket) => items.filter((i) => i.bucket === bucket && !i.decided).length;
  return {
    questions: items.filter(asks).length,
    needEye: open('review'),
    check: open('flag'),
    texts: items.filter((item) => !asks(item)).length,
  };
}

/**
 * "Use these questions" is pressed only when nothing still needs the person's eye: below the
 * threshold Loppa asks, it never guesses (`CLAUDE.md`, non-negotiable 3). A question the form
 * would take without a label is one of those.
 */
export function readyToUse(items: readonly ReviewItem[]): boolean {
  return items.length > 0 && counts(items).needEye === 0;
}

/** The item a line was read into: the source pane's half of the highlight. */
export function itemOfLine(items: readonly ReviewItem[], lineId: string): ReviewItem | null {
  return items.find((item) => item.lineIds.includes(lineId)) ?? null;
}
