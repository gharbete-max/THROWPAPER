/** The IPC channels of the summary centre's bridge (`window.loppaModel`, ADR 0023). */
export const MODEL_CHANNELS = {
  status: 'loppa-model:status',
  install: 'loppa-model:install',
  openFromDisk: 'loppa-model:open-from-disk',
  remove: 'loppa-model:remove',
  start: 'loppa-model:start',
  cancel: 'loppa-model:cancel',
  event: 'loppa-model:event',
} as const;

/** The IPC channels of the add-ons bridge (`window.loppaAddons`, ADR 0026 amended). */
export const ADDONS_CHANNELS = {
  status: 'loppa-addons:status',
  installProgram: 'loppa-addons:install-program',
  installPack: 'loppa-addons:install-pack',
  checkUpdate: 'loppa-addons:check-update',
  downloadInstaller: 'loppa-addons:download-installer',
  openInstaller: 'loppa-addons:open-installer',
  cancel: 'loppa-addons:cancel',
  event: 'loppa-addons:event',
} as const;

/** The IPC channels of the generic AI bridge (`window.loppaAi`, ADR 0024). */
export const AI_CHANNELS = {
  status: 'loppa-ai:status',
  install: 'loppa-ai:install',
  select: 'loppa-ai:select',
  openFromDisk: 'loppa-ai:open-from-disk',
  remove: 'loppa-ai:remove',
  run: 'loppa-ai:run',
  cancel: 'loppa-ai:cancel',
  clearCache: 'loppa-ai:clear-cache',
  useGraphics: 'loppa-ai:use-graphics',
  installGraphics: 'loppa-ai:install-graphics',
  clearGraphicsFailure: 'loppa-ai:clear-graphics-failure',
  event: 'loppa-ai:event',
} as const;
