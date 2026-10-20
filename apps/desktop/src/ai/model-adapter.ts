import {
  TEXT_MODEL,
  installId,
  type AiEvent,
  type AiModelStatus,
  type AiProblem,
  type AiStart,
  type AiStatus,
} from '@tp/shared/ai';
import type {
  ModelEvent,
  ModelJob,
  ModelProblem,
  ModelStatus,
  StartResult,
} from '@tp/shared/summary';
import type { Coordinator } from './coordinator.js';

/**
 * `window.loppaModel` (ADR 0023) as a thin adapter over the coordinator (ADR 0024): the same
 * seven calls and the same events the summary centre has always had, answered by the one model
 * that has the `text` capability. It keeps nothing of its own except which job ids are the
 * pane's, so a task another window runs through `window.loppaAi` does not appear on this channel.
 *
 * Two differences from the single-model service it replaces, both invisible to the pane: a job
 * that arrives while another runs is still refused with `busy` (the coordinator would queue it),
 * and a download is always consented to (the pane has asked first, `bridge.ts`).
 * It is removed when its callers have moved to `window.loppaAi`.
 */
export interface ModelService {
  status(): Promise<ModelStatus>;
  install(): Promise<StartResult>;
  openFromDisk(): Promise<StartResult>;
  remove(): Promise<ModelStatus>;
  start(id: string, job: ModelJob): Promise<StartResult>;
  cancel(id: string): Promise<void>;
  /** Ends the model. The app calls it on quit. */
  close(): Promise<void>;
}

const LEGACY_INSTALL = 'install' as const;

const toLegacyProblem = (problem: AiProblem): ModelProblem =>
  problem === 'not-available'
    ? 'cannot-start'
    : problem === 'consent-required'
      ? 'failed'
      : problem === 'no-disk-space'
        ? 'download-failed'
        : problem;

const toLegacyResult = (result: AiStart): StartResult =>
  result.ok ? result : { ok: false, problem: toLegacyProblem(result.problem) };

/** The pane knows one install, and calls it `install`. */
const asInstall = (result: StartResult): StartResult =>
  result.ok ? { ok: true, id: LEGACY_INSTALL } : result;

export function legacyStatus(status: AiStatus, modelId: string = TEXT_MODEL.id): ModelStatus {
  const model = status.models.find((m) => m.id === modelId) as AiModelStatus;
  const there = model.files.every((file) => file.hash !== 'missing');
  return {
    id: model.id,
    licence: model.licence,
    bytes: model.bytes,
    installed: there,
    location: model.files.find((file) => file.role === 'weights')?.path ?? null,
    verified: there && model.files.every((file) => file.hash === 'verified'),
    damaged: model.state === 'damaged',
    downloadBlocked: model.downloadBlocked,
    host: model.consent?.host ?? null,
    freeMemoryBytes: status.freeMemoryBytes,
    requiredMemoryBytes: model.requiredMemoryBytes,
    activity: status.activity,
  };
}

export function createModelAdapter(
  coordinator: Coordinator,
  options: { emit(event: ModelEvent): void; modelId?: string },
): ModelService {
  const fixed = options.modelId;
  /** The model the pane means: the one tasks go to now (the person's choice), unless one is fixed. */
  const current = async (): Promise<string> =>
    fixed ?? (await coordinator.status()).models.find((m) => m.selected)?.id ?? TEXT_MODEL.id;
  /** The jobs this adapter started: the only ones whose events are its to forward. */
  const mine = new Set<string>();

  coordinator.onEvent((event: AiEvent) => {
    if (event.id.startsWith('install:')) {
      if (event.kind === 'install') {
        options.emit({
          id: LEGACY_INSTALL,
          kind: 'install',
          phase: event.phase,
          done: event.done,
          total: event.total,
          ...(event.part === undefined ? {} : { part: event.part }),
          ...(event.parts === undefined ? {} : { parts: event.parts }),
        });
      } else if (event.kind === 'installed') {
        options.emit({
          id: LEGACY_INSTALL,
          kind: 'installed',
          status: legacyStatus(event.status, event.modelId),
        });
      } else if (event.kind === 'install-failed') {
        options.emit({
          id: LEGACY_INSTALL,
          kind: 'install-failed',
          problem: toLegacyProblem(event.problem),
        });
      }
      return;
    }
    if (!mine.has(event.id)) return;
    switch (event.kind) {
      case 'step':
      case 'text':
      case 'selected':
      case 'done':
        options.emit(event);
        break;
      case 'error':
        options.emit({ ...event, problem: toLegacyProblem(event.problem) });
        break;
      default:
        break;
    }
    if (event.kind === 'done' || event.kind === 'error') mine.delete(event.id);
  });

  const status = async () => legacyStatus(await coordinator.status(), await current());

  return {
    status,
    async install() {
      const id = await current();
      const consent = (await coordinator.status()).models.find((m) => m.id === id)?.consent;
      if (!consent) return { ok: false, problem: 'download-unavailable' };
      return asInstall(toLegacyResult(await coordinator.install(id, consent)));
    },
    openFromDisk: async () =>
      asInstall(toLegacyResult(await coordinator.openFromDisk(await current()))),
    async remove() {
      const id = await current();
      return legacyStatus(await coordinator.remove(id), id);
    },
    async start(id, job) {
      const { running, queued } = coordinator.state();
      if (running !== null || queued.length > 0) return { ok: false, problem: 'busy' };
      mine.add(id);
      const result = toLegacyResult(await coordinator.run(id, job));
      if (!result.ok) mine.delete(id);
      return result;
    },
    async cancel(id) {
      await coordinator.cancel(id === LEGACY_INSTALL ? installId(await current()) : id);
    },
    close: () => coordinator.close(),
  };
}
