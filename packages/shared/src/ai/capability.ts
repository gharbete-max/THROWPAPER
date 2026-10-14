/**
 * What a model can be asked to do. A task names exactly one capability; a model lists the ones it
 * has. `text` is the language model of the summary centre; `vision` reads a picture of a page.
 * Spreadsheets, presentations, image and video editing add theirs here when they have a task
 * (docs/adr/0024-ai-coordinator.md).
 */
export const CAPABILITIES = ['text', 'vision'] as const;
export type Capability = (typeof CAPABILITIES)[number];

/** The `id` of a manifest: lower case, letters, digits, dot, dash, underscore. */
export type ModelId = string;

export function isCapability(value: unknown): value is Capability {
  return (CAPABILITIES as readonly unknown[]).includes(value);
}
