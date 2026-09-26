/**
 * What stage 3 produces — `docs/plan/NUMBERING-RULES.md` §1, which is the contract.
 */

export type Family =
  'arabic' | 'roman-lower' | 'roman-upper' | 'alpha-lower' | 'alpha-upper' | 'bullet';
export type Style = 'dot' | 'paren' | 'colon' | 'enclosed' | 'spaced-dot' | 'spaced-dash' | 'glyph';
export type Verdict = 'accept' | 'accept-flagged' | 'candidate' | 'inline-text';
export type Flag =
  | 'orphan-subnumber'
  | 'restart-without-boundary'
  | 'scheme-inconsistent'
  | 'sequence-jump'
  | 'single-item'
  | 'starts-mid-sequence'
  | 'style-inconsistent';

export interface Marker {
  /** Verbatim: the first word's text, or the first two words joined by one space (spaced styles). */
  raw: string;
  family: Family;
  style: Style;
  /** "12.1" → [12, 1]; "iv." → [4]; "c)" → [3]; a bullet → []. */
  path: number[];
  /** How many words at the start of the line the marker occupies: 2 for spaced styles, else 1. */
  wordCount: 1 | 2;
}

export interface Item {
  /** "i-" + the id of the item's first line. */
  id: string;
  /** "r-" + the id of the first line of the run's first item. */
  runId: string;
  /** The marker line, then every line of the label (P3 continuations, or the P4 label line). */
  lineIds: string[];
  /** Hard-broken lines under the item at its text indent (J1). Not part of the label. */
  detailLineIds: string[];
  marker: Marker;
  /** 1 = outermost. */
  level: number;
  parentId: string | null;
  /** Verbatim text after the marker; continuation lines appended with one space each. */
  label: string;
  verdict: Exclude<Verdict, 'inline-text'>;
  /** Sorted ascending (code-point order), no duplicates. */
  flags: Flag[];
  decidedBy: 'D1' | 'D2' | 'D3';
}

export type RejectRule = 'V1' | 'V2' | 'V3' | 'V4' | 'V5' | 'P4' | 'D4';

/** A line that looked like it started with a marker and was ruled out, and the rule that did it. */
export interface Rejected {
  lineId: string;
  raw: string;
  rule: RejectRule;
}

export interface EnumerateResult {
  /** In reading order of their first line. */
  items: Item[];
  /** In reading order. */
  rejected: Rejected[];
  /** Every read line that is in no item's lineIds or detailLineIds, in reading order. */
  proseLineIds: string[];
  /** Lines in blocks the detector does not read (P2), in reading order. */
  skippedLineIds: string[];
}
