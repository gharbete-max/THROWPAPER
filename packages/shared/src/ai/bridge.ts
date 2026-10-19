import type { JobWarning, ModelEvent, ModelProblem } from '../summary/bridge.js';
import type { Capability } from './capability.js';
import type { AiTask } from './task.js';

/**
 * What the desktop shell offers every Loppa window for AI: `window.loppaAi` (ADR 0024, amending
 * ADR 0023). Types only; the shell implements it, a test double implements it, and the hosted
 * edition has no implementation at all, which is how a pane knows to say "Not in this edition".
 *
 * It is an IPC and not an HTTP route on purpose: a document's text goes from the window to the
 * shell on this computer and nowhere else (`docs/plan/CAVEATS.md` #43). The shell answers only the
 * Forms window's own origin. `window.loppaModel` (ADR 0023) is a thin adapter over the same
 * coordinator and stays until its callers have moved.
 */

export type AiProblem = ModelProblem | 'not-available' | 'consent-required';

/** Where a model file was found, in the order they are looked in (docs/plan/AI-SYSTEM.md D7). */
export const FILE_SOURCES = [
  'env',
  'local-models',
  'repo-root',
  'ai-pack',
  'remembered',
  'user-data',
] as const;
export type FileSource = (typeof FILE_SOURCES)[number];

export interface AiFileStatus {
  role: 'weights' | 'projector' | 'projector-lite' | 'runtime';
  /** An alternative the model does not need: missing is not a problem. */
  optional?: boolean;
  name: string;
  bytes: number;
  /** Where it is, or null when missing. */
  path: string | null;
  source: FileSource | null;
  /**
   * `verified`: hashed this session and matched. `unchecked`: found, not hashed yet (it is before
   * its first use). `unpinned`: the manifest has no hash for it. `damaged`: hashed and did not match.
   */
  hash: 'verified' | 'unchecked' | 'unpinned' | 'damaged' | 'missing';
}

export type AiModelState =
  /** Every file is there and none is known to be wrong. */
  | 'installed'
  | 'missing'
  | 'damaged'
  /** Installed and loaded, or being used right now. */
  | 'busy'
  /** Files may be present, but the licence is a research one: for evaluation, never shipped. */
  | 'evaluation-only';

export interface AiModelStatus {
  id: string;
  name: string;
  capabilities: Capability[];
  state: AiModelState;
  /** False until an engine for it is registered: a vision model is "not available yet". */
  available: boolean;
  licence: string;
  licenceUrl: string;
  distributable: boolean;
  evaluationOnly: boolean;
  /** Set on an evaluation-only model: its licence was not checked as a release licence. */
  label: 'unverified-licence' | null;
  /** All files together. */
  bytes: number;
  requiredMemoryBytes: number;
  files: AiFileStatus[];
  /** Null when the download can be started; otherwise why not. Evaluation-only: always off. */
  downloadBlocked: string | null;
  /** The folder the person can put the files in, and the one downloads go to. */
  folder: string;
  resident: boolean;
}

export interface AiStatus {
  models: AiModelStatus[];
  freeMemoryBytes: number;
  /** What the shell is doing now. */
  activity: 'idle' | 'downloading' | 'verifying' | 'loading' | 'working';
  queued: number;
  /** The program that runs the models (ADR 0025); null when this edition has none to show. */
  runtime: AiFileStatus | null;
  cache: { entries: number; bytes: number; maxBytes: number };
}

/** Events carry the id the caller chose for the task, or {@link installId} for an install. */
export type AiEvent =
  | Extract<ModelEvent, { kind: 'step' | 'text' | 'selected' }>
  | { id: string; kind: 'queued'; position: number }
  | { id: string; kind: 'done'; warnings: JobWarning[]; seconds: number }
  | { id: string; kind: 'error'; problem: AiProblem }
  | {
      id: string;
      kind: 'install';
      modelId: string;
      /** The file being fetched, 1-based among the model's files. */
      file: number;
      files: number;
      phase: 'download' | 'join' | 'verify';
      done: number;
      total: number;
      part?: number;
      parts?: number;
    }
  | { id: string; kind: 'installed'; modelId: string; status: AiStatus }
  | { id: string; kind: 'install-failed'; modelId: string; problem: AiProblem };

export type AiStart = { ok: true; id: string } | { ok: false; problem: AiProblem };

/** The id install events and cancel use for a model. Run ids may not begin with `install`. */
export const installId = (modelId: string): string => `install:${modelId}`;

export interface AiBridge {
  status(): Promise<AiStatus>;
  /**
   * Fetches a model's files from Loppa's release, joins and verifies them. `consent` is true only
   * after the person has been told the size and that no document is sent; without it nothing starts.
   */
  install(modelId: string, consent: boolean): Promise<AiStart>;
  /** Asks for a file with the computer's own dialog, matches it to the model by hash, and uses it where it is. */
  openFromDisk(modelId: string): Promise<AiStart>;
  /** Forgets a model: deletes what Loppa downloaded, only stops using what the person supplied. */
  remove(modelId: string): Promise<AiStatus>;
  /**
   * Runs a task under an id the caller chose, so events cannot arrive before the caller knows what
   * they are for. A task for a model that is not the loaded one waits its turn.
   */
  run(id: string, task: AiTask): Promise<AiStart>;
  cancel(id: string): Promise<void>;
  onEvent(listener: (event: AiEvent) => void): () => void;
  /** Empties the local result cache. */
  clearCache(): Promise<AiStatus>;
}
