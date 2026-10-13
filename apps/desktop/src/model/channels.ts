/** The IPC channels of the summary centre's bridge (`window.loppaModel`). */
export const MODEL_CHANNELS = {
  status: 'loppa-model:status',
  install: 'loppa-model:install',
  openFromDisk: 'loppa-model:open-from-disk',
  remove: 'loppa-model:remove',
  start: 'loppa-model:start',
  cancel: 'loppa-model:cancel',
  event: 'loppa-model:event',
} as const;
