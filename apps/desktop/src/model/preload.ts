/**
 * The Forms window's bridge to the model service: `window.loppaModel`, and nothing else.
 *
 * Bundled to CommonJS by `scripts/build.ts`, because a sandboxed preload cannot be an ES module.
 * The hosted edition has no such preload, so the pane finds no bridge and says "Not in this
 * edition". See `ipc.ts` for who is answered.
 */
import { contextBridge, ipcRenderer } from 'electron';
import type { ModelBridge, ModelEvent } from '@tp/shared/summary';
import { MODEL_CHANNELS } from './channels.js';

const bridge: ModelBridge = {
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

contextBridge.exposeInMainWorld('loppaModel', bridge);
