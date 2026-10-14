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

/** The IPC channels of the generic AI bridge (`window.loppaAi`, ADR 0024). */
export const AI_CHANNELS = {
  status: 'loppa-ai:status',
  install: 'loppa-ai:install',
  openFromDisk: 'loppa-ai:open-from-disk',
  remove: 'loppa-ai:remove',
  run: 'loppa-ai:run',
  cancel: 'loppa-ai:cancel',
  clearCache: 'loppa-ai:clear-cache',
  event: 'loppa-ai:event',
} as const;
