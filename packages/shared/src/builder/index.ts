/**
 * The guided builder's pure core — `docs/plan/PREDICTIVE-BUILDER.md`, ADRs 0017 and 0020.
 *
 * Its own subpath (`@tp/shared/builder`) so that nothing reaches a bundle that did not ask for it:
 * the public form never imports this.
 */
export * from './graph/schema.js';
export * from './graph/paths.js';
export * from './graph/guards.js';
export * from './graph/validate.js';
export { BUILDER_GRAPH } from './graph/nodes.js';
export * from './state.js';
export * from './changes.js';
export * from './fields.js';
export * from './ids.js';
export { runPatch, type PatchContext } from './patches.js';
export * from './machine.js';
export * from './session.js';
