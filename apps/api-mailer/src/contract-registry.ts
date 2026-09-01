import type { ContractRegistry } from '@tp/shared/contract';

/**
 * Sendwork is a later product (START-HERE.md §About the parallel tracks).
 *
 * Phase 4 built the transactional sending path **inside Formwork**, not here — so `messages.send`
 * moved from "phase 4" to B6. Leaving it pointing at phase 4 would have made `pnpm contract:check`
 * document something that is no longer true.
 */
export const registry: ContractRegistry = {
  app: '@tp/api-mailer',
  side: 'sendwork',
  entries: [
    { id: 'messages.send', status: 'deferred', plannedPhase: 'B6 — transactional templates' },
    { id: 'contacts.upsert', status: 'deferred', plannedPhase: 'B2 — contacts' },
    { id: 'audiences.push', status: 'deferred', plannedPhase: 'B7 — dynamic audiences' },
    { id: 'templates.list', status: 'deferred', plannedPhase: 'B6 — transactional templates' },
  ],
};
