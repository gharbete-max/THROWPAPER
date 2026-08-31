import { randomUUID } from 'node:crypto';
import type {
  AuditEntryInput,
  AuditEntryRecord,
  EventCreate,
  EventRecord,
  EventUpdate,
  LoginTokenRecord,
  OrganisationRecord,
  Repositories,
  RefreshTokenRecord,
  UserRecord,
} from './types.js';

/**
 * In-memory repositories, used by the tests.
 *
 * Docker is not a prerequisite for `pnpm verify` on a developer machine, so the rules that matter
 * — token rotation, reuse detection, single-use magic links, role checks, capacity — are proved
 * here. CI additionally runs the Drizzle implementation against a real Postgres.
 */
export interface MemoryState {
  organisations: OrganisationRecord[];
  users: UserRecord[];
  loginTokens: LoginTokenRecord[];
  refreshTokens: RefreshTokenRecord[];
  events: EventRecord[];
  audit: AuditEntryRecord[];
}

function copyEvent(event: EventRecord): EventRecord {
  return { ...event, name: { ...event.name }, description: { ...event.description } };
}

export function createMemoryRepositories(
  seed: Partial<MemoryState> = {},
): Repositories & { state: MemoryState } {
  const state: MemoryState = {
    organisations: seed.organisations ?? [],
    users: seed.users ?? [],
    loginTokens: seed.loginTokens ?? [],
    refreshTokens: seed.refreshTokens ?? [],
    events: seed.events ?? [],
    audit: seed.audit ?? [],
  };

  return {
    state,

    organisations: {
      findById: async (id) => state.organisations.find((o) => o.id === id) ?? null,
      first: async () => state.organisations[0] ?? null,
    },

    users: {
      findByEmail: async (organisationId, email) =>
        state.users.find(
          (u) => u.organisationId === organisationId && u.email === email.toLowerCase(),
        ) ?? null,
      findById: async (id) => state.users.find((u) => u.id === id) ?? null,
    },

    tokens: {
      createLoginToken: async (input) => {
        const record: LoginTokenRecord = {
          id: randomUUID(),
          userId: input.userId,
          tokenHash: input.tokenHash,
          redirectTo: input.redirectTo,
          expiresAt: input.expiresAt,
          consumedAt: null,
        };
        state.loginTokens.push(record);
        return record;
      },
      findLoginTokenByHash: async (tokenHash) =>
        state.loginTokens.find((t) => t.tokenHash === tokenHash) ?? null,
      consumeLoginToken: async (id, at) => {
        const token = state.loginTokens.find((t) => t.id === id);
        if (!token || token.consumedAt) return false;
        token.consumedAt = at;
        return true;
      },

      createRefreshToken: async (input) => {
        const record: RefreshTokenRecord = {
          id: randomUUID(),
          userId: input.userId,
          familyId: input.familyId,
          tokenHash: input.tokenHash,
          expiresAt: input.expiresAt,
          revokedAt: null,
        };
        state.refreshTokens.push(record);
        return record;
      },
      findRefreshTokenByHash: async (tokenHash) =>
        state.refreshTokens.find((t) => t.tokenHash === tokenHash) ?? null,
      revokeRefreshToken: async (id, at) => {
        const token = state.refreshTokens.find((t) => t.id === id);
        if (token && !token.revokedAt) token.revokedAt = at;
      },
      revokeFamily: async (familyId, at) => {
        for (const token of state.refreshTokens) {
          if (token.familyId === familyId && !token.revokedAt) token.revokedAt = at;
        }
      },
    },

    events: {
      // Reads hand back copies and updates replace rather than mutate, so a caller holding an
      // earlier result keeps a true snapshot — exactly as it would with rows from Postgres.
      // Aliasing here would let the audit log's "before" silently become the "after".
      list: async (organisationId) =>
        state.events
          .filter((e) => e.organisationId === organisationId)
          .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
          .map(copyEvent),
      findById: async (organisationId, id) => {
        const event = state.events.find((e) => e.organisationId === organisationId && e.id === id);
        return event ? copyEvent(event) : null;
      },
      create: async (input: EventCreate) => {
        const now = new Date();
        const record: EventRecord = { ...input, id: randomUUID(), createdAt: now, updatedAt: now };
        state.events.push(record);
        return copyEvent(record);
      },
      update: async (organisationId, id, patch: EventUpdate) => {
        const index = state.events.findIndex(
          (e) => e.organisationId === organisationId && e.id === id,
        );
        const existing = state.events[index];
        if (!existing) return null;
        const updated: EventRecord = { ...existing, ...patch, updatedAt: new Date() };
        state.events[index] = updated;
        return copyEvent(updated);
      },
      countRegistrations: async () => 0,
    },

    audit: {
      record: async (entry: AuditEntryInput) => {
        state.audit.push({ ...entry, id: randomUUID(), at: new Date() });
      },
      list: async (organisationId) =>
        state.audit.filter((entry) => entry.organisationId === organisationId),
    },
  };
}
