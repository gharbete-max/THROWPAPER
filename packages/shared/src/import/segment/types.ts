/**
 * What stage 4 produces — `docs/plan/IMPORT-PIPELINE.md` §4, which is the contract.
 *
 * Every line a reader reads is in exactly one segment, in reading order of its first line; page
 * furniture is in none. The one exception is a line with two label-and-blank pairs on it, which is
 * in each of the questions split from it (flag `split-line`).
 */

/** What answers a question on the page: a blank to write in, boxes with words, a yes/no pair. */
export type Answer = 'blank' | 'choice' | 'boolean' | 'unknown';

export type SegmentFlag =
  /** A grid whose label is a question earlier in its section that points at "the table below". */
  | 'label-by-reference'
  /** More than 30 options: this looks like a table, or two questions (`CAVEATS.md` #30). */
  | 'many-options'
  /** The same label as an earlier question. Never merged: the review screen asks (#25). */
  | 'same-as-earlier'
  /** One of two or more questions read from one line, each with its own blank. */
  | 'split-line';

export interface HeadingSegment {
  kind: 'heading';
  lineIds: string[];
  /** Verbatim; a numbered section's label, without its marker. */
  text: string;
}

export interface InstructionSegment {
  kind: 'instruction';
  lineIds: string[];
  /** Verbatim: the lines of a paragraph joined by one space. */
  text: string;
}

export interface MetaSegment {
  kind: 'meta';
  lineIds: string[];
  text: string;
}

export interface QuestionSegment {
  kind: 'question';
  lineIds: string[];
  /** Verbatim, without its marker, its blank runs and one trailing colon. */
  label: string;
  /** The stage 3 item the question is, when it is one. */
  itemId: string | null;
  answer: Answer;
  /** Verbatim, in order. Empty unless `answer` is `choice` or `boolean`. */
  options: string[];
  /** Lines under an item that belong to it without being it (J1): help text, a note. */
  details: string[];
  /** Sorted ascending, no duplicates. */
  flags: SegmentFlag[];
}

export interface GridSegment {
  kind: 'grid';
  lineIds: string[];
  label: string | null;
  itemId: string | null;
  /** Each row's words before its first checkbox, verbatim. */
  rows: string[];
  /** The header over each checkbox column, verbatim. */
  columns: string[];
  flags: SegmentFlag[];
}

export interface TableSegment {
  kind: 'table';
  lineIds: string[];
  label: string | null;
  itemId: string | null;
  columns: string[];
  rowCount: number;
  shape: 'repeating-rows' | 'labelled-fields';
  flags: SegmentFlag[];
}

export type Segment =
  HeadingSegment | InstructionSegment | MetaSegment | QuestionSegment | GridSegment | TableSegment;

export interface SegmentResult {
  /** In reading order of their first line. */
  segments: Segment[];
}
