import type { ContractRegistry } from '@tp/shared/contract';

/**
 * What this app owes docs/CONTRACT.md §2. Validated by `pnpm contract:check`.
 * Deferred is a legitimate state — it must name the phase that picks it up.
 */
export const registry: ContractRegistry = {
  app: '@tp/api-forms',
  side: 'formwork',
  entries: [
    { id: 'audiences.pull', status: 'deferred', plannedPhase: 'B7 — dynamic audiences' },
    { id: 'delivery.webhook', status: 'deferred', plannedPhase: '4 — documents and email' },
  ],
};
