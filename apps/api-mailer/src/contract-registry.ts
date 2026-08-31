import type { ContractRegistry } from '@tp/shared/contract';

/**
 * Sendwork is a later product (START-HERE.md §About the parallel tracks). v0.1 gets a thin
 * transactional sending path only, which is why messages.send lands in phase 4 and the rest wait.
 */
export const registry: ContractRegistry = {
  app: '@tp/api-mailer',
  side: 'sendwork',
  entries: [
    { id: 'messages.send', status: 'deferred', plannedPhase: '4 — documents and email' },
    { id: 'contacts.upsert', status: 'deferred', plannedPhase: 'B2 — contacts' },
    { id: 'audiences.push', status: 'deferred', plannedPhase: 'B7 — dynamic audiences' },
    { id: 'templates.list', status: 'deferred', plannedPhase: 'B6 — transactional templates' },
  ],
};
