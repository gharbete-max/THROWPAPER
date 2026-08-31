import { randomUUID } from 'node:crypto';
import type {
  AuditEntryInput,
  AuditEntryRecord,
  EventCreate,
  EventRecord,
  EventUpdate,
  FormCreate,
  FormRecord,
  FormUpdate,
  FormVersionRecord,
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
  forms: FormRecord[];
  formVersions: FormVersionRecord[];
  audit: AuditEntryRecord[];
}

function copyEvent(event: EventRecord): EventRecord {
  return { ...event, name: { ...event.name }, description: { ...event.description } };
}

function copyForm(form: FormRecord): FormRecord {
  return {
    ...form,
    title: { ...form.title },
    draftDefinition: structuredClone(form.draftDefinition),
  };
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
    forms: seed.forms ?? [],
    formVersions: seed.formVersions ?? [],
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

    forms: {
      // Copy on read and replace on update, for the same reason events do — an aliased row makes
      // the audit log's "before" silently become the "after".
      list: async (organisationId) =>
        state.forms.filter((f) => f.organisationId === organisationId).map(copyForm),
      findById: async (organisationId, id) => {
        const form = state.forms.find((f) => f.organisationId === organisationId && f.id === id);
        return form ? copyForm(form) : null;
      },
      findBySlug: async (organisationId, slug) => {
        const form = state.forms.find(
          (f) => f.organisationId === organisationId && f.slug === slug,
        );
        return form ? copyForm(form) : null;
      },
      create: async (input: FormCreate) => {
        const now = new Date();
        const record: FormRecord = {
          ...input,
          status: input.status ?? 'draft',
          id: randomUUID(),
          publishedVersionId: null,
          publishedVersion: null,
          createdAt: now,
          updatedAt: now,
        };
        state.forms.push(record);
        return copyForm(record);
      },
      update: async (organisationId, id, patch: FormUpdate) => {
        const index = state.forms.findIndex(
          (f) => f.organisationId === organisationId && f.id === id,
        );
        const existing = state.forms[index];
        if (!existing) return null;
        const updated: FormRecord = { ...existing, ...patch, updatedAt: new Date() };
        state.forms[index] = updated;
        return copyForm(updated);
      },

      listVersions: async (formId) =>
        state.formVersions
          .filter((v) => v.formId === formId)
          .sort((a, b) => b.version - a.version)
          .map((v) => ({ ...v })),
      findVersion: async (formId, version) => {
        const found = state.formVersions.find((v) => v.formId === formId && v.version === version);
        return found ? { ...found } : null;
      },
      createVersion: async (input) => {
        const highest = state.formVersions
          .filter((v) => v.formId === input.formId)
          .reduce((max, v) => Math.max(max, v.version), 0);
        const record: FormVersionRecord = {
          id: randomUUID(),
          formId: input.formId,
          version: highest + 1,
          definition: input.definition,
          publishedAt: new Date(),
          translationOverride: input.translationOverride,
          createdAt: new Date(),
        };
        state.formVersions.push(record);
        return { ...record };
      },
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
