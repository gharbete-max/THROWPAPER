/**
 * The types every Loppa shares for AI (ADR 0024): capabilities, the model manifest registry, the
 * task union, the structured document, the cache key and the `window.loppaAi` bridge. No model
 * runs here and none may: the coordinator is `apps/desktop/src/ai/`.
 */
export * from './capability.js';
export * from './manifest.js';
export * from './task.js';
export * from './document.js';
export * from './cache-key.js';
export * from './bridge.js';
