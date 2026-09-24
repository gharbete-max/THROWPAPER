import { usePglite } from '../test-database.js';

/**
 * The whole of `envelopes.test.ts` again, on PGlite — the database the desktop edition runs Sign
 * on (ADR 0016). Same routes, same store, same append-only triggers: if the embedded database
 * weakened any guarantee, a test written against real Postgres fails here.
 */
usePglite();
await import('./envelopes.test.js');
