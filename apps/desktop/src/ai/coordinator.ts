import { appendFile, mkdir, readFile, rm, stat, statfs, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve, sep } from 'node:path';
import {
  PAGE_PIPELINE_VERSION,
  cacheKey,
  capabilityOf,
  fileNames,
  installId,
  isAllowedHost,
  isDownloadable,
  consentFor,
  consentMatches,
  recommendModel,
  type AiConsent,
  totalBytes,
  unpublishedReason,
  MODEL_REGISTRY,
  type AiEvent,
  type AiFileStatus,
  type AiModelStatus,
  type AiProblem,
  type AiStart,
  type AiStatus,
  type AiTask,
  type ModelFile,
  type ModelManifest,
} from '@tp/shared/ai';
import type { ResultCache } from './cache.js';
import { WeightsError, downloadFile, sha256File, verifyFile } from './download.js';
import { AiError, type Engine, type EngineFactory, type EngineFiles } from './engine.js';
import { PACK_FILE, PackError, installFromFolder } from './pack.js';
import { locateModel, type ResolveContext } from './resolve.js';

/**
 * The one AI coordinator every Loppa uses (docs/adr/0024-ai-coordinator.md, amending ADR 0023).
 *
 * It knows which models exist (the manifest registry), where their files are, whether they have
 * been checked, which engine runs which, and who is waiting. It does not know what a summary is:
 * a task goes to the engine of a model that has the task's capability, and the engine does the
 * work. Electron is not in this file: the engines, the free-memory reading, the file dialog and the
 * network are handed in, so the same code runs under test with a fake engine and in the app with
 * the real ones.
 *
 * ## Rules that live here
 *
 * - **Never in the installer, never automatic.** `install` is only called by a person's request
 *   and without `consent: true` it does nothing. Nothing here calls it on its own.
 * - **Verified before the first use of each session.** Every file found is hashed against its
 *   manifest before the engine is asked to load it (once per path, size and modification time). A
 *   mismatch deletes nothing, loads nothing and says `damaged`.
 * - **One model alive.** At most one engine is loaded. A task for another model waits its turn;
 *   when it comes, the loaded engine is disposed first, then the next is created, so two models
 *   are never in memory together. Tasks run one at a time, highest priority first, then oldest.
 * - **Room first.** A model is not loaded under its manifest's `requiredMemoryBytes` of free
 *   memory, and the reason is given before anything is attempted.
 * - **Released when idle.** The engine is disposed `idleMs` after the last task, which gives its
 *   memory back completely.
 * - **Evaluation-only models are never fetched**, whatever is asked.
 */
/** Left free on the disk after a download. */
const DISK_MARGIN_BYTES = 256 * 1024 * 1024;

export const IDLE_MS = 10 * 60 * 1000;

/** A page's JSON that is worth keeping: it was read, wholly or with doubts, and not given up on. */
function readPageKept(json: string): boolean {
  try {
    return (JSON.parse(json) as { status?: unknown }).status !== 'failed';
  } catch {
    return false;
  }
}

export const PRIORITY = { background: -1, normal: 0, interactive: 1 } as const;

type Activity = AiStatus['activity'];

/** What happened to the one engine slot, in order: the lock, made visible for tests and logs. */
export type Transition =
  | { type: 'loading'; model: string }
  | { type: 'loaded'; model: string }
  | { type: 'released'; model: string; reason: 'swap' | 'idle' | 'close' | 'crashed' | 'remove' }
  | { type: 'start'; model: string; id: string }
  | { type: 'end'; model: string; id: string };

export interface CoordinatorState {
  resident: string | null;
  running: string | null;
  queued: string[];
  activity: Activity;
}

export interface CoordinatorDeps {
  registry?: readonly ModelManifest[];
  /** Engine factories by model id. A model without one is known but "not available yet". */
  engines: Readonly<Record<string, EngineFactory>>;
  /** Loppa's folder for downloaded files and remembered locations (`<userData>/models`). */
  dir: string;
  env: NodeJS.ProcessEnv;
  /** The checkout in a development build, null when packaged. */
  repoRoot: string | null;
  /** The AI pack beside the app (`<resources>/ai-pack`), null when there is none to look in. */
  packDir?: string | null;
  /** The runtime's state for the status panel; omitted where the engines need no program. */
  runtimeStatus?(): Promise<AiFileStatus | null>;
  freeMemory(): number;
  /** Total memory, for the recommendation; falls back to free memory. */
  totalMemory?(): number;
  /** Room left on the disk `dir` is on; null if unknown. Defaults to the operating system's answer. */
  freeDisk?(dir: string): Promise<number | null>;
  /** The computer's own file dialog; null when the person closes it. */
  chooseFile(): Promise<string | null>;
  fetch: typeof fetch;
  cache: ResultCache;
  idleMs?: number;
  /** CI and end-to-end: no file, no check, no memory test. The engines are whatever `engines` gives. */
  fake?: boolean;
}

export interface Coordinator {
  status(): Promise<AiStatus>;
  install(modelId: string, consent: AiConsent): Promise<AiStart>;
  /** The model tasks go to; null returns to the best one installed. Fetches nothing. */
  select(modelId: string | null): Promise<AiStatus>;
  openFromDisk(modelId: string): Promise<AiStart>;
  remove(modelId: string): Promise<AiStatus>;
  run(id: string, task: AiTask, options?: { priority?: number }): Promise<AiStart>;
  cancel(id: string): Promise<void>;
  clearCache(): Promise<AiStatus>;
  onEvent(listener: (event: AiEvent) => void): () => void;
  onTransition(listener: (transition: Transition) => void): () => void;
  state(): CoordinatorState;
  /** Ends everything. The app calls it on quit. */
  close(): Promise<void>;
}

interface Job {
  id: string;
  task: AiTask;
  model: ModelManifest;
  priority: number;
  seq: number;
  abort: AbortController;
}

interface Resident {
  model: ModelManifest;
  engine: Engine;
}

export function createCoordinator(deps: CoordinatorDeps): Coordinator {
  const registry = deps.registry ?? MODEL_REGISTRY;
  const idleMs = deps.idleMs ?? IDLE_MS;
  const locationsFile = join(deps.dir, 'locations.json');
  const selectionFile = join(deps.dir, 'selected.json');
  const consentLog = join(deps.dir, 'consents.jsonl');
  const freeDisk =
    deps.freeDisk ??
    (async (dir: string) => {
      const info = await statfs(dir).catch(() => null);
      return info ? Number(info.bavail) * Number(info.bsize) : null;
    });

  const eventListeners = new Set<(event: AiEvent) => void>();
  const transitionListeners = new Set<(transition: Transition) => void>();
  const emit = (event: AiEvent) => eventListeners.forEach((listener) => listener(event));
  const note = (transition: Transition) =>
    transitionListeners.forEach((listener) => listener(transition));

  let activity: Activity = 'idle';
  let resident: Resident | null = null;
  let running: Job | null = null;
  let queue: Job[] = [];
  let sequence = 0;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let installAbort: AbortController | null = null;

  /** Path to the key (path|size|mtime) it had when it was hashed this session and found right. */
  const verified = new Map<string, string>();
  const damaged = new Set<string>();

  const modelById = (id: string) => registry.find((m) => m.id === id);

  // --- where the files are ---------------------------------------------------------------

  async function readRemembered(): Promise<Record<string, string>> {
    return readFile(locationsFile, 'utf8')
      .then((text) => {
        const files = (JSON.parse(text) as { files?: unknown }).files;
        return files && typeof files === 'object' ? (files as Record<string, string>) : {};
      })
      .catch(() => ({}));
  }

  async function remember(name: string, path: string | null): Promise<void> {
    const files = await readRemembered();
    if (path === null) delete files[name];
    else files[name] = resolve(path);
    await mkdir(deps.dir, { recursive: true });
    if (Object.keys(files).length === 0) await rm(locationsFile, { force: true });
    else await writeFile(locationsFile, JSON.stringify({ files }), 'utf8');
  }

  async function context(): Promise<ResolveContext> {
    return {
      env: deps.env,
      repoRoot: deps.repoRoot,
      packDir: deps.packDir ?? null,
      userDataModels: deps.dir,
      remembered: await readRemembered(),
    };
  }

  async function keyOf(path: string): Promise<string> {
    const info = await stat(path);
    return `${path}|${info.size}|${info.mtimeMs}`;
  }

  // --- status ----------------------------------------------------------------------------

  async function modelStatus(
    model: ModelManifest,
    ctx: ResolveContext,
    effectiveId: string | undefined,
  ): Promise<AiModelStatus> {
    const located = await locateModel(model, ctx);
    const factoryExists = deps.engines[model.id] !== undefined;
    const files: AiFileStatus[] = await Promise.all(
      located.map(async ({ file, found }): Promise<AiFileStatus> => {
        const base = {
          role: file.role,
          name: file.name,
          bytes: file.bytes,
          ...(file.optional ? { optional: true } : {}),
        };
        if (deps.fake && factoryExists) {
          return { ...base, path: null, source: null, hash: 'verified' };
        }
        if (!found) return { ...base, path: null, source: null, hash: 'missing' };
        const key = await keyOf(found.path).catch(() => '');
        const hash: AiFileStatus['hash'] =
          verified.get(found.path) === key
            ? 'verified'
            : damaged.has(found.path)
              ? 'damaged'
              : file.sha256 === undefined
                ? 'unpinned'
                : 'unchecked';
        return { ...base, path: found.path, source: found.source, hash };
      }),
    );
    const allThere = files.every((f) => f.hash !== 'missing' || f.optional);
    const state: AiModelStatus['state'] = model.evaluationOnly
      ? 'evaluation-only'
      : files.some((f) => f.hash === 'damaged')
        ? 'damaged'
        : running?.model.id === model.id
          ? 'busy'
          : allThere
            ? 'installed'
            : 'missing';
    return {
      id: model.id,
      name: model.name,
      capabilities: [...model.capabilities],
      state,
      available: factoryExists,
      licence: model.licence,
      licenceUrl: model.licenceUrl,
      distributable: model.distributable,
      evaluationOnly: model.evaluationOnly,
      label: model.evaluationOnly ? 'unverified-licence' : null,
      bytes: totalBytes(model),
      requiredMemoryBytes: model.requiredMemoryBytes,
      files,
      downloadBlocked: model.evaluationOnly
        ? 'evaluation-only'
        : isDownloadable(model)
          ? null
          : (unpublishedReason(model) ?? 'not-published'),
      folder: deps.dir,
      resident: resident?.model.id === model.id,
      tier: model.tier,
      support: model.support,
      requiredMemoryVerified: model.requiredMemoryVerified,
      consent: consentFor(model),
      selected: model.id === effectiveId,
      recommended: model.id === recommended(),
    };
  }

  async function status(): Promise<AiStatus> {
    const ctx = await context();
    await mkdir(deps.dir, { recursive: true }).catch(() => undefined);
    const effective = (
      await modelFor({ kind: 'summarise', text: '', into: 'en-GB', shape: 'document' })
    )?.id;
    return {
      models: await Promise.all(registry.map((model) => modelStatus(model, ctx, effective))),
      freeMemoryBytes: deps.freeMemory(),
      totalMemoryBytes: deps.totalMemory?.() ?? deps.freeMemory(),
      freeDiskBytes: await freeDisk(deps.dir),
      activity,
      queued: queue.length,
      runtime: (await deps.runtimeStatus?.()) ?? null,
      cache: await deps.cache.stats(),
    };
  }

  // --- the one engine slot ---------------------------------------------------------------

  async function release(reason: Extract<Transition, { type: 'released' }>['reason']) {
    clearTimeout(idleTimer);
    const gone = resident;
    resident = null;
    if (!gone) return;
    note({ type: 'released', model: gone.model.id, reason });
    await gone.engine.dispose().catch(() => undefined);
  }

  function armIdle(): void {
    clearTimeout(idleTimer);
    if (!resident || running || queue.length > 0) return;
    idleTimer = setTimeout(() => void release('idle'), idleMs);
    idleTimer.unref?.();
  }

  /** Hash every file not yet hashed this session. Progress is reported as the job's "loading". */
  async function ensureFiles(job: Job): Promise<EngineFiles> {
    if (deps.fake) return { weights: '' };
    const located = await locateModel(job.model, await context());
    const files: EngineFiles = { weights: '' };
    const todo: Array<{ file: ModelFile; path: string; key: string }> = [];
    for (const { file, found } of located) {
      if (!found) {
        if (file.optional) continue;
        throw new AiError('not-installed');
      }
      files[file.role] = found.path;
      const key = await keyOf(found.path);
      if (verified.get(found.path) !== key) todo.push({ file, path: found.path, key });
    }
    const total = todo.reduce((sum, item) => sum + item.file.bytes, 0);
    let before = 0;
    for (const { file, path, key } of todo) {
      activity = 'verifying';
      const verdict = await verifyFile(path, file, {
        signal: job.abort.signal,
        onBytes: (bytes) =>
          emit({ id: job.id, kind: 'step', step: 'loading', done: before + bytes, total }),
      });
      if (verdict !== 'ok') {
        damaged.add(path);
        throw new AiError('damaged');
      }
      verified.set(path, key);
      damaged.delete(path);
      before += file.bytes;
    }
    return files;
  }

  async function makeResident(job: Job, files: EngineFiles): Promise<Engine> {
    if (resident && resident.model.id !== job.model.id) await release('swap');
    if (resident) return resident.engine;
    if (!deps.fake && deps.freeMemory() < job.model.requiredMemoryBytes) {
      throw new AiError('too-little-memory');
    }
    activity = 'loading';
    const bytes = totalBytes(job.model);
    emit({ id: job.id, kind: 'step', step: 'loading', done: bytes, total: bytes });
    note({ type: 'loading', model: job.model.id });
    const engine = deps.engines[job.model.id]!(files);
    try {
      await engine.load(job.abort.signal);
      if (job.abort.signal.aborted) throw new AiError('cancelled');
    } catch (error) {
      await engine.dispose().catch(() => undefined);
      throw error;
    }
    resident = { model: job.model, engine };
    note({ type: 'loaded', model: job.model.id });
    return engine;
  }

  /**
   * A page's reading is kept under its cache key (docs/plan/AI-SYSTEM.md D4), so reading the same
   * file again, or summarising what was read, never touches an image twice. A cached page is
   * answered without loading the model. Only a page that was read is kept: a failed one is tried again.
   */
  const pageKey = (task: AiTask, modelId: string): string | null =>
    task.kind === 'read-page'
      ? cacheKey({
          fileSha256: task.fileSha256,
          page: task.page,
          pipelineVersion: PAGE_PIPELINE_VERSION,
          modelId,
          settings: { longEdge: task.longEdge, turn: task.turn, language: task.language },
        })
      : null;

  async function execute(job: Job): Promise<void> {
    const { id } = job;
    try {
      const key = pageKey(job.task, job.model.id);
      const hit = key ? await deps.cache.get<string>(key) : undefined;
      if (hit !== undefined) {
        emit({ id, kind: 'text', mode: 'replace', text: hit });
        emit({ id, kind: 'done', warnings: [], seconds: 0 });
        return;
      }
      const files = await ensureFiles(job);
      if (job.abort.signal.aborted) throw new AiError('cancelled');
      const engine = await makeResident(job, files);
      activity = 'working';
      note({ type: 'start', model: job.model.id, id });
      const started = Date.now();
      try {
        let last = '';
        const result = await engine.run(
          job.task,
          (event) => {
            if (event.kind === 'text' && event.mode === 'replace') last = event.text;
            emit({ id, ...event } as AiEvent);
          },
          job.abort.signal,
        );
        if (job.abort.signal.aborted) throw new AiError('cancelled');
        if (key && readPageKept(last)) await deps.cache.set(key, last);
        emit({
          id,
          kind: 'done',
          warnings: result.warnings,
          seconds: (Date.now() - started) / 1000,
        });
      } finally {
        note({ type: 'end', model: job.model.id, id });
      }
    } catch (error) {
      const problem: AiProblem =
        error instanceof AiError
          ? error.problem
          : error instanceof Error && error.name === 'AbortError'
            ? 'cancelled'
            : 'failed';
      // An engine that could not carry on is not trusted with the next task.
      if (problem === 'cannot-start') await release('crashed');
      emit({ id, kind: 'error', problem });
    }
  }

  function takeNext(): Job | undefined {
    let best: Job | undefined;
    for (const job of queue) {
      if (
        !best ||
        job.priority > best.priority ||
        (job.priority === best.priority && job.seq < best.seq)
      ) {
        best = job;
      }
    }
    if (best) queue = queue.filter((job) => job !== best);
    return best;
  }

  async function pump(): Promise<void> {
    if (running) return;
    const job = takeNext();
    if (!job) {
      armIdle();
      return;
    }
    clearTimeout(idleTimer);
    running = job;
    activity = 'loading';
    try {
      await execute(job);
    } finally {
      running = null;
      activity = 'idle';
      armIdle();
      void pump();
    }
  }

  // --- tasks -----------------------------------------------------------------------------

  /**
   * The model for a capability: the person's choice if it is installed and can do it; else the
   * best one installed (the registry is best first); else the one that suits this computer, so the
   * answer is `not-installed` for the model the list recommends. Evaluation-only only if nothing
   * else exists.
   */
  async function modelForCapability(
    capability: ReturnType<typeof capabilityOf>,
  ): Promise<ModelManifest | undefined> {
    const candidates = registry.filter(
      (m) => m.capabilities.includes(capability) && deps.engines[m.id] !== undefined,
    );
    const usable = candidates.filter((m) => !m.evaluationOnly);
    const pool = usable.length > 0 ? usable : candidates;
    const chosen = (await readSelection()) ?? '';
    const picked = pool.find((m) => m.id === chosen);
    if (deps.fake) return picked ?? pool[0];
    const ctx = await context();
    const there = async (m: ModelManifest) =>
      (await locateModel(m, ctx)).every((item) => item.found !== null || item.file.optional);
    if (picked && (await there(picked))) return picked;
    for (const m of pool) if (await there(m)) return m;
    return pool.find((m) => m.id === recommended()) ?? pool[0];
  }

  const modelFor = (task: AiTask) => modelForCapability(capabilityOf(task));

  // --- the person's choice ---------------------------------------------------------------

  async function readSelection(): Promise<string | null> {
    return readFile(selectionFile, 'utf8')
      .then((text) => {
        const id = (JSON.parse(text) as { selected?: unknown }).selected;
        return typeof id === 'string' ? id : null;
      })
      .catch(() => null);
  }

  async function select(modelId: string | null): Promise<AiStatus> {
    if (modelId === null) await rm(selectionFile, { force: true });
    else if (modelById(modelId) && deps.engines[modelId]) {
      await mkdir(deps.dir, { recursive: true });
      await writeFile(selectionFile, JSON.stringify({ selected: modelId }), 'utf8');
    }
    return status();
  }

  const recommended = (): string | null =>
    recommendModel(registry, {
      totalBytes: deps.totalMemory?.() ?? deps.freeMemory(),
      freeBytes: deps.freeMemory(),
    });

  async function run(
    id: string,
    task: AiTask,
    options: { priority?: number } = {},
  ): Promise<AiStart> {
    if (activity === 'downloading' || (activity === 'verifying' && !running)) {
      return { ok: false, problem: 'busy' };
    }
    if (id === '' || id.startsWith('install')) return { ok: false, problem: 'failed' };
    if (running?.id === id || queue.some((job) => job.id === id)) {
      return { ok: false, problem: 'failed' };
    }
    const model = await modelFor(task);
    if (!model) return { ok: false, problem: 'not-available' };
    if (!deps.fake) {
      const located = await locateModel(model, await context());
      if (located.some((item) => item.found === null))
        return { ok: false, problem: 'not-installed' };
      // The memory the model needs is only needed while it is loaded; a different model being
      // loaded now will be gone by the time this one's turn comes.
      if (!resident && !running && deps.freeMemory() < model.requiredMemoryBytes) {
        return { ok: false, problem: 'too-little-memory' };
      }
    }
    clearTimeout(idleTimer);
    const job: Job = {
      id,
      task,
      model,
      priority: options.priority ?? PRIORITY.normal,
      seq: sequence++,
      abort: new AbortController(),
    };
    queue.push(job);
    if (running || queue.length > 1) {
      emit({ id, kind: 'queued', position: queue.length + (running ? 1 : 0) - 1 });
    }
    // After this returns, so the caller has the id before the first event with it.
    setImmediate(() => void pump());
    return { ok: true, id };
  }

  async function cancel(id: string): Promise<void> {
    if (running?.id === id) {
      running.abort.abort();
      return;
    }
    const waiting = queue.find((job) => job.id === id);
    if (waiting) {
      queue = queue.filter((job) => job !== waiting);
      waiting.abort.abort();
      emit({ id, kind: 'error', problem: 'cancelled' });
      return;
    }
    if (id.startsWith('install')) installAbort?.abort();
  }

  // --- getting and forgetting files ------------------------------------------------------

  async function install(modelId: string, consent: AiConsent): Promise<AiStart> {
    const model = modelById(modelId);
    if (!model) return { ok: false, problem: 'failed' };
    if (!isDownloadable(model)) return { ok: false, problem: 'download-unavailable' };
    // What the person agreed to must be exactly what would be fetched: host, files, total size.
    if (!consentMatches(model, consent)) return { ok: false, problem: 'consent-required' };
    if (activity !== 'idle') return { ok: false, problem: 'busy' };

    const todo = (await locateModel(model, await context()))
      .filter((item) => item.found === null && !item.file.optional)
      .map((item) => item.file);
    const modelTotal = todo.reduce((sum, file) => sum + file.bytes, 0);

    // Room first: what is still to fetch, less what an earlier attempt already left, and a margin.
    await mkdir(deps.dir, { recursive: true });
    let left = modelTotal;
    for (const file of todo) {
      left -= (await stat(join(deps.dir, `${file.name}.partial`)).catch(() => null))?.size ?? 0;
    }
    const room = await freeDisk(deps.dir);
    if (room !== null && room < left + DISK_MARGIN_BYTES) {
      return { ok: false, problem: 'no-disk-space' };
    }

    activity = 'downloading';
    installAbort = new AbortController();
    const signal = installAbort.signal;
    const id = installId(modelId);
    // The consent is kept: when, what, from where. Never the content of any document.
    await appendFile(
      consentLog,
      `${JSON.stringify({ at: new Date().toISOString(), modelId, ...consent })}\n`,
      'utf8',
    ).catch(() => undefined);
    void (async () => {
      try {
        let before = 0;
        let speed = 0;
        let last = { at: Date.now(), done: 0 };
        for (const [index, file] of todo.entries()) {
          const path = await downloadFile({
            file,
            dir: deps.dir,
            fetch: deps.fetch,
            signal,
            allowHost: isAllowedHost,
            onProgress: (p) => {
              const done = before + p.done;
              const now = Date.now();
              if (now - last.at >= 500 && done > last.done) {
                const instant = ((done - last.done) * 1000) / (now - last.at);
                speed = speed === 0 ? instant : speed * 0.7 + instant * 0.3;
                last = { at: now, done };
              }
              emit({
                id,
                kind: 'install',
                modelId,
                file: index + 1,
                files: todo.length,
                ...p,
                modelDone: done,
                modelTotal,
                bytesPerSecond: Math.round(speed),
                etaSeconds: speed > 0 ? Math.round((modelTotal - done) / speed) : null,
              });
            },
          });
          before += file.bytes;
          // The hash was checked against the manifest while the bytes arrived: it counts as verified.
          verified.set(path, await keyOf(path));
          damaged.delete(path);
        }
        activity = 'idle';
        emit({ id, kind: 'installed', modelId, status: await status() });
      } catch (error) {
        activity = 'idle';
        const problem: AiProblem = signal.aborted
          ? 'cancelled'
          : error instanceof WeightsError && error.failure === 'unpublished'
            ? 'download-unavailable'
            : 'download-failed';
        emit({ id, kind: 'install-failed', modelId, problem });
      } finally {
        installAbort = null;
      }
    })();
    return { ok: true, id };
  }

  async function openFromDisk(modelId: string): Promise<AiStart> {
    const model = modelById(modelId);
    if (!model) return { ok: false, problem: 'failed' };
    if (activity !== 'idle') return { ok: false, problem: 'busy' };
    const chosen = await deps.chooseFile();
    if (!chosen) return { ok: false, problem: 'cancelled' };

    activity = 'verifying';
    installAbort = new AbortController();
    const signal = installAbort.signal;
    const id = installId(modelId);
    void (async () => {
      const fail = (problem: AiProblem) => {
        activity = 'idle';
        emit({ id, kind: 'install-failed', modelId, problem });
      };
      try {
        // A pack: PACK.json, or any part of one. Its folder is joined and checked against the
        // manifest in code, fully offline (ADR 0026 decision 8).
        if (basename(chosen) === PACK_FILE || /\.part\d+$/i.test(chosen)) {
          const hashed = model.files.filter(
            (f): f is typeof f & { sha256: string } => f.sha256 !== undefined,
          );
          const modelTotal = hashed.reduce((sum, f) => sum + f.bytes, 0);
          const paths = await installFromFolder(hashed, dirname(chosen), deps.dir, {
            signal,
            onProgress: (file, files, p) =>
              emit({
                id,
                kind: 'install',
                modelId,
                file,
                files,
                ...p,
                modelDone: hashed.slice(0, file - 1).reduce((sum, f) => sum + f.bytes, 0) + p.done,
                modelTotal,
                bytesPerSecond: 0,
                etaSeconds: null,
              }),
          });
          // The join hashed every byte against the manifest's own hash: it counts as verified.
          for (const path of paths) {
            verified.set(path, await keyOf(path));
            damaged.delete(path);
          }
          activity = 'idle';
          emit({ id, kind: 'installed', modelId, status: await status() });
          return;
        }
        const info = await stat(chosen);
        const candidates = model.files.filter((file) => file.bytes === info.size);
        let match: ModelFile | undefined;
        for (const file of candidates) {
          if (file.sha256 === undefined) {
            // Nothing to hash against: the name has to agree with the manifest's.
            if (fileNames(file).includes(basename(chosen))) match = file;
          } else if (
            (await sha256File(chosen, {
              signal,
              onBytes: (done) =>
                emit({
                  id,
                  kind: 'install',
                  modelId,
                  file: 1,
                  files: 1,
                  phase: 'verify',
                  done,
                  total: file.bytes,
                  modelDone: done,
                  modelTotal: file.bytes,
                  bytesPerSecond: 0,
                  etaSeconds: null,
                }),
            })) === file.sha256
          ) {
            match = file;
          }
          if (match) break;
        }
        if (!match) return fail('not-a-model-file');
        await remember(match.name, chosen);
        if (match.sha256 !== undefined) verified.set(chosen, await keyOf(chosen));
        damaged.delete(chosen);
        activity = 'idle';
        emit({ id, kind: 'installed', modelId, status: await status() });
      } catch (error) {
        fail(
          signal.aborted
            ? 'cancelled'
            : error instanceof PackError
              ? error.failure === 'missing'
                ? 'not-installed'
                : error.failure === 'io'
                  ? 'failed'
                  : 'damaged'
              : 'failed',
        );
      } finally {
        installAbort = null;
      }
    })();
    return { ok: true, id };
  }

  async function remove(modelId: string): Promise<AiStatus> {
    const model = modelById(modelId);
    if (model && activity === 'idle') {
      if (resident?.model.id === model.id) await release('remove');
      const ours = resolve(deps.dir) + sep;
      for (const { file, found } of await locateModel(model, await context())) {
        // A file Loppa downloaded is Loppa's to delete. One the person supplied, or that lives in
        // their checkout or LOPPA_AI_DIR, is theirs: it is only forgotten.
        if (found && resolve(found.path).startsWith(ours)) await rm(found.path, { force: true });
        if (found) {
          verified.delete(found.path);
          damaged.delete(found.path);
        }
        await remember(file.name, null);
      }
    }
    return status();
  }

  async function clearCache(): Promise<AiStatus> {
    await deps.cache.clear();
    return status();
  }

  async function close(): Promise<void> {
    installAbort?.abort();
    const waiting = queue;
    queue = [];
    for (const job of waiting) emit({ id: job.id, kind: 'error', problem: 'cancelled' });
    running?.abort.abort();
    await release('close');
  }

  return {
    status,
    install,
    select,
    openFromDisk,
    remove,
    run,
    cancel,
    clearCache,
    onEvent(listener) {
      eventListeners.add(listener);
      return () => void eventListeners.delete(listener);
    },
    onTransition(listener) {
      transitionListeners.add(listener);
      return () => void transitionListeners.delete(listener);
    },
    state: () => ({
      resident: resident?.model.id ?? null,
      running: running?.id ?? null,
      queued: [...queue].map((job) => job.id),
      activity,
    }),
    close,
  };
}
