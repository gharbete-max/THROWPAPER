/**
 * The Forms window's bridges to the AI coordinator: `window.loppaAi` (ADR 0024) and, over the same
 * coordinator, `window.loppaModel` (ADR 0023), and nothing else.
 *
 * Bundled to CommonJS by `scripts/build.ts` as `model-preload.cjs`, because a sandboxed preload
 * cannot be an ES module. The hosted edition has no such preload, so a pane finds no bridge and
 * says "Not in this edition". See `ai-ipc.ts` and `model-ipc.ts` for who is answered.
 */
import { contextBridge, ipcRenderer } from 'electron';
import type { AiBridge, AiEvent } from '@tp/shared/ai';
import type { ModelBridge, ModelEvent } from '@tp/shared/summary';
import { AI_CHANNELS, MODEL_CHANNELS } from './channels.js';

const ai: AiBridge = {
  status: () => ipcRenderer.invoke(AI_CHANNELS.status),
  install: (modelId, consent) => ipcRenderer.invoke(AI_CHANNELS.install, modelId, consent),
  select: (modelId) => ipcRenderer.invoke(AI_CHANNELS.select, modelId),
  openFromDisk: (modelId) => ipcRenderer.invoke(AI_CHANNELS.openFromDisk, modelId),
  remove: (modelId) => ipcRenderer.invoke(AI_CHANNELS.remove, modelId),
  run: (id, task) => ipcRenderer.invoke(AI_CHANNELS.run, id, task),
  cancel: (id) => ipcRenderer.invoke(AI_CHANNELS.cancel, id),
  clearCache: () => ipcRenderer.invoke(AI_CHANNELS.clearCache),
  onEvent(listener) {
    const forward = (_event: unknown, payload: AiEvent) => listener(payload);
    ipcRenderer.on(AI_CHANNELS.event, forward);
    return () => {
      ipcRenderer.removeListener(AI_CHANNELS.event, forward);
    };
  },
};

const model: ModelBridge = {
  status: () => ipcRenderer.invoke(MODEL_CHANNELS.status),
  install: () => ipcRenderer.invoke(MODEL_CHANNELS.install),
  openFromDisk: () => ipcRenderer.invoke(MODEL_CHANNELS.openFromDisk),
  remove: () => ipcRenderer.invoke(MODEL_CHANNELS.remove),
  start: (id, job) => ipcRenderer.invoke(MODEL_CHANNELS.start, id, job),
  cancel: (id) => ipcRenderer.invoke(MODEL_CHANNELS.cancel, id),
  onEvent(listener) {
    const forward = (_event: unknown, payload: ModelEvent) => listener(payload);
    ipcRenderer.on(MODEL_CHANNELS.event, forward);
    return () => {
      ipcRenderer.removeListener(MODEL_CHANNELS.event, forward);
    };
  },
};

contextBridge.exposeInMainWorld('loppaAi', ai);
contextBridge.exposeInMainWorld('loppaModel', model);
