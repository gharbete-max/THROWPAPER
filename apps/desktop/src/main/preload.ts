/**
 * The panel window's bridge — and only the panel's. See `bridge.ts` for why the main window has none.
 *
 * Bundled to CommonJS by `scripts/build.ts`, because a sandboxed preload cannot be an ES module
 * and may `require` nothing but Electron.
 */
import { contextBridge, ipcRenderer } from 'electron';
import { CHANNELS, type LoppaBridge } from '../bridge.js';

const bridge: LoppaBridge = {
  state: () => ipcRenderer.invoke(CHANNELS.state),
  bootstrap: (owner) => ipcRenderer.invoke(CHANNELS.bootstrap, owner),
  loadDemo: () => ipcRenderer.invoke(CHANNELS.loadDemo),
  saveSettings: (form) => ipcRenderer.invoke(CHANNELS.saveSettings, form),
  closePanel: () => ipcRenderer.send(CHANNELS.closePanel),
};

contextBridge.exposeInMainWorld('loppa', bridge);
