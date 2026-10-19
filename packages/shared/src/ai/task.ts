import type { ModelJob } from '../summary/bridge.js';
import type { ReplyTask } from '../summary/reply.js';
import type { ComposeTask, ProofreadTask } from '../summary/proofread.js';
import type { Capability } from './capability.js';

/**
 * What a Loppa can ask the coordinator for. Every task names exactly one capability, and the
 * coordinator finds the model that has it. A new product adds a kind here and a case to
 * {@link TASK_CAPABILITY}; it ships no runtime and no channel of its own.
 */

/**
 * The text kinds: the summary centre's jobs, unchanged (ADR 0023), and the email reply helper's
 * four (docs/plan/AI-SYSTEM.md D6). Every one needs the text model and nothing else.
 */
export type TextTask = ModelJob | ReplyTask | ProofreadTask | ComposeTask;

/**
 * Read one page of a document from a picture of it (docs/plan/AI-SYSTEM.md D4). The picture travels
 * as PNG or JPEG bytes, rendered by the window at a bounded pixel budget (`longEdge` is the long
 * side it was drawn with, and is part of the cache key, so a second pass at a higher resolution is
 * a different result). The answer is one `text` event holding a `StructuredPage` as JSON.
 */
export interface ReadPageTask {
  kind: 'read-page';
  /** SHA-256 of the whole file: half of the cache key. */
  fileSha256: string;
  /** 1-based. */
  page: number;
  png: Uint8Array;
  /** Pixels of the picture's long side. */
  longEdge: number;
  /** Degrees the page was turned by before it was drawn: part of what was read. */
  turn: 0 | 90 | 180 | 270;
  /** The language the page is probably in, when known. */
  language: string | null;
}

export type AiTask = TextTask | ReadPageTask;
export type AiTaskKind = AiTask['kind'];

export const TASK_CAPABILITY = {
  summarise: 'text',
  translate: 'text',
  select: 'text',
  'draft-reply': 'text',
  'shorten-reply': 'text',
  'translate-reply': 'text',
  'revise-reply': 'text',
  proofread: 'text',
  'compose-email': 'text',
  'read-page': 'vision',
} as const satisfies Record<AiTaskKind, Capability>;

export function capabilityOf(task: { kind: AiTaskKind }): Capability {
  return TASK_CAPABILITY[task.kind];
}

export function isTextTask(task: AiTask): task is TextTask {
  return TASK_CAPABILITY[task.kind] === 'text';
}
