import type { ModelJob } from '../summary/bridge.js';
import type { Capability } from './capability.js';

/**
 * What a Loppa can ask the coordinator for. Every task names exactly one capability, and the
 * coordinator finds the model that has it. A new product adds a kind here and a case to
 * {@link TASK_CAPABILITY}; it ships no runtime and no channel of its own.
 */

/** The text kinds are the summary centre's jobs, unchanged (ADR 0023). */
export type TextTask = ModelJob;

/**
 * Read one page of a document from a picture of it (docs/plan/AI-SYSTEM.md D4). A TYPE ONLY for
 * now: no engine has the `vision` capability until Phase 3 registers one, and the bridge refuses
 * this kind with `not-available`. The picture itself travels as PNG bytes.
 */
export interface ReadPageTask {
  kind: 'read-page';
  /** SHA-256 of the whole file: half of the cache key. */
  fileSha256: string;
  /** 1-based. */
  page: number;
  png: Uint8Array;
  /** The language the page is probably in, when known. */
  language: string | null;
}

export type AiTask = TextTask | ReadPageTask;
export type AiTaskKind = AiTask['kind'];

export const TASK_CAPABILITY = {
  summarise: 'text',
  translate: 'text',
  select: 'text',
  'read-page': 'vision',
} as const satisfies Record<AiTaskKind, Capability>;

export function capabilityOf(task: { kind: AiTaskKind }): Capability {
  return TASK_CAPABILITY[task.kind];
}

export function isTextTask(task: AiTask): task is TextTask {
  return TASK_CAPABILITY[task.kind] === 'text';
}
