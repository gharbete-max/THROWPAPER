import { randomUUID } from 'node:crypto';
import type {
  AuditEntryInput,
  CheckInRecord,
  UploadRecord,
  AuditEntryRecord,
  EventCreate,
  EventRecord,
  EventUpdate,
  FormCreate,
  FormRecord,
  FormUpdate,
  FormVersionRecord,
  BrandKitRecord,
  JobRecord,
  LoginTokenRecord,
  MessageRecord,
  SendingDomainRecord,
  SubmissionCompleteInput,
  SubmissionDraftInput,
  SubmissionRecord,
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
  submissions: SubmissionRecord[];
  checkIns: CheckInRecord[];
  uploads: UploadRecord[];
  jobs: JobRecord[];
  brandKits: BrandKitRecord[];
  sendingDomains: SendingDomainRecord[];
  messages: MessageRecord[];
  audit: AuditEntryRecord[];
}

function copyEvent(event: EventRecord): EventRecord {
  return { ...event, name: { ...event.name }, description: { ...event.description } };
}

function copySubmission(submission: SubmissionRecord): SubmissionRecord {
  return { ...submission, data: structuredClone(submission.data) };
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
    submissions: seed.submissions ?? [],
    checkIns: seed.checkIns ?? [],
    uploads: seed.uploads ?? [],
    jobs: seed.jobs ?? [],
    brandKits: seed.brandKits ?? [],
    sendingDomains: seed.sendingDomains ?? [],
    messages: seed.messages ?? [],
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
      countRegistrations: async (eventId) =>
        state.submissions.filter(
          (s) => s.eventId === eventId && s.status === 'complete' && s.revokedAt === null,
        ).length,
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

    submissions: {
      list: async (organisationId, formId) =>
        state.submissions
          .filter((s) => s.organisationId === organisationId && s.formId === formId)
          .map(copySubmission),
      findById: async (organisationId, submissionId) => {
        const found = state.submissions.find(
          (s) => s.organisationId === organisationId && s.id === submissionId,
        );
        return found ? copySubmission(found) : null;
      },

      listForEvent: async (organisationId, eventId) =>
        state.submissions
          .filter((s) => s.organisationId === organisationId && s.eventId === eventId)
          .map(copySubmission),

      findByResumeTokenHash: async (tokenHash) => {
        const found = state.submissions.find((s) => s.resumeTokenHash === tokenHash);
        return found ? copySubmission(found) : null;
      },
      countComplete: async (formId) =>
        state.submissions.filter((s) => s.formId === formId && s.status === 'complete').length,

      countCompleteByForm: async (organisationId, formIds) => {
        const wanted = new Set(formIds);
        const counts: Record<string, number> = {};
        for (const submission of state.submissions) {
          if (submission.organisationId !== organisationId) continue;
          if (submission.status !== 'complete') continue;
          if (!wanted.has(submission.formId)) continue;
          counts[submission.formId] = (counts[submission.formId] ?? 0) + 1;
        }
        return counts;
      },

      findByReference: async (organisationId, reference) => {
        const found = state.submissions.find(
          (s) =>
            s.organisationId === organisationId &&
            s.reference.toUpperCase() === reference.toUpperCase(),
        );
        return found ? copySubmission(found) : null;
      },

      revoke: async (organisationId, id, at) => {
        const index = state.submissions.findIndex(
          (s) => s.organisationId === organisationId && s.id === id,
        );
        const existing = state.submissions[index];
        if (!existing) return null;
        const updated: SubmissionRecord = { ...existing, revokedAt: at, updatedAt: new Date() };
        state.submissions[index] = updated;
        return copySubmission(updated);
      },

      saveDraft: async (input: SubmissionDraftInput) => {
        const existingIndex = input.id ? state.submissions.findIndex((s) => s.id === input.id) : -1;
        const existing = state.submissions[existingIndex];
        const now = new Date();

        if (existing) {
          const updated: SubmissionRecord = {
            ...existing,
            data: input.data,
            locale: input.locale,
            resumeTokenHash: input.resumeTokenHash,
            resumeExpiresAt: input.resumeExpiresAt,
            updatedAt: now,
          };
          state.submissions[existingIndex] = updated;
          return copySubmission(updated);
        }

        const record: SubmissionRecord = {
          id: randomUUID(),
          organisationId: input.organisationId,
          formId: input.formId,
          formVersionId: input.formVersionId,
          eventId: input.eventId,
          reference: input.reference,
          status: 'partial',
          locale: input.locale,
          email: null,
          data: input.data,
          resumeTokenHash: input.resumeTokenHash,
          resumeExpiresAt: input.resumeExpiresAt,
          submittedAt: null,
          revokedAt: null,
          createdAt: now,
          updatedAt: now,
        };
        state.submissions.push(record);
        return copySubmission(record);
      },

      /**
       * Check and write with no `await` between them.
       *
       * That is what makes the concurrency test meaningful here: if a handler ever grows a gap
       * between counting and inserting, two callers interleave and the test catches it. The
       * database-level guarantee is the Drizzle implementation's transaction; this fake can only
       * prove the handler has no check-then-act gap of its own.
       */
      complete: async (input: SubmissionCompleteInput) => {
        const email = input.email?.toLowerCase() ?? null;

        if (input.duplicateControl === 'email' && email) {
          const clash = state.submissions.some(
            (s) => s.formId === input.formId && s.status === 'complete' && s.email === email,
          );
          if (clash) return { ok: false as const, reason: 'duplicate' as const };
        }

        if (input.capacity !== null) {
          // Withdrawn registrations free their place — see the note in the Drizzle implementation.
          const taken = state.submissions.filter(
            (s) => s.formId === input.formId && s.status === 'complete' && s.revokedAt === null,
          ).length;
          if (taken >= input.capacity) return { ok: false as const, reason: 'full' as const };
        }

        const now = new Date();
        const existingIndex = input.id ? state.submissions.findIndex((s) => s.id === input.id) : -1;
        const existing = state.submissions[existingIndex];

        const record: SubmissionRecord = {
          id: existing?.id ?? randomUUID(),
          organisationId: input.organisationId,
          formId: input.formId,
          formVersionId: input.formVersionId,
          eventId: input.eventId,
          reference: existing?.reference ?? input.reference,
          status: 'complete',
          locale: input.locale,
          email,
          data: input.data,
          // The resume token dies with the draft it belonged to.
          resumeTokenHash: null,
          resumeExpiresAt: null,
          submittedAt: now,
          revokedAt: existing?.revokedAt ?? null,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        };

        if (existing) state.submissions[existingIndex] = record;
        else state.submissions.push(record);

        return { ok: true as const, submission: copySubmission(record) };
      },
    },

    uploads: {
      create: async (input) => {
        const record: UploadRecord = {
          id: randomUUID(),
          ...input,
          submissionId: null,
          createdAt: new Date(),
        };
        state.uploads.push(record);
        return { ...record };
      },

      findUnclaimed: async (formId, storageKeys) => {
        const wanted = new Set(storageKeys);
        return state.uploads
          .filter(
            (upload) =>
              upload.formId === formId &&
              upload.submissionId === null &&
              wanted.has(upload.storageKey),
          )
          .map((upload) => ({ ...upload }));
      },

      claim: async (ids, submissionId) => {
        const wanted = new Set(ids);
        for (const upload of state.uploads) {
          if (wanted.has(upload.id)) upload.submissionId = submissionId;
        }
      },

      listForSubmissions: async (organisationId, submissionIds) => {
        const wanted = new Set(submissionIds);
        return state.uploads
          .filter(
            (upload) =>
              upload.organisationId === organisationId &&
              upload.submissionId !== null &&
              wanted.has(upload.submissionId),
          )
          .map((upload) => ({ ...upload }));
      },

      findForDownload: async (organisationId, submissionId, storageKey) => {
        const found = state.uploads.find(
          (upload) =>
            upload.organisationId === organisationId &&
            upload.submissionId === submissionId &&
            upload.storageKey === storageKey,
        );
        return found ? { ...found } : null;
      },
    },

    checkIns: {
      listForEvent: async (organisationId, eventId) =>
        state.checkIns
          .filter((c) => c.organisationId === organisationId && c.eventId === eventId)
          .map((c) => ({ ...c })),
      findBySubmission: async (submissionId) => {
        const found = state.checkIns.find((c) => c.submissionId === submissionId);
        return found ? { ...found } : null;
      },
      // Find and insert with no `await` between them, mirroring the unique index in Postgres:
      // two simultaneous scans of one card produce one row.
      admit: async (input) => {
        const existing = state.checkIns.find((c) => c.submissionId === input.submissionId);
        if (existing) return { created: false, checkIn: { ...existing } };

        const record: CheckInRecord = {
          id: randomUUID(),
          organisationId: input.organisationId,
          submissionId: input.submissionId,
          eventId: input.eventId,
          checkedInAt: new Date(),
          checkedInByUserId: input.checkedInByUserId,
          method: input.method,
        };
        state.checkIns.push(record);
        return { created: true, checkIn: { ...record } };
      },
    },

    jobs: {
      enqueue: async (input) => {
        const existing = state.jobs.find(
          (j) =>
            j.organisationId === input.organisationId && j.idempotencyKey === input.idempotencyKey,
        );
        if (existing) return { ...existing };

        const now = new Date();
        const record: JobRecord = {
          id: randomUUID(),
          organisationId: input.organisationId,
          kind: input.kind,
          idempotencyKey: input.idempotencyKey,
          status: 'queued',
          payload: input.payload,
          result: null,
          error: null,
          attempts: 0,
          maxAttempts: input.maxAttempts ?? 3,
          progressDone: 0,
          progressTotal: input.progressTotal,
          runAfter: now,
          startedAt: null,
          finishedAt: null,
          createdAt: now,
        };
        state.jobs.push(record);
        return { ...record };
      },

      findById: async (organisationId, id) => {
        const job = state.jobs.find((j) => j.organisationId === organisationId && j.id === id);
        return job ? { ...job } : null;
      },

      // Find and mark with no `await` between them, so two workers cannot claim the same job.
      claim: async (now) => {
        const index = state.jobs.findIndex(
          (j) => j.status === 'queued' && j.runAfter.getTime() <= now.getTime(),
        );
        const job = state.jobs[index];
        if (!job) return null;
        const claimed: JobRecord = {
          ...job,
          status: 'running',
          attempts: job.attempts + 1,
          startedAt: now,
        };
        state.jobs[index] = claimed;
        return { ...claimed };
      },

      progress: async (id, done) => {
        const index = state.jobs.findIndex((j) => j.id === id);
        const job = state.jobs[index];
        if (job) state.jobs[index] = { ...job, progressDone: done };
      },

      succeed: async (id, result) => {
        const index = state.jobs.findIndex((j) => j.id === id);
        const job = state.jobs[index];
        if (job) {
          state.jobs[index] = { ...job, status: 'done', result, finishedAt: new Date() };
        }
      },

      fail: async (id, error, retryAt) => {
        const index = state.jobs.findIndex((j) => j.id === id);
        const job = state.jobs[index];
        if (!job) return;
        state.jobs[index] = retryAt
          ? { ...job, status: 'queued', error, runAfter: retryAt }
          : { ...job, status: 'failed', error, finishedAt: new Date() };
      },
    },

    brandKits: {
      // Copied on the way out, like every other record here: handing back the stored object lets a
      // caller mutate the "database" by accident, which this file has been bitten by before.
      find: async (organisationId) => {
        const kit = state.brandKits.find((k) => k.organisationId === organisationId);
        return kit ? { ...kit, tokens: structuredClone(kit.tokens) } : null;
      },
      save: async ({ organisationId, tokens, updatedBy }) => {
        const record: BrandKitRecord = {
          organisationId,
          tokens: structuredClone(tokens),
          updatedAt: new Date(),
          updatedBy,
        };
        const index = state.brandKits.findIndex((k) => k.organisationId === organisationId);
        if (index === -1) state.brandKits.push(record);
        else state.brandKits[index] = record;
        return { ...record, tokens: structuredClone(record.tokens) };
      },
      clear: async (organisationId) => {
        const index = state.brandKits.findIndex((k) => k.organisationId === organisationId);
        if (index !== -1) state.brandKits.splice(index, 1);
      },
    },

    sendingDomains: {
      list: async (organisationId) =>
        state.sendingDomains
          .filter((d) => d.organisationId === organisationId)
          .map((d) => ({ ...d })),
      findById: async (organisationId, id) => {
        const found = state.sendingDomains.find(
          (d) => d.organisationId === organisationId && d.id === id,
        );
        return found ? { ...found } : null;
      },
      findByDomain: async (organisationId, domain) => {
        const found = state.sendingDomains.find(
          (d) => d.organisationId === organisationId && d.domain === domain.toLowerCase(),
        );
        return found ? { ...found } : null;
      },
      create: async (input) => {
        const record: SendingDomainRecord = {
          id: randomUUID(),
          organisationId: input.organisationId,
          domain: input.domain.toLowerCase(),
          fromAddress: input.fromAddress.toLowerCase(),
          dkimSelectors: input.dkimSelectors,
          verified: false,
          checks: [],
          lastCheckedAt: null,
          createdAt: new Date(),
        };
        state.sendingDomains.push(record);
        return { ...record };
      },
      saveVerification: async (id, input) => {
        const index = state.sendingDomains.findIndex((d) => d.id === id);
        const existing = state.sendingDomains[index];
        if (!existing) return null;
        const updated: SendingDomainRecord = { ...existing, ...input };
        state.sendingDomains[index] = updated;
        return { ...updated };
      },
    },

    messages: {
      list: async (organisationId) =>
        state.messages.filter((m) => m.organisationId === organisationId).map((m) => ({ ...m })),
      record: async (input) => {
        const record: MessageRecord = { ...input, id: randomUUID(), createdAt: new Date() };
        state.messages.push(record);
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
