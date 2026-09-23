import type { ContractRegistry } from '@tp/shared/contract';

/**
 * Sign is the third product (`docs/adr/0009-where-signing-lives.md`). P1b is its skeleton; the
 * envelope endpoints arrive with sealing and persistence in P1c, and `pnpm contract:check` holds
 * that date here rather than in anybody's memory.
 */
export const registry: ContractRegistry = {
  app: '@tp/api-sign',
  side: 'signwork',
  entries: [
    {
      id: 'envelopes.create',
      status: 'deferred',
      plannedPhase: 'P1c — sealing and the audit trail',
    },
    { id: 'envelopes.get', status: 'deferred', plannedPhase: 'P1c — sealing and the audit trail' },
    {
      id: 'envelopes.sealed',
      status: 'deferred',
      plannedPhase: 'P1c — sealing and the audit trail',
    },
  ],
};
