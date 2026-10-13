/**
 * The summary and translation centre's pure parts (ADR 0023): the weights manifest, the twelve
 * languages and what each may do, the checks that go around the model, how a long text is cut,
 * and how a passage is selected and quoted.
 *
 * No model runs here, and none may: this folder is where the app's rules about the model live, so
 * that they can be tested without one. `summary-boundary.test.ts` keeps the model out of
 * `builder`, `interpret` and `import`, and these out of the builder and the import's decisions.
 */
export * from './manifest.js';
export * from './languages.js';
export * from './check.js';
export * from './chunk.js';
export * from './passages.js';
export type * from './bridge.js';
