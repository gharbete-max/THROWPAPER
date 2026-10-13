import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import {
  MODEL_MANIFEST,
  modelFileName,
  unpublishedReason,
  type ModelEvent,
  type ModelJob,
  type ModelProblem,
  type ModelStatus,
  type StartResult,
  type WeightsManifest,
} from '@tp/shared/summary';
import type { FromWorker, ToWorker } from './worker-core.js';
import { WeightsError, downloadModel, verifyFile } from './weights.js';

/**
 * The model, as the rest of the shell sees it: where the file is, whether it has been checked,
 * whether there is room to load it, and one job at a time through a worker process.
 *
 * Electron is not in this file. The process, the free-memory reading, the file dialog and the
 * network are handed in, so the same code runs under test with a worker in memory and a fake
 * engine — the path CI and the end-to-end test take — and in the app with the real ones.
 *
 * ## Rules that live here (ADR 0023)
 *
 * - **Never in the installer, never automatic.** `install` is only ever called by the person's
 *   request through the bridge; nothing here calls it on its own.
 * - **Verified before the first use of each session.** A file is hashed against the manifest
 *   before the worker is asked to load it. A mismatch deletes nothing, loads nothing and says
 *   `damaged`.
 * - **Room first.** Under about 5 GB of free memory the model is not loaded, and the reason is
 *   given before anything is attempted.
 * - **Released when idle.** The worker is ended ten minutes after its last job, which frees the
 *   model's memory completely.
 */
export const REQUIRED_MEMORY_BYTES = 5 * 1000 ** 3;
export const IDLE_MS = 10 * 60 * 1000;
const INSTALL = 'install' as const;

export interface WorkerHandle {
  post(message: ToWorker): void;
  onMessage(listener: (message: FromWorker) => void): void;
  /** Called once if the process ends, however it ends. */
  onExit(listener: () => void): void;
  kill(): void;
}

export interface ServiceDeps {
  manifest?: WeightsManifest;
  /** Where downloaded files and the remembered location live. */
  dir: string;
  spawn(): WorkerHandle;
  freeMemory(): number;
  /** The computer's own file dialog; null when the person closes it. */
  chooseFile(): Promise<string | null>;
  fetch: typeof fetch;
  emit(event: ModelEvent): void;
  idleMs?: number;
  /** CI and end-to-end: no file, no check, no memory test. The worker is whatever `spawn` gives. */
  fake?: boolean;
}

export interface ModelService {
  status(): Promise<ModelStatus>;
  install(): Promise<StartResult>;
  openFromDisk(): Promise<StartResult>;
  remove(): Promise<ModelStatus>;
  start(id: string, job: ModelJob): Promise<StartResult>;
  cancel(id: string): Promise<void>;
  /** Ends the worker. The app calls it on quit. */
  close(): Promise<void>;
}

type Activity = ModelStatus['activity'];

export function createModelService(deps: ServiceDeps): ModelService {
  const manifest = deps.manifest ?? MODEL_MANIFEST;
  const emit = deps.emit;
  const idleMs = deps.idleMs ?? IDLE_MS;
  const locationFile = join(deps.dir, 'location.json');

  let activity: Activity = 'idle';
  let damaged = false;
  /** Path|size|mtime of a file hashed this session and found right. */
  let verifiedKey: string | null = null;
  let worker: WorkerHandle | null = null;
  let loaded = false;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let current: { id: string; abort: AbortController } | null = null;

  async function readLocation(): Promise<string | null> {
    const remembered = await readFile(locationFile, 'utf8')
      .then((text) => (JSON.parse(text) as { path?: unknown }).path)
      .catch(() => undefined);
    const ours = join(deps.dir, modelFileName(manifest));
    for (const path of [typeof remembered === 'string' ? remembered : null, ours]) {
      if (
        path &&
        (await stat(path).then(
          (s) => s.isFile(),
          () => false,
        ))
      )
        return path;
    }
    return null;
  }

  async function keyOf(path: string): Promise<string> {
    const info = await stat(path);
    return `${path}|${info.size}|${info.mtimeMs}`;
  }

  async function status(): Promise<ModelStatus> {
    const base = {
      id: manifest.id,
      licence: manifest.licence,
      bytes: manifest.bytes,
      downloadBlocked: unpublishedReason(manifest),
      freeMemoryBytes: deps.freeMemory(),
      requiredMemoryBytes: REQUIRED_MEMORY_BYTES,
      activity,
    };
    if (deps.fake) {
      return {
        ...base,
        installed: true,
        location: null,
        verified: true,
        damaged: false,
        downloadBlocked: null,
      };
    }
    const location = await readLocation();
    return {
      ...base,
      installed: location !== null,
      location,
      verified: location !== null && verifiedKey === (await keyOf(location)),
      damaged: location !== null && damaged,
    };
  }

  function stopWorker(): void {
    clearTimeout(idleTimer);
    if (worker) {
      worker.post({ type: 'dispose' });
      worker.kill();
    }
    worker = null;
    loaded = false;
  }

  function armIdle(): void {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(stopWorker, idleMs);
    idleTimer.unref?.();
  }

  const finish = () => {
    current = null;
    activity = 'idle';
    armIdle();
  };

  /** Hash the file unless this session already did; steps are reported as the job's "loading". */
  async function ensureVerified(
    path: string,
    abort: AbortController,
    report: (done: number, total: number) => void,
  ): Promise<boolean> {
    const key = await keyOf(path);
    if (verifiedKey === key) return true;
    activity = 'verifying';
    const verdict = await verifyFile(path, manifest, {
      signal: abort.signal,
      onBytes: (bytes) => report(bytes, manifest.bytes),
    });
    if (verdict === 'ok') {
      verifiedKey = key;
      damaged = false;
      return true;
    }
    damaged = true;
    return false;
  }

  function workerFor(): WorkerHandle {
    if (worker) return worker;
    const handle = deps.spawn();
    worker = handle;
    handle.onMessage((message) => {
      if (message.type !== 'event') return;
      emit(message.event);
      if (message.event.kind === 'done' || message.event.kind === 'error') finish();
    });
    handle.onExit(() => {
      const ended = current;
      if (worker === handle) {
        worker = null;
        loaded = false;
      }
      if (ended) {
        emit({ id: ended.id, kind: 'error', problem: 'cannot-start' });
        finish();
      }
    });
    return handle;
  }

  function loadWorker(path: string): Promise<{ ok: true } | { ok: false; problem: ModelProblem }> {
    return new Promise((resolveLoad) => {
      const handle = workerFor();
      if (loaded) return resolveLoad({ ok: true });
      let settled = false;
      const settle = (result: { ok: true } | { ok: false; problem: ModelProblem }) => {
        if (settled) return;
        settled = true;
        resolveLoad(result);
      };
      handle.onMessage((message) => {
        if (message.type === 'loaded') {
          loaded = true;
          settle({ ok: true });
        } else if (message.type === 'load-failed') {
          settle({ ok: false, problem: message.problem });
        }
      });
      handle.onExit(() => settle({ ok: false, problem: 'cannot-start' }));
      handle.post({ type: 'load', path });
    });
  }

  async function runJob(id: string, job: ModelJob, abort: AbortController): Promise<void> {
    const fail = (problem: ModelProblem) => {
      emit({ id, kind: 'error', problem });
      finish();
    };
    try {
      let path = '';
      if (!deps.fake) {
        path = (await readLocation()) ?? '';
        if (!path) return fail('not-installed');
        const ok = await ensureVerified(path, abort, (done, total) =>
          emit({ id, kind: 'step', step: 'loading', done, total }),
        );
        if (abort.signal.aborted) return fail('cancelled');
        if (!ok) return fail('damaged');
      }
      activity = 'loading';
      emit({ id, kind: 'step', step: 'loading', done: manifest.bytes, total: manifest.bytes });
      const result = await loadWorker(path);
      if (abort.signal.aborted) return fail('cancelled');
      if (!result.ok) return fail(result.problem);
      activity = 'working';
      workerFor().post({ type: 'run', id, job });
    } catch (error) {
      fail(error instanceof Error && error.name === 'AbortError' ? 'cancelled' : 'failed');
    }
  }

  async function start(id: string, job: ModelJob): Promise<StartResult> {
    if (activity !== 'idle') return { ok: false, problem: 'busy' };
    if (!deps.fake) {
      if ((await readLocation()) === null) return { ok: false, problem: 'not-installed' };
      // The memory the model needs is only needed while it is loaded.
      if (!loaded && deps.freeMemory() < REQUIRED_MEMORY_BYTES) {
        return { ok: false, problem: 'too-little-memory' };
      }
    }
    clearTimeout(idleTimer);
    activity = 'loading';
    const abort = new AbortController();
    current = { id, abort };
    // After this returns, so the caller has the id before the first event with it.
    setImmediate(() => void runJob(id, job, abort));
    return { ok: true, id };
  }

  async function cancel(id: string): Promise<void> {
    if (current?.id === id) {
      current.abort.abort();
      worker?.post({ type: 'cancel', id });
    }
    if (id === INSTALL) installAbort?.abort();
  }

  let installAbort: AbortController | null = null;

  async function install(): Promise<StartResult> {
    if (activity !== 'idle') return { ok: false, problem: 'busy' };
    if (unpublishedReason(manifest) !== null) return { ok: false, problem: 'download-unavailable' };
    activity = 'downloading';
    installAbort = new AbortController();
    const signal = installAbort.signal;
    void (async () => {
      try {
        const path = await downloadModel({
          manifest,
          dir: deps.dir,
          fetch: deps.fetch,
          signal,
          onProgress: (p) => emit({ id: INSTALL, kind: 'install', ...p }),
        });
        // The join hashed every byte against the manifest's own hash: it counts as verified.
        verifiedKey = await keyOf(path);
        damaged = false;
        await rm(locationFile, { force: true });
        activity = 'idle';
        emit({ id: INSTALL, kind: 'installed', status: await status() });
      } catch (error) {
        activity = 'idle';
        const problem: ModelProblem = signal.aborted
          ? 'cancelled'
          : error instanceof WeightsError && error.failure === 'unpublished'
            ? 'download-unavailable'
            : 'download-failed';
        emit({ id: INSTALL, kind: 'install-failed', problem });
      } finally {
        installAbort = null;
      }
    })();
    return { ok: true, id: INSTALL };
  }

  async function openFromDisk(): Promise<StartResult> {
    if (activity !== 'idle') return { ok: false, problem: 'busy' };
    const chosen = await deps.chooseFile();
    if (!chosen) return { ok: false, problem: 'cancelled' };
    activity = 'verifying';
    installAbort = new AbortController();
    const signal = installAbort.signal;
    void (async () => {
      try {
        const verdict = await verifyFile(chosen, manifest, {
          signal,
          onBytes: (done) =>
            emit({ id: INSTALL, kind: 'install', phase: 'verify', done, total: manifest.bytes }),
        });
        if (verdict !== 'ok') {
          activity = 'idle';
          emit({ id: INSTALL, kind: 'install-failed', problem: 'not-a-model-file' });
          return;
        }
        await mkdir(deps.dir, { recursive: true });
        await writeFile(locationFile, JSON.stringify({ path: resolve(chosen) }), 'utf8');
        verifiedKey = await keyOf(chosen);
        damaged = false;
        activity = 'idle';
        emit({ id: INSTALL, kind: 'installed', status: await status() });
      } catch {
        activity = 'idle';
        emit({
          id: INSTALL,
          kind: 'install-failed',
          problem: signal.aborted ? 'cancelled' : 'failed',
        });
      } finally {
        installAbort = null;
      }
    })();
    return { ok: true, id: INSTALL };
  }

  async function remove(): Promise<ModelStatus> {
    if (activity === 'idle') {
      stopWorker();
      const path = await readLocation();
      // A file Loppa downloaded is Loppa's to delete. One the person opened from disk is theirs:
      // it is only forgotten.
      const inside = path !== null && resolve(path).startsWith(resolve(deps.dir) + sep);
      if (path && inside) await rm(path, { force: true });
      await rm(locationFile, { force: true });
      verifiedKey = null;
      damaged = false;
    }
    return status();
  }

  async function close(): Promise<void> {
    installAbort?.abort();
    current?.abort.abort();
    stopWorker();
  }

  return { status, install, openFromDisk, remove, start, cancel, close };
}
