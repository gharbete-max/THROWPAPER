/**
 * What stage 5 produces — `docs/plan/IMPORT-PIPELINE.md` §5: for each question, grid and table, a
 * proposed kind with its confidence and its reasons, whether it is required, and the chips the
 * review screen offers. Proposals only: nothing here is applied to a draft (stage 8 asks).
 */

/**
 * The kinds a question can be proposed as — `PREDICTIVE-BUILDER.md`, "Kinds": a `FieldType`, or an
 * import kind that maps onto one (`money` is a number with two decimals, `personnummer` and
 * `orgnr` are short text with a format, `address` is a block of short text, `consent` is a yes/no
 * with the consent presentation, `grid` is one single choice per row until a grid type exists).
 */
export const KINDS = [
  'short_text',
  'long_text',
  'number',
  'money',
  'date',
  'time',
  'email',
  'phone',
  'address',
  'personnummer',
  'orgnr',
  'file',
  'signature',
  'yes_no',
  'consent',
  'single_select',
  'multi_select',
  'grid',
  'repeating_group',
] as const;
export type Kind = (typeof KINDS)[number];

/** The word features a lexicon lists (`classify/lexicon/<language>.json`). */
export const WORD_FEATURES = [
  'nameWord',
  'emailWord',
  'phoneWord',
  'addressWord',
  'dateWord',
  'timeWord',
  'numberWord',
  'currencyHint',
  'personnummerWord',
  'orgNrWord',
  'signatureHint',
  'fileHint',
  'consentHint',
  'commentWord',
  'selectAllPhrase',
  'repeatableHint',
  'required',
  'optional',
  'maxWords',
  'minWords',
] as const;
export type WordFeature = (typeof WORD_FEATURES)[number];

/** Features read from the segment and its lines rather than from words. */
export const SHAPE_FEATURES = [
  'answerBoolean',
  'answerChoice',
  'booleanPair',
  'singleCheckbox',
  'gridAlignment',
  'gridSingleColumn',
  'tableRows',
  'multiLineBlank',
  'longPromptNoBlank',
  'datePattern',
  'timeSlotPattern',
] as const;
export type ShapeFeature = (typeof SHAPE_FEATURES)[number];
export type Feature = WordFeature | ShapeFeature;

/** Whether the label says it must be answered. No hint is `unknown`, never "optional" (#26). */
export type RequiredReading = 'yes' | 'no' | 'unknown';

/** A proposal the review screen shows as a chip, never applies by itself (#29). */
export interface Chip {
  name: 'max' | 'min' | 'repeatable';
  value: number | null;
}

/** A named validation (`se-personnummer`, …) and whether to apply it or only offer it (#27). */
export interface FormatProposal {
  name: string;
  apply: boolean;
}

export interface ColumnKind {
  label: string;
  kind: Kind;
  confidence: number;
}

export interface Classification {
  /** Index of the segment in stage 4's `segments`. */
  segmentIndex: number;
  /** The segment's first line id; `p1-l3#2` for the second question split from line p1-l3. */
  subject: string;
  kind: Kind;
  /** Per mille: sigmoid of `margin`. */
  confidence: number;
  /** Millinats: the winner's score less the runner-up's (or the winner's score, alone). */
  margin: number;
  runnerUp: Kind | null;
  /** The winner's features that weighed most, strongest first, at most three — the "why". */
  why: Feature[];
  /** Every feature present, in code-point order. */
  features: Feature[];
  required: RequiredReading;
  /** The words that said so, verbatim ("*", "(obligatoriskt)"), or null. */
  requiredBy: string | null;
  format: FormatProposal | null;
  /** The consent presentation; the text itself stays the label, byte for byte (#28). */
  presentation: 'consent' | null;
  chips: Chip[];
  /** A table's columns, each read as a question of its own; null for anything else. */
  columns: ColumnKind[] | null;
}

export interface ClassifyResult {
  /** One per question, grid and table segment, in segment order. */
  classified: Classification[];
}
