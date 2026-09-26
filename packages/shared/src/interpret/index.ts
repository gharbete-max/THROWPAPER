/**
 * Free text read by rules — `docs/plan/INTENT-LADDER.md`, ADR 0019. S3: normalisation, the word
 * lists of the twelve languages, the built-in aliases, and the ladder's rungs T0–T4.
 *
 * Its own subpath (`@tp/shared/interpret`), like `/builder` and `/import`, so nothing reaches a
 * bundle that did not ask for it.
 */
export * from './aliases.js';
export * from './ladder.js';
export { LANGUAGES, languageOf, lexiconFor, type Language, type Lexicon } from './lexicon.js';
export { lnMille } from './ln.js';
export { PATTERN_KINDS, readPattern, type PatternKind, type PatternReading } from './patterns.js';
export { keyOf, type Token } from './text.js';
export { vocabularyFor, type Vocabulary } from './vocabulary.js';
