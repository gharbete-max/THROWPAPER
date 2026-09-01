import type { ContractRegistry } from '@tp/shared/contract';

/**
 * What this app owes docs/CONTRACT.md §2. Validated by `pnpm contract:check`.
 * Deferred is a legitimate state — it must name the phase that picks it up.
 *
 * Phase 4 sends through Formwork's own provider rather than through Sendwork, so the delivery
 * webhook waits for Sendwork's bounce and complaint handling in B11. A deferral pointing at a
 * phase that has already shipped without it would be a lie the check happily repeats.
 */
export const registry: ContractRegistry = {
  app: '@tp/api-forms',
  side: 'formwork',
  entries: [
    { id: 'audiences.pull', status: 'deferred', plannedPhase: 'B7 — dynamic audiences' },
    { id: 'delivery.webhook', status: 'deferred', plannedPhase: 'B11 — delivery events' },
  ],
};
