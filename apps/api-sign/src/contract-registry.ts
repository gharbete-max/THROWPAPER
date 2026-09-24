import type { ContractRegistry } from '@tp/shared/contract';

/**
 * Sign is the third product (`docs/adr/0009-where-signing-lives.md`). P1c-1 implemented creating an
 * envelope and reading where it stands; P1c-2 the sealed PDF.
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
    { id: 'envelopes.sealed', status: 'implemented' },
    { id: 'declarations.list', status: 'implemented' },
    { id: 'declarations.write', status: 'implemented' },
    { id: 'identity.methods', status: 'implemented' },
    { id: 'identity.start', status: 'implemented' },
    { id: 'identity.result', status: 'implemented' },
  ],
};
