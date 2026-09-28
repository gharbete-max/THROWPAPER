/**
 * Document import's pure core — `docs/plan/IMPORT-PIPELINE.md`, ADRs 0018 and 0019.
 *
 * Stages 2–7 live here and run in the author's browser (a Web Worker) and in the desktop app; the
 * bytes of a file are only ever touched in `apps/forms`. Its own subpath (`@tp/shared/import`) so
 * that nothing reaches a bundle that did not ask for it.
 */
export * from './ir/types.js';
export * from './ir/schema.js';
export * from './ir/validate.js';
export { lowerMedian, unionBox } from './ir/geometry.js';
export * from './debug.js';
export { sha256Hex } from './sha256.js';
export { MAX_PASTE, PASTE_EXTRACTOR, pasteDocument } from './paste.js';
export { CHECKBOX_GLYPHS, isBlankWord, isCheckboxWord, textHints } from './layout/hints.js';
export {
  documentLocale,
  furnitureKey,
  isPageNumberKey,
  LAYOUT_LANGUAGES,
  LAYOUT_LEXICON,
  LOCALE_MIN_HITS,
  localeTokens,
} from './layout/lexicon.js';
export type { LayoutLanguage, LayoutLexicon, LocaleCount } from './layout/lexicon.js';
export { columnRegions, MAX_CUT_DEPTH, MIN_GUTTER } from './layout/xycut.js';
export type { CutDecision, CutWord, Region } from './layout/xycut.js';
export { reassemble, REASSEMBLE_STAGE_VERSION } from './layout/reassemble.js';
export * from './enumerate/types.js';
export { grammar, probe, romanValue, ROMAN_MAX } from './enumerate/grammar.js';
export type { MarkerMatch, Production, Reading } from './enumerate/grammar.js';
export {
  CONT_MAX,
  GAZETTEERS,
  gazetteerForm,
  isContinuationNotice,
  isMonth,
  isUnitWord,
} from './enumerate/gazetteers.js';
export { enumerate, ENUMERATE_STAGE_VERSION, MAX_ARABIC } from './enumerate/enumerate.js';
