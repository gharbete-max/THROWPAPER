import type { SummaryLocale } from './languages.js';

/**
 * What the desktop shell offers the Forms window for the summary centre — `window.loppaModel`
 * (ADR 0023, ADR 0016). Types only; the shell implements it, a test double implements it, and the
 * hosted edition has no implementation at all, which is how the pane knows to say "Not in this
 * edition".
 *
 * It is an IPC and not an HTTP route on purpose: a reading's text goes from the window to the
 * shell on this computer and nowhere else, with no `fetch` in the code that holds the text
 * (`docs/plan/CAVEATS.md` #43). The shell side answers only the Forms window's own origin.
 */

/** Why something did not happen. Each is a plain sentence in the pane, never the raw code. */
export type ModelProblem =
  /** No model file the app has accepted. */
  | 'not-installed'
  /** The file does not match the manifest. Nothing is deleted; the model is not used. */
  | 'damaged'
  /** Under about 5 GB of free memory. */
  | 'too-little-memory'
  /** The runtime could not start on this computer (no binary for it, or it crashed). */
  | 'cannot-start'
  /** The download has no address yet (the release has not been cut). */
  | 'download-unavailable'
  | 'download-failed'
  | 'not-a-model-file'
  | 'busy'
  | 'too-long'
  | 'language-refused'
  /** The text is a contract, consent, declaration or clinical form: it is quoted, never reworded. */
  | 'quote-only'
  | 'cancelled'
  /** Output stopped because it began to repeat itself. */
  | 'repetition'
  | 'failed';

export interface ModelStatus {
  id: string;
  licence: string;
  /** Bytes of the model file: what a download costs in disk and traffic. */
  bytes: number;
  /** A file is in place (downloaded or opened from disk). Not yet proof that it is the right one. */
  installed: boolean;
  /** Where the file is, for the person to see. Null when none. */
  location: string | null;
  /** Checked against the manifest this session, and it matched. */
  verified: boolean;
  /** Checked and it did not match: refuse to load, and say so. */
  damaged: boolean;
  /** Null when the download can be started; otherwise why not (the release has no address yet). */
  downloadBlocked: string | null;
  freeMemoryBytes: number;
  requiredMemoryBytes: number;
  /** What the shell is doing now. */
  activity: 'idle' | 'downloading' | 'verifying' | 'loading' | 'working';
}

export type ModelJob =
  /** A summary of a document, or of a filled form's labels and answers. */
  | { kind: 'summarise'; text: string; into: SummaryLocale; shape: 'document' | 'form' }
  | { kind: 'translate'; text: string; into: SummaryLocale }
  /** Which passages of a contract, consent, declaration or clinical form to read first. */
  | { kind: 'select'; passages: string[]; language: SummaryLocale | null };

export type JobStep = 'loading' | 'reading' | 'combining' | 'writing' | 'translating';

/** Something the digit check or the loop guard found. Shown with the output, never hidden. */
export type JobWarning =
  | { kind: 'numbers-added'; numbers: string[] }
  | { kind: 'numbers-missing'; numbers: string[] }
  | { kind: 'repetition' };

export type ModelEvent =
  /** A job's progress: `done` of `total` steps of this kind. */
  | { id: string; kind: 'step'; step: JobStep; done: number; total: number }
  /** The output so far. `replace`: it is the whole text again; `append`: more of it. */
  | { id: string; kind: 'text'; mode: 'replace' | 'append'; text: string }
  /** Chosen passage numbers (1-based), never any text. The pane quotes its own copy. */
  | { id: string; kind: 'selected'; numbers: number[] }
  | { id: string; kind: 'done'; warnings: JobWarning[]; seconds: number }
  | { id: string; kind: 'error'; problem: ModelProblem }
  /** Getting the model: `part` of `parts`, bytes so far of the whole. */
  | {
      id: 'install';
      kind: 'install';
      phase: 'download' | 'join' | 'verify';
      done: number;
      total: number;
      part?: number;
      parts?: number;
    }
  | { id: 'install'; kind: 'installed'; status: ModelStatus }
  | { id: 'install'; kind: 'install-failed'; problem: ModelProblem };

export type StartResult = { ok: true; id: string } | { ok: false; problem: ModelProblem };

export interface ModelBridge {
  status(): Promise<ModelStatus>;
  /** Downloads the two parts from Loppa's release, joins and verifies them. The pane has asked first. */
  install(): Promise<StartResult>;
  /** Asks for a file with the computer's own dialog, verifies it, and uses it where it is. */
  openFromDisk(): Promise<StartResult>;
  /** Forgets the model: deletes the file Loppa downloaded, or just stops using one opened from disk. */
  remove(): Promise<ModelStatus>;
  /**
   * Starts a job under an id the caller chose, so events cannot arrive before the caller knows what
   * they are for. Progress and output arrive as events carrying that id.
   */
  start(id: string, job: ModelJob): Promise<StartResult>;
  cancel(id: string): Promise<void>;
  /** Subscribes to events; returns the way to stop listening. */
  onEvent(listener: (event: ModelEvent) => void): () => void;
}
