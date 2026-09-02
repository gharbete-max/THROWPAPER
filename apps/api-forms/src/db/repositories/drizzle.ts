import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import {
  brandKits,
  auditLog,
  checkIns,
  events,
  formUploads,
  formVersions,
  forms,
  jobs,
  loginTokens,
  messages,
  organisations,
  sendingDomains,
  submissions,
  refreshTokens,
  users,
} from '../schema.js';
import type {
  BrandKitRecord,
  CheckInRecord,
  EventCreate,
  EventRecord,
  EventUpdate,
  FormCreate,
  FormRecord,
  FormUpdate,
  FormVersionRecord,
  JobRecord,
  MessageRecord,
  Repositories,
  SendingDomainRecord,
  SubmissionCompleteInput,
  SubmissionDraftInput,
  SubmissionRecord,
  UploadRecord,
  UserRecord,
} from './types.js';

/** The only module that knows about tables. Everything else talks to the interfaces in types.ts. */
export function createDrizzleRepositories(db: Db): Repositories {
  return {
    organisations: {
      findById: async (id) =>
        first(await db.select().from(organisations).where(eq(organisations.id, id)).limit(1)),
      first: async () =>
        first(await db.select().from(organisations).orderBy(asc(organisations.createdAt)).limit(1)),
    },

    users: {
      findByEmail: async (organisationId, email) =>
        toUser(
          first(
            await db
              .select()
              .from(users)
              .where(
                and(
                  eq(users.organisationId, organisationId),
                  eq(users.email, email.toLowerCase()),
                  isNull(users.disabledAt),
                ),
              )
              .limit(1),
          ),
        ),
      findById: async (id) =>
        toUser(first(await db.select().from(users).where(eq(users.id, id)).limit(1))),
    },

    tokens: {
      createLoginToken: async (input) => {
        const [row] = await db.insert(loginTokens).values(input).returning();
        if (!row) throw new Error('login token insert returned no row');
        return row;
      },
      findLoginTokenByHash: async (tokenHash) =>
        first(
          await db.select().from(loginTokens).where(eq(loginTokens.tokenHash, tokenHash)).limit(1),
        ),
      consumeLoginToken: async (id, at) => {
        // Conditional on consumed_at being null, so two concurrent exchanges cannot both win.
        const updated = await db
          .update(loginTokens)
          .set({ consumedAt: at })
          .where(and(eq(loginTokens.id, id), isNull(loginTokens.consumedAt)))
          .returning({ id: loginTokens.id });
        return updated.length > 0;
      },

      createRefreshToken: async (input) => {
        const [row] = await db.insert(refreshTokens).values(input).returning();
        if (!row) throw new Error('refresh token insert returned no row');
        return row;
      },
      findRefreshTokenByHash: async (tokenHash) =>
        first(
          await db
            .select()
            .from(refreshTokens)
            .where(eq(refreshTokens.tokenHash, tokenHash))
            .limit(1),
        ),
      revokeRefreshToken: async (id, at) => {
        await db
          .update(refreshTokens)
          .set({ revokedAt: at })
          .where(and(eq(refreshTokens.id, id), isNull(refreshTokens.revokedAt)));
      },
      revokeFamily: async (familyId, at) => {
        await db
          .update(refreshTokens)
          .set({ revokedAt: at })
          .where(and(eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt)));
      },
    },

    events: {
      list: async (organisationId) =>
        (await db
          .select()
          .from(events)
          .where(eq(events.organisationId, organisationId))
          .orderBy(asc(events.startsAt))) as EventRecord[],
      findById: async (organisationId, id) =>
        first(
          await db
            .select()
            .from(events)
            .where(and(eq(events.organisationId, organisationId), eq(events.id, id)))
            .limit(1),
        ) as EventRecord | null,
      create: async (input: EventCreate) => {
        const [row] = await db.insert(events).values(input).returning();
        if (!row) throw new Error('event insert returned no row');
        return row as EventRecord;
      },
      update: async (organisationId, id, patch: EventUpdate) => {
        const [row] = await db
          .update(events)
          .set({ ...patch, updatedAt: new Date() })
          .where(and(eq(events.organisationId, organisationId), eq(events.id, id)))
          .returning();
        return (row as EventRecord | undefined) ?? null;
      },
      countRegistrations: async (eventId) => {
        const [row] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(submissions)
          .where(
            and(
              eq(submissions.eventId, eventId),
              eq(submissions.status, 'complete'),
              isNull(submissions.revokedAt),
            ),
          );
        return row?.count ?? 0;
      },
    },

    forms: {
      list: async (organisationId) =>
        (await db
          .select()
          .from(forms)
          .where(eq(forms.organisationId, organisationId))
          .orderBy(desc(forms.updatedAt))) as FormRecord[],
      findById: async (organisationId, id) =>
        first(
          await db
            .select()
            .from(forms)
            .where(and(eq(forms.organisationId, organisationId), eq(forms.id, id)))
            .limit(1),
        ) as FormRecord | null,
      findBySlug: async (organisationId, slug) =>
        first(
          await db
            .select()
            .from(forms)
            .where(and(eq(forms.organisationId, organisationId), eq(forms.slug, slug)))
            .limit(1),
        ) as FormRecord | null,
      create: async (input: FormCreate) => {
        const [row] = await db
          .insert(forms)
          .values({
            organisationId: input.organisationId,
            eventId: input.eventId,
            slug: input.slug,
            title: input.title,
            status: input.status ?? 'draft',
            draftDefinition: input.draftDefinition as Record<string, unknown>,
            opensAt: input.opensAt,
            closesAt: input.closesAt,
          })
          .returning();
        if (!row) throw new Error('form insert returned no row');
        return row as FormRecord;
      },
      update: async (organisationId, id, patch: FormUpdate) => {
        const [row] = await db
          .update(forms)
          .set({
            ...patch,
            draftDefinition: patch.draftDefinition as Record<string, unknown> | undefined,
            updatedAt: new Date(),
          })
          .where(and(eq(forms.organisationId, organisationId), eq(forms.id, id)))
          .returning();
        return (row as FormRecord | undefined) ?? null;
      },

      listVersions: async (formId) =>
        (await db
          .select()
          .from(formVersions)
          .where(eq(formVersions.formId, formId))
          .orderBy(desc(formVersions.version))) as FormVersionRecord[],
      findVersion: async (formId, version) =>
        first(
          await db
            .select()
            .from(formVersions)
            .where(and(eq(formVersions.formId, formId), eq(formVersions.version, version)))
            .limit(1),
        ) as FormVersionRecord | null,
      createVersion: async (input) => {
        // The number is derived inside the statement, so two concurrent publishes cannot pick the
        // same one; the unique index on (form_id, version) is the backstop.
        const [row] = await db
          .insert(formVersions)
          .values({
            formId: input.formId,
            version: sql`(select coalesce(max(v.version), 0) + 1 from form_versions v where v.form_id = ${input.formId})`,
            definition: input.definition as Record<string, unknown>,
            publishedAt: new Date(),
            translationOverride: input.translationOverride,
          })
          .returning();
        if (!row) throw new Error('form version insert returned no row');
        return row as FormVersionRecord;
      },
    },

    submissions: {
      list: async (organisationId, formId) =>
        (await db
          .select()
          .from(submissions)
          .where(
            and(eq(submissions.organisationId, organisationId), eq(submissions.formId, formId)),
          )
          .orderBy(desc(submissions.createdAt))) as SubmissionRecord[],

      findById: async (organisationId, submissionId) =>
        (first(
          await db
            .select()
            .from(submissions)
            .where(
              and(eq(submissions.organisationId, organisationId), eq(submissions.id, submissionId)),
            )
            .limit(1),
        ) as SubmissionRecord | null) ?? null,

      listForEvent: async (organisationId, eventId) =>
        (await db
          .select()
          .from(submissions)
          .where(
            and(eq(submissions.organisationId, organisationId), eq(submissions.eventId, eventId)),
          )) as SubmissionRecord[],

      findByResumeTokenHash: async (tokenHash) =>
        first(
          await db
            .select()
            .from(submissions)
            .where(eq(submissions.resumeTokenHash, tokenHash))
            .limit(1),
        ) as SubmissionRecord | null,

      findByReference: async (organisationId, reference) =>
        first(
          await db
            .select()
            .from(submissions)
            .where(
              and(
                eq(submissions.organisationId, organisationId),
                sql`upper(${submissions.reference}) = upper(${reference})`,
              ),
            )
            .limit(1),
        ) as SubmissionRecord | null,

      revoke: async (organisationId, id, at) => {
        const [row] = await db
          .update(submissions)
          .set({ revokedAt: at, updatedAt: new Date() })
          .where(and(eq(submissions.organisationId, organisationId), eq(submissions.id, id)))
          .returning();
        return (row as SubmissionRecord | undefined) ?? null;
      },

      countComplete: async (formId) => {
        const [row] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(submissions)
          .where(and(eq(submissions.formId, formId), eq(submissions.status, 'complete')));
        return row?.count ?? 0;
      },

      countCompleteByForm: async (organisationId, formIds) => {
        // `IN ()` is not valid SQL, so an empty ask is answered without going to the database.
        if (formIds.length === 0) return {};
        const rows = await db
          .select({ formId: submissions.formId, count: sql<number>`count(*)::int` })
          .from(submissions)
          .where(
            and(
              // Scoped, even though every caller passes ids it already read from this
              // organisation. A count is small, but it is still somebody else's data, and a
              // repository that trusts its caller is one refactor away from handing it over.
              eq(submissions.organisationId, organisationId),
              inArray(submissions.formId, [...formIds]),
              eq(submissions.status, 'complete'),
            ),
          )
          .groupBy(submissions.formId);
        return Object.fromEntries(rows.map((row) => [row.formId, row.count]));
      },

      saveDraft: async (input: SubmissionDraftInput) => {
        if (input.id) {
          const [row] = await db
            .update(submissions)
            .set({
              data: input.data,
              locale: input.locale,
              resumeTokenHash: input.resumeTokenHash,
              resumeExpiresAt: input.resumeExpiresAt,
              updatedAt: new Date(),
            })
            .where(and(eq(submissions.id, input.id), eq(submissions.status, 'partial')))
            .returning();
          if (row) return row as SubmissionRecord;
        }

        const [row] = await db
          .insert(submissions)
          .values({
            organisationId: input.organisationId,
            formId: input.formId,
            formVersionId: input.formVersionId,
            eventId: input.eventId,
            reference: input.reference,
            status: 'partial',
            locale: input.locale,
            data: input.data,
            resumeTokenHash: input.resumeTokenHash,
            resumeExpiresAt: input.resumeExpiresAt,
          })
          .returning();
        if (!row) throw new Error('submission draft insert returned no row');
        return row as SubmissionRecord;
      },

      /**
       * Capacity and duplicate control are enforced inside one transaction.
       *
       * The form row is locked first, which serialises every completion for that form. Without it
       * two callers both read "one place left" and both take it. The partial unique index on
       * (form_id, email) is the second line of defence for duplicates, so a unique violation is
       * translated rather than thrown.
       */
      complete: async (input: SubmissionCompleteInput) => {
        const email = input.email?.toLowerCase() ?? null;

        try {
          return await db.transaction(async (tx) => {
            await tx.execute(sql`select 1 from forms where id = ${input.formId} for update`);

            if (input.duplicateControl === 'email' && email) {
              const clash = await tx
                .select({ id: submissions.id })
                .from(submissions)
                .where(
                  and(
                    eq(submissions.formId, input.formId),
                    eq(submissions.status, 'complete'),
                    eq(submissions.email, email),
                  ),
                )
                .limit(1);
              if (clash.length > 0) return { ok: false as const, reason: 'duplicate' as const };
            }

            if (input.capacity !== null) {
              const [row] = await tx
                .select({ count: sql<number>`count(*)::int` })
                .from(submissions)
                .where(
                  and(
                    eq(submissions.formId, input.formId),
                    eq(submissions.status, 'complete'),
                    // A withdrawn registration gives its place back. Counting it would hold a
                    // seat for somebody who cancelled, and the attendance screen has always
                    // reported withdrawals separately from registrations.
                    isNull(submissions.revokedAt),
                  ),
                );
              if ((row?.count ?? 0) >= input.capacity) {
                return { ok: false as const, reason: 'full' as const };
              }
            }

            const values = {
              organisationId: input.organisationId,
              formId: input.formId,
              formVersionId: input.formVersionId,
              eventId: input.eventId,
              status: 'complete' as const,
              locale: input.locale,
              email,
              data: input.data,
              resumeTokenHash: null,
              resumeExpiresAt: null,
              submittedAt: new Date(),
              updatedAt: new Date(),
            };

            const [saved] = input.id
              ? await tx
                  .update(submissions)
                  .set(values)
                  .where(eq(submissions.id, input.id))
                  .returning()
              : await tx
                  .insert(submissions)
                  .values({ ...values, reference: input.reference })
                  .returning();

            if (!saved) throw new Error('submission completion returned no row');
            return { ok: true as const, submission: saved as SubmissionRecord };
          });
        } catch (error) {
          if (isUniqueViolation(error, 'submissions_form_email_idx')) {
            return { ok: false as const, reason: 'duplicate' as const };
          }
          throw error;
        }
      },
    },

    uploads: {
      create: async (input) => {
        const [row] = await db.insert(formUploads).values(input).returning();
        if (!row) throw new Error('upload insert returned no row');
        return row as UploadRecord;
      },

      findUnclaimed: async (formId, storageKeys) => {
        if (storageKeys.length === 0) return [];
        return (await db
          .select()
          .from(formUploads)
          .where(
            and(
              eq(formUploads.formId, formId),
              isNull(formUploads.submissionId),
              inArray(formUploads.storageKey, [...storageKeys]),
            ),
          )) as UploadRecord[];
      },

      claim: async (ids, submissionId) => {
        if (ids.length === 0) return;
        await db
          .update(formUploads)
          .set({ submissionId })
          .where(inArray(formUploads.id, [...ids]));
      },

      listForSubmissions: async (organisationId, submissionIds) => {
        if (submissionIds.length === 0) return [];
        return (await db
          .select()
          .from(formUploads)
          .where(
            and(
              eq(formUploads.organisationId, organisationId),
              inArray(formUploads.submissionId, [...submissionIds]),
            ),
          )) as UploadRecord[];
      },

      findForDownload: async (organisationId, submissionId, storageKey) =>
        (first(
          await db
            .select()
            .from(formUploads)
            .where(
              and(
                eq(formUploads.organisationId, organisationId),
                eq(formUploads.submissionId, submissionId),
                eq(formUploads.storageKey, storageKey),
              ),
            )
            .limit(1),
        ) as UploadRecord | null) ?? null,
    },

    checkIns: {
      listForEvent: async (organisationId, eventId) =>
        (await db
          .select()
          .from(checkIns)
          .where(and(eq(checkIns.organisationId, organisationId), eq(checkIns.eventId, eventId)))
          .orderBy(desc(checkIns.checkedInAt))) as CheckInRecord[],

      findBySubmission: async (submissionId) =>
        first(
          await db.select().from(checkIns).where(eq(checkIns.submissionId, submissionId)).limit(1),
        ) as CheckInRecord | null,

      /**
       * The unique index on submission_id is the guarantee, not a prior read: `do nothing` means
       * a concurrent scan loses the insert race harmlessly and we return the row that won.
       */
      admit: async (input) => {
        const [row] = await db
          .insert(checkIns)
          .values({
            organisationId: input.organisationId,
            submissionId: input.submissionId,
            eventId: input.eventId,
            checkedInByUserId: input.checkedInByUserId,
            method: input.method,
          })
          .onConflictDoNothing({ target: checkIns.submissionId })
          .returning();

        if (row) return { created: true, checkIn: row as CheckInRecord };

        const existing = first(
          await db
            .select()
            .from(checkIns)
            .where(eq(checkIns.submissionId, input.submissionId))
            .limit(1),
        ) as CheckInRecord | null;
        if (!existing) throw new Error('check-in neither inserted nor found');
        return { created: false, checkIn: existing };
      },
    },

    jobs: {
      enqueue: async (input) => {
        // The unique index on (organisation_id, idempotency_key) is what makes this idempotent;
        // a conflicting insert returns the row that is already there.
        const [row] = await db
          .insert(jobs)
          .values({
            organisationId: input.organisationId,
            kind: input.kind,
            idempotencyKey: input.idempotencyKey,
            payload: input.payload,
            progressTotal: input.progressTotal,
            maxAttempts: input.maxAttempts ?? 3,
          })
          .onConflictDoNothing({ target: [jobs.organisationId, jobs.idempotencyKey] })
          .returning();
        if (row) return row as JobRecord;

        const existing = first(
          await db
            .select()
            .from(jobs)
            .where(
              and(
                eq(jobs.organisationId, input.organisationId),
                eq(jobs.idempotencyKey, input.idempotencyKey),
              ),
            )
            .limit(1),
        ) as JobRecord | null;
        if (!existing) throw new Error('job enqueue neither inserted nor found a row');
        return existing;
      },

      findById: async (organisationId, id) =>
        first(
          await db
            .select()
            .from(jobs)
            .where(and(eq(jobs.organisationId, organisationId), eq(jobs.id, id)))
            .limit(1),
        ) as JobRecord | null,

      /**
       * One statement, so two workers cannot claim the same job: the subquery picks a candidate
       * with `for update skip locked`, and the update only lands if it is still queued.
       *
       * `now` is bound as an ISO string with an explicit cast, not as a Date. Passing a Date into
       * a raw `sql` fragment gets it to postgres.js unconverted, which throws
       * `ERR_INVALID_ARG_TYPE: Received an instance of Date` — and because this runs on the
       * worker's timer, that rejection took the whole API process down a second after boot.
       */
      claim: async (now) => {
        const [row] = await db
          .update(jobs)
          .set({ status: 'running', startedAt: now, attempts: sql`${jobs.attempts} + 1` })
          .where(
            and(
              eq(jobs.status, 'queued'),
              sql`${jobs.id} = (
                select j.id from jobs j
                where j.status = 'queued' and j.run_after <= ${now.toISOString()}::timestamptz
                order by j.run_after
                for update skip locked
                limit 1
              )`,
            ),
          )
          .returning();
        return (row as JobRecord | undefined) ?? null;
      },

      progress: async (id, done) => {
        await db.update(jobs).set({ progressDone: done }).where(eq(jobs.id, id));
      },

      succeed: async (id, result) => {
        await db
          .update(jobs)
          .set({ status: 'done', result, finishedAt: new Date() })
          .where(eq(jobs.id, id));
      },

      fail: async (id, error, retryAt) => {
        await db
          .update(jobs)
          .set(
            retryAt
              ? { status: 'queued', error, runAfter: retryAt }
              : { status: 'failed', error, finishedAt: new Date() },
          )
          .where(eq(jobs.id, id));
      },
    },

    brandKits: {
      find: async (organisationId) =>
        first(
          await db
            .select()
            .from(brandKits)
            .where(eq(brandKits.organisationId, organisationId))
            .limit(1),
        ) as BrandKitRecord | null,

      /**
       * Upsert on the primary key. One kit per organisation is the rule, and letting the database
       * enforce it means two admins saving at once cannot produce two rows.
       */
      save: async ({ organisationId, tokens, updatedBy }) => {
        const rows = await db
          .insert(brandKits)
          .values({ organisationId, tokens, updatedBy, updatedAt: new Date() })
          .onConflictDoUpdate({
            target: brandKits.organisationId,
            set: { tokens, updatedBy, updatedAt: new Date() },
          })
          .returning();
        return first(rows) as BrandKitRecord;
      },

      clear: async (organisationId) => {
        await db.delete(brandKits).where(eq(brandKits.organisationId, organisationId));
      },
    },

    sendingDomains: {
      list: async (organisationId) =>
        (await db
          .select()
          .from(sendingDomains)
          .where(eq(sendingDomains.organisationId, organisationId))) as SendingDomainRecord[],
      findById: async (organisationId, id) =>
        first(
          await db
            .select()
            .from(sendingDomains)
            .where(
              and(eq(sendingDomains.organisationId, organisationId), eq(sendingDomains.id, id)),
            )
            .limit(1),
        ) as SendingDomainRecord | null,
      findByDomain: async (organisationId, domain) =>
        first(
          await db
            .select()
            .from(sendingDomains)
            .where(
              and(
                eq(sendingDomains.organisationId, organisationId),
                eq(sendingDomains.domain, domain.toLowerCase()),
              ),
            )
            .limit(1),
        ) as SendingDomainRecord | null,
      create: async (input) => {
        const [row] = await db
          .insert(sendingDomains)
          .values({
            organisationId: input.organisationId,
            domain: input.domain.toLowerCase(),
            fromAddress: input.fromAddress.toLowerCase(),
            dkimSelectors: input.dkimSelectors,
          })
          .returning();
        if (!row) throw new Error('sending domain insert returned no row');
        return row as SendingDomainRecord;
      },
      saveVerification: async (id, input) => {
        const [row] = await db
          .update(sendingDomains)
          .set({
            verified: input.verified,
            checks: input.checks,
            lastCheckedAt: input.lastCheckedAt,
          })
          .where(eq(sendingDomains.id, id))
          .returning();
        return (row as SendingDomainRecord | undefined) ?? null;
      },
    },

    messages: {
      list: async (organisationId) =>
        (await db
          .select()
          .from(messages)
          .where(eq(messages.organisationId, organisationId))
          .orderBy(desc(messages.createdAt))) as MessageRecord[],
      record: async (input) => {
        const [row] = await db.insert(messages).values(input).returning();
        if (!row) throw new Error('message insert returned no row');
        return row as MessageRecord;
      },
    },

    audit: {
      record: async (entry) => {
        await db.insert(auditLog).values({
          organisationId: entry.organisationId,
          actorUserId: entry.actorUserId,
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId,
          before: entry.before ?? null,
          after: entry.after ?? null,
          ip: entry.ip ?? null,
        });
      },
      list: async (organisationId) =>
        (await db.select().from(auditLog).where(eq(auditLog.organisationId, organisationId))).map(
          (row) => ({
            id: row.id,
            organisationId: row.organisationId,
            actorUserId: row.actorUserId,
            action: row.action,
            entityType: row.entityType,
            entityId: row.entityId,
            before: row.before,
            after: row.after,
            ip: row.ip,
            at: row.at,
          }),
        ),
    },
  };
}

/** postgres.js surfaces the constraint name; anything else is a real error and must not be hidden. */
function isUniqueViolation(error: unknown, constraint: string): boolean {
  const candidate = error as { code?: string; constraint_name?: string } | null;
  return candidate?.code === '23505' && candidate.constraint_name === constraint;
}

function first<T>(rows: T[]): T | null {
  return rows[0] ?? null;
}

function toUser(row: typeof users.$inferSelect | null): UserRecord | null {
  return row;
}
