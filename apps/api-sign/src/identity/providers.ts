import { randomUUID } from 'node:crypto';
import type {
  IdentityProvider,
  IdentityResult,
  IdentitySession,
  SignHashRequest,
} from '@tp/signing';
import { maxLevelFor } from '@tp/signing';

/**
 * The identity providers this Sign offers (CONTRACT §5.6, ADR 0010).
 *
 * **None, unless configured.** A national eID (BankID, MitID, Freja…) comes through a broker, and
 * choosing the broker is the owner's decision; until then this list is empty and every caller is
 * told so — Forms then finishes a form without the optional step, and says why.
 *
 * `EID_PROVIDER=console` adds the development provider, outside production only. It confirms
 * nobody: it answers "complete" at once, as `environment: "test"`, with the method `console`
 * (level `simple`) and a name that says what it is. It exists so the path from a form to a
 * confirmation and back can be built and tested before a real provider is chosen — never so that a
 * test result can look like a real one.
 */
export function identityProvidersFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  log: (message: string) => void = () => {},
): IdentityProvider[] {
  const chosen = env['EID_PROVIDER']?.trim();
  if (!chosen) return [];
  if (chosen === 'console') {
    if (env['NODE_ENV'] === 'production') {
      throw new Error(
        'EID_PROVIDER=console is the development identity provider and cannot run in production.',
      );
    }
    return [createConsoleIdentityProvider(log)];
  }
  throw new Error(`EID_PROVIDER=${chosen} is not a provider this Sign knows. Leave it unset.`);
}

/** A confirmation it made, and what it confirmed. Held in memory: it is a test double. */
interface ConsoleSession {
  documentSha256: string;
}

export const CONSOLE_IDENTITY_NAME = 'Test Person (console provider, not a real identity)';

export function createConsoleIdentityProvider(
  log: (message: string) => void = () => {},
): IdentityProvider & { documentFor(reference: string): string | null } {
  const sessions = new Map<string, ConsoleSession>();
  const byKey = new Map<string, string>();

  return {
    name: 'console',
    environment: 'test',
    methods: ['console'],

    async sign(request: SignHashRequest): Promise<IdentitySession> {
      // One session per idempotency key: a retry does not start a second confirmation.
      const known = byKey.get(request.idempotencyKey);
      if (known) return { reference: known, status: 'complete' };
      const reference = randomUUID();
      sessions.set(reference, { documentSha256: request.documentSha256 });
      byKey.set(request.idempotencyKey, reference);
      log(
        `[console identity] NOT A REAL IDENTITY CHECK — "confirmed" ${request.documentSha256.slice(0, 12)}… as test`,
      );
      return { reference, status: 'complete' };
    },

    async result(reference: string): Promise<IdentityResult> {
      const session = sessions.get(reference);
      if (!session) return { reference, status: 'failed', environment: 'test' };
      return {
        reference,
        status: 'complete',
        environment: 'test',
        method: 'console',
        level: maxLevelFor('console'),
        assertion: { name: CONSOLE_IDENTITY_NAME },
      };
    },

    documentFor(reference: string) {
      return sessions.get(reference)?.documentSha256 ?? null;
    },
  };
}
