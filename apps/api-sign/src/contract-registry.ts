import type { ContractRegistry } from '@tp/shared/contract';

/**
 * Sign is the third product (`docs/adr/0009-where-signing-lives.md`). P1c-1 implements creating an
 * envelope and reading where it stands; the sealed PDF arrives with sealing, P1c-2.
 *
 * "implemented" is a claim `pnpm contract:check` cannot see behind, so `server.test.ts` holds it
 * to account: every implemented entry must be a route this server actually serves.
 */
export const registry: ContractRegistry = {
  app: '@tp/api-sign',
  side: 'signwork',
  entries: [
    { id: 'envelopes.create', status: 'implemented' },
    { id: 'envelopes.get', status: 'implemented' },
    {
      id: 'envelopes.sealed',
      status: 'deferred',
      plannedPhase: 'P1c-2 — sealing',
    },
  ],
};
