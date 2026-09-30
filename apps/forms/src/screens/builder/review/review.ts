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
  /**
   * The document said whether it must be answered, either way. "Not required" and "said nothing"
   * both leave it optional, but only the first is decided: the walk asks the second (S12).
   */
  readonly requiredKnown: boolean;
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
  /** Each line's words, as printed and without its marker and answer space: for splitting. */
  readonly lines: ReadonlyMap<string, LineWords>;
}

export interface LineWords {
  /** As printed: text to read splits into these. */
  readonly raw: string;
  /** Less its list marker, its blanks and boxes, and a trailing colon: a label splits into these. */
  readonly spoken: string;
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

function linesOf(layout: LayoutDocument, reading: Reading): Map<string, LineWords> {
  const markers = new Map(reading.lists.items.map((item) => [item.lineIds[0]!, item.marker.raw]));
  return new Map(
    layout.pages.flatMap((page) =>
      page.blocks.flatMap((block) =>
        block.lines.map((line) => [
          line.id,
          { raw: line.text, spoken: spokenText(line.text, markers.get(line.id) ?? null) },
        ]),
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
    requiredKnown: classification !== undefined && classification.required !== 'unknown',
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
        requiredKnown: false,
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
        requiredKnown: false,
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
  // The field says what answers it; the text it sits on still says what is printed: the options
  // beside a radio button, the notes under it, and whether it must be answered (#26).
  const fieldItem = (field: (typeof fields)[number]): ReviewItem => {
    const printed = field.covers.map((index) => segments[index]).filter((s) => s !== undefined);
    const questions = printed.filter((segment) => segment.kind === 'question');
    return {
      id: `field:${field.name}`,
      kind: 'question',
      lineIds: printed.flatMap((segment) => segment.lineIds),
      text: field.label ?? '',
      options: questions.flatMap((segment) => segment.options),
      details: questions.flatMap((segment) => segment.details),
      rows: [],
      columns: [],
      rowCount: 0,
      type: field.kind,
      alternatives: [],
      required: field.covers.some((index) => classified.get(index)?.required === 'yes'),
      requiredKnown: field.covers.some(
        (index) => (classified.get(index)?.required ?? 'unknown') !== 'unknown',
      ),
      bucket: field.bucket,
      decided: false,
      field: true,
    };
  };

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
const unique = (ids: readonly string[]) => [...new Set(ids)];
const sameWords = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((word, i) => word === b[i]);

/** Every word an item holds besides its own text: what its label does not say. */
function extras(item: ReviewItem): string[] {
  return [...item.columns, ...item.options, ...item.rows, ...item.details].filter((w) => w !== '');
}

/** Text to read made of a question: its label, then its columns, options, rows and notes. */
function asText(item: ReviewItem): string {
  return [item.text, ...extras(item)].filter((line) => line !== '').join('\n');
}

/** Types that are nothing without the options, rows or columns a split leaves behind. */
const STRUCTURED: ReadonlySet<Kind> = new Set([
  'single_select',
  'multi_select',
  'grid',
  'repeating_group',
]);

/** The chips for a question whose type is `type`: it first, then the unsure three. */
function chipsFor(type: Kind): Kind[] {
  return [type, ...UNSURE.filter((kind) => kind !== type)].slice(0, 3);
}

/**
 * Two items as one: `item` into `before`. No word of either is lost.
 *
 * - A note under a question (text after it) stays its note.
 * - Text before a question (a label printed on two lines) begins its label.
 * - Two questions are one, with both labels, options and notes.
 * - A question with a grid or a table is the grid or table, labelled by both; a grid or table
 *   continued is one, when their columns are the same. Whatever the result has no place for — a
 *   question's options beside a table, say — is kept as its notes.
 * - Anything else is one text, or one heading, as `before` was.
 */
function merged(before: ReviewItem, item: ReviewItem): ReviewItem {
  const lineIds = unique([...before.lineIds, ...item.lineIds]);
  const settled = { id: before.id, lineIds, decided: true } as const;
  if (!asks(before) && !asks(item)) {
    return { ...before, ...settled, text: join(before.text, item.text) };
  }
  if (asks(before) && !asks(item)) {
    return { ...before, ...settled, details: [...before.details, asText(item)] };
  }
  if (!asks(before)) {
    return { ...item, ...settled, text: join(before.text.replace(/\n/g, ' '), item.text) };
  }
  const text = join(before.text, item.text);
  const required = before.required || item.required;
  const requiredKnown = before.requiredKnown || item.requiredKnown;
  if (before.kind === 'question' && item.kind === 'question') {
    // A label, then its choices on the next line: the type is the choices'.
    const typed = before.options.length === 0 && item.options.length > 0 ? item : before;
    return {
      ...before,
      ...settled,
      text,
      required,
      requiredKnown,
      type: typed.type,
      alternatives: typed.alternatives,
      options: [...before.options, ...item.options],
      details: [...before.details, ...item.details],
    };
  }
  const structured = (x: ReviewItem) => x.kind === 'grid' || x.kind === 'table';
  const host = structured(item) && !structured(before) ? item : before;
  const other = host === item ? before : item;
  if (host.kind === other.kind && sameWords(host.columns, other.columns)) {
    // One grid, or one table, printed in two parts.
    return {
      ...host,
      ...settled,
      text,
      required,
      requiredKnown,
      rows: [...before.rows, ...item.rows],
      rowCount: before.rowCount + item.rowCount,
      details: [...before.details, ...item.details],
    };
  }
  return {
    ...host,
    ...settled,
    text,
    required,
    requiredKnown,
    details: [...host.details, ...extras(other)],
  };
}

function apply(
  items: readonly ReviewItem[],
  lines: ReadonlyMap<string, LineWords>,
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
        requiredKnown: false,
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
      return [...items.slice(0, at - 1), merged(before, item), ...items.slice(at + 1)];
    }
    case 'split': {
      if (item.field) return 'form-field';
      const cut = action.at;
      if (item.lineIds.length < 2 || cut < 1 || cut >= item.lineIds.length) return 'one-line';
      const head = item.lineIds.slice(0, cut);
      const tail = item.lineIds.slice(cut);
      // Each part is the words of its own lines, as printed: nothing is in both, nothing is lost.
      // A question's parts are questions labelled by their lines; what answers each is asked again.
      const words = (ids: readonly string[], as: keyof LineWords) =>
        ids
          .map((id) => lines.get(id)?.[as] ?? '')
          .filter((text) => text !== '')
          .join(' ');
      const part = (id: string, ids: readonly string[], first: boolean): ReviewItem => {
        if (!asks(item)) {
          return {
            ...item,
            id,
            lineIds: ids,
            text: words(ids, item.kind === 'text' ? 'raw' : 'spoken'),
            decided: true,
          };
        }
        const type = item.type && !STRUCTURED.has(item.type) ? item.type : 'short_text';
        return {
          ...item,
          id,
          kind: 'question',
          lineIds: ids,
          text: words(ids, 'spoken'),
          options: [],
          details: [],
          rows: [],
          columns: [],
          rowCount: 0,
          type,
          alternatives: chipsFor(type),
          required: first && item.required,
          requiredKnown: first && item.requiredKnown,
          decided: true,
        };
      };
      return replaced(part(item.id, head, true), part(`${item.id}/${cut}`, tail, false));
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
  /** The questions the form would get: "I read 14 questions." (`questionsIn`) */
  readonly questions: number;
  /** Anything read with too little confidence, not yet settled: "3 need your eye." */
  readonly needEye: number;
  /** "Check this": sure enough to be accepted by default, with chips. Not yet settled. */
  readonly check: number;
  /** Headings and text to read that come with the questions. */
  readonly texts: number;
}

/**
 * How many questions an item becomes in the form: a grid of two or more columns is a question per
 * row; anything else that asks is one. What "Add 14 questions" and the conversation's step count.
 */
export function questionsIn(item: ReviewItem): number {
  if (!asks(item)) return 0;
  return item.kind === 'grid' && item.columns.length > 1 ? item.rows.length : 1;
}

export function counts(items: readonly ReviewItem[]): Counts {
  const open = (bucket: Bucket) => items.filter((i) => i.bucket === bucket && !i.decided).length;
  return {
    questions: items.reduce((sum, item) => sum + questionsIn(item), 0),
    needEye: open('review'),
    check: open('flag'),
    texts: items.filter((item) => !asks(item)).length,
  };
}

/**
 * "Use these questions" is pressed only when nothing still needs the person's eye: below the
 * threshold Loppa asks, it never guesses (`CLAUDE.md`, non-negotiable 3). A question with no label
 * is not held back — it says so on the screen, and the editor asks for one before publishing.
 */
export function readyToUse(items: readonly ReviewItem[]): boolean {
  return items.length > 0 && counts(items).needEye === 0;
}

/**
 * The item a line was read into: the source pane's half of the highlight. A line read as two
 * questions (two blanks on it, `split-line`) is in both; pressing it selects the first.
 */
export function itemOfLine(items: readonly ReviewItem[], lineId: string): ReviewItem | null {
  return items.find((item) => item.lineIds.includes(lineId)) ?? null;
}

/**
 * What is selected after `before` became `after`: the same item if it is still there; else the one
 * its first line is now in (merged into, or put back together by Undo); else the one in its place.
 */
export function follow(
  before: readonly ReviewItem[],
  after: readonly ReviewItem[],
  selectedId: string | null,
): string | null {
  if (after.some((item) => item.id === selectedId)) return selectedId;
  const was = before.findIndex((item) => item.id === selectedId);
  const line = before[was]?.lineIds[0];
  const holder = line === undefined ? null : itemOfLine(after, line);
  if (holder) return holder.id;
  return after[Math.min(Math.max(was, 0), after.length - 1)]?.id ?? null;
}
