import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import { ocrForInvoice } from '@tp/shared/invoicing';
import {
  brandKits,
  auditLog,
  checkIns,
  events,
  formShares,
  formUploads,
  invoiceBatches,
  invoiceLines,
  invoices,
  journalEntries,
  journalLines,
  ledgerAccounts,
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
  FormListFilter,
  FormRecord,
  FormShareRecord,
  FormUpdate,
  JournalEntryWithLines,
  JournalLineRecord,
  LedgerAccountRecord,
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

/**
 * Lines for a page of entries, in one query rather than one per entry.
 *
 * A book of five hundred entries would otherwise be five hundred round trips to render one screen.
 */
async function attachLines(
  db: Db,
  entries: JournalEntryWithLines[],
): Promise<JournalEntryWithLines[]> {
  if (entries.length === 0) return [];
  const rows = (await db
    .select()
    .from(journalLines)
    .where(
      inArray(
        journalLines.entryId,
        entries.map((entry) => entry.id),
      ),
    )
    .orderBy(asc(journalLines.position))) as JournalLineRecord[];

  const byEntry = new Map<string, JournalLineRecord[]>();
  for (const row of rows) {
    const list = byEntry.get(row.entryId) ?? [];
    list.push(row);
    byEntry.set(row.entryId, list);
  }
  return entries.map((entry) => ({ ...entry, lines: byEntry.get(entry.id) ?? [] }));
}

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
      list: async (organisationId) =>
        (
          await db
            .select()
            .from(users)
            .where(eq(users.organisationId, organisationId))
            .orderBy(asc(users.name))
        ).map((row) => toUser(row) as UserRecord),
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
      list: async (organisationId, filter?: FormListFilter) => {
        const scope = filter?.scope ?? 'active';
        const userId = filter?.userId;

        /**
         * "Shared with me" as a subquery rather than a join.
         *
         * A join would multiply the form rows by their shares — a form shared with four people
         * would come back four times, and the count on its card would be wrong in a way that looks
         * like a counting bug rather than a join bug. `IN (select …)` cannot duplicate a row.
         */
        const sharedWithUser = userId
          ? inArray(
              forms.id,
              db
                .select({ id: formShares.formId })
                .from(formShares)
                .where(
                  and(eq(formShares.organisationId, organisationId), eq(formShares.userId, userId)),
                ),
            )
          : undefined;

        const ownership = (() => {
          switch (scope) {
            case 'mine':
              return userId ? eq(forms.ownerUserId, userId) : undefined;
            case 'shared':
              // Without a user there is nobody for anything to be shared *with*, and answering
              // "everything" would be the opposite of what was asked.
              return sharedWithUser ?? sql`false`;
            case 'trash':
              return userId ? eq(forms.ownerUserId, userId) : undefined;
            case 'active':
              // Yours, shared with you, or nobody's. An administrator asking without a user id
              // gets the lot, which is what the support view wants.
              return userId
                ? or(eq(forms.ownerUserId, userId), isNull(forms.ownerUserId), sharedWithUser)
                : undefined;
            case 'all':
              return undefined;
          }
        })();

        return (await db
          .select()
          .from(forms)
          .where(
            and(
              eq(forms.organisationId, organisationId),
              // The bin is a separate pile, never mixed into another one.
              scope === 'trash' ? isNotNull(forms.deletedAt) : isNull(forms.deletedAt),
              ownership,
            ),
          )
          .orderBy(desc(forms.updatedAt))) as FormRecord[];
      },
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
            ownerUserId: input.ownerUserId ?? null,
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
      purge: async (organisationId, id) => {
        // Versions, submissions, shares and uploads all cascade from the row — the foreign keys
        // say so, so this stays one statement and cannot half-delete a form.
        const rows = await db
          .delete(forms)
          .where(and(eq(forms.organisationId, organisationId), eq(forms.id, id)))
          .returning({ id: forms.id });
        return rows.length > 0;
      },

      listShares: async (organisationId, formId) =>
        (await db
          .select()
          .from(formShares)
          .where(
            and(eq(formShares.organisationId, organisationId), eq(formShares.formId, formId)),
          )) as FormShareRecord[],
      share: async (input) => {
        // Upsert on (form, user): sharing again is changing a role, and a second row would make
        // "what may this person do" a question with two answers.
        const [row] = await db
          .insert(formShares)
          .values(input)
          .onConflictDoUpdate({
            target: [formShares.formId, formShares.userId],
            set: { role: input.role },
          })
          .returning();
        if (!row) throw new Error('share insert returned no row');
        return row as FormShareRecord;
      },
      unshare: async (organisationId, formId, userId) => {
        const rows = await db
          .delete(formShares)
          .where(
            and(
              eq(formShares.organisationId, organisationId),
              eq(formShares.formId, formId),
              eq(formShares.userId, userId),
            ),
          )
          .returning({ id: formShares.id });
        return rows.length > 0;
      },
      sharesForUser: async (organisationId, userId) =>
        (await db
          .select()
          .from(formShares)
          .where(
            and(eq(formShares.organisationId, organisationId), eq(formShares.userId, userId)),
          )) as FormShareRecord[],
      shareCounts: async (organisationId, formIds) => {
        if (formIds.length === 0) return {};
        const rows = await db
          .select({ formId: formShares.formId, count: sql<number>`count(*)::int` })
          .from(formShares)
          .where(
            and(
              eq(formShares.organisationId, organisationId),
              inArray(formShares.formId, [...formIds]),
            ),
          )
          .groupBy(formShares.formId);
        return Object.fromEntries(rows.map((row) => [row.formId, Number(row.count)]));
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

      listForForms: async (organisationId, formIds, limit) => {
        if (formIds.length === 0) return [];
        return (
          (await db
            .select()
            .from(submissions)
            .where(
              and(
                eq(submissions.organisationId, organisationId),
                inArray(submissions.formId, [...formIds]),
              ),
            )
            // Newest first, and cut in the database: the inbox shows a page, not a corpus.
            .orderBy(desc(submissions.createdAt))
            .limit(limit)) as SubmissionRecord[]
        );
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

    /**
     * The ledger.
     *
     * No update and no delete, here or in the interface. A posted entry is corrected by posting a
     * reversing one, and both stay in the book — see `packages/calc/src/ledger.ts` for why that
     * is the whole point rather than a restriction.
     */
    invoices: {
      listBatches: (organisationId) =>
        db
          .select()
          .from(invoiceBatches)
          .where(eq(invoiceBatches.organisationId, organisationId))
          .orderBy(desc(invoiceBatches.createdAt)),

      findBatch: async (organisationId, id) => {
        const [row] = await db
          .select()
          .from(invoiceBatches)
          .where(and(eq(invoiceBatches.organisationId, organisationId), eq(invoiceBatches.id, id)))
          .limit(1);
        return row ?? null;
      },

      /**
       * A run and every invoice in it, in one transaction.
       *
       * ## Why the numbers are taken here
       *
       * `select max(number) + 1` inside the transaction, with the organisation's rows locked. Two
       * runs started at the same moment would otherwise read the same highest number and allocate
       * the same references, and the unique index would reject the second one *after* the first had
       * already been sent.
       *
       * The lock is on the organisation row rather than on the invoices, because the thing being
       * serialised is "who is allocating numbers for this organisation" — locking rows that do not
       * exist yet is not a thing a database can do.
       */
      createBatch: (input) =>
        db.transaction(async (tx) => {
          await tx.execute(
            sql`select 1 from organisations where id = ${input.organisationId} for update`,
          );

          const [highest] = await tx
            .select({ number: sql<number>`coalesce(max(${invoices.number}), 0)` })
            .from(invoices)
            .where(eq(invoices.organisationId, input.organisationId));

          let next = (highest?.number ?? 0) + 1;

          const [batch] = await tx
            .insert(invoiceBatches)
            .values({
              organisationId: input.organisationId,
              name: input.name,
              createdBy: input.createdBy,
            })
            .returning();

          const created = [];
          for (const request of input.invoices) {
            const number = next;
            next += 1;

            const [invoice] = await tx
              .insert(invoices)
              .values({
                organisationId: input.organisationId,
                batchId: batch!.id,
                number,
                ocr: ocrForInvoice(number, {
                  method: 'bankgiro',
                  account: request.paymentAccount,
                  ocrLengthControl: request.ocrLengthControl,
                }),
                status: 'issued',
                currency: request.currency,
                recipientName: request.recipientName,
                recipientEmail: request.recipientEmail,
                recipientAddress: request.recipientAddress,
                recipientReference: request.recipientReference,
                subject: request.subject,
                periodStart: request.periodStart,
                periodEnd: request.periodEnd,
                issuedOn: request.issuedOn,
                dueOn: request.dueOn,
                netMinor: request.lines.reduce((total, line) => total + line.amountMinor, 0n),
                vatMinor: request.lines.reduce((total, line) => total + line.vatMinor, 0n),
                totalMinor: request.lines.reduce(
                  (total, line) => total + line.amountMinor + line.vatMinor,
                  0n,
                ),
                paymentMethod: request.paymentMethod,
                paymentAccount: request.paymentAccount,
                /* Long, random, and deliberately not the OCR. See the schema. */
                publicToken: randomUUID().replace(/-/g, '') + randomUUID().slice(0, 8),
              })
              .returning();

            const lines = request.lines.length
              ? await tx
                  .insert(invoiceLines)
                  .values(
                    request.lines.map((line, position) => ({
                      invoiceId: invoice!.id,
                      ...line,
                      position,
                    })),
                  )
                  .returning()
              : [];

            created.push({ ...invoice!, lines });
          }

          return { batch: batch!, invoices: created };
        }),

      listInvoices: async (organisationId, batchId) => {
        const rows = await db
          .select()
          .from(invoices)
          .where(
            batchId === undefined
              ? eq(invoices.organisationId, organisationId)
              : and(eq(invoices.organisationId, organisationId), eq(invoices.batchId, batchId)),
          )
          .orderBy(asc(invoices.number));

        return withLines(db, rows);
      },

      findInvoice: async (organisationId, id) => {
        const [row] = await db
          .select()
          .from(invoices)
          .where(and(eq(invoices.organisationId, organisationId), eq(invoices.id, id)))
          .limit(1);
        if (!row) return null;
        return (await withLines(db, [row]))[0] ?? null;
      },

      /* By token alone: whoever opens the link is a tenant, and has no session to scope by. */
      findByPublicToken: async (token) => {
        const [row] = await db
          .select()
          .from(invoices)
          .where(eq(invoices.publicToken, token))
          .limit(1);
        if (!row) return null;
        return (await withLines(db, [row]))[0] ?? null;
      },

      markSent: async (organisationId, batchId, at) => {
        await db.transaction(async (tx) => {
          await tx
            .update(invoiceBatches)
            .set({ sentAt: at })
            .where(
              and(
                eq(invoiceBatches.organisationId, organisationId),
                eq(invoiceBatches.id, batchId),
              ),
            );
          await tx
            .update(invoices)
            .set({ sentAt: at, status: 'sent' })
            .where(and(eq(invoices.organisationId, organisationId), eq(invoices.batchId, batchId)));
        });
      },

      /*
       * A test run stamps the batch and nothing else.
       *
       * Not the invoices: they went to nobody, and marking them would make a test
       * indistinguishable from the real thing in every list that reads `sentAt`.
       */
      markTested: async (organisationId, batchId, at) => {
        await db
          .update(invoiceBatches)
          .set({ lastTestAt: at })
          .where(
            and(eq(invoiceBatches.organisationId, organisationId), eq(invoiceBatches.id, batchId)),
          );
      },
    },

    ledger: {
      listAccounts: async (organisationId) =>
        (await db
          .select()
          .from(ledgerAccounts)
          .where(eq(ledgerAccounts.organisationId, organisationId))
          .orderBy(asc(ledgerAccounts.code))) as LedgerAccountRecord[],
      findAccount: async (organisationId, id) =>
        first(
          await db
            .select()
            .from(ledgerAccounts)
            .where(
              and(eq(ledgerAccounts.organisationId, organisationId), eq(ledgerAccounts.id, id)),
            )
            .limit(1),
        ) as LedgerAccountRecord | null,
      createAccount: async (input) => {
        const [row] = await db.insert(ledgerAccounts).values(input).returning();
        if (!row) throw new Error('ledger account insert returned no row');
        return row as LedgerAccountRecord;
      },
      archiveAccount: async (organisationId, id, at) => {
        const [row] = await db
          .update(ledgerAccounts)
          .set({ archivedAt: at })
          .where(and(eq(ledgerAccounts.organisationId, organisationId), eq(ledgerAccounts.id, id)))
          .returning();
        return (row as LedgerAccountRecord | undefined) ?? null;
      },

      listEntries: async (organisationId, limit) => {
        const entries = await db
          .select()
          .from(journalEntries)
          .where(eq(journalEntries.organisationId, organisationId))
          // The book is read newest first by the date the thing happened, then by when it was
          // written down, so two entries on the same day come back in the order they were posted.
          .orderBy(desc(journalEntries.occurredOn), desc(journalEntries.postedAt))
          .limit(limit);
        return attachLines(db, entries as JournalEntryWithLines[]);
      },
      findEntry: async (organisationId, id) => {
        const entry = first(
          await db
            .select()
            .from(journalEntries)
            .where(
              and(eq(journalEntries.organisationId, organisationId), eq(journalEntries.id, id)),
            )
            .limit(1),
        ) as JournalEntryWithLines | undefined;
        if (!entry) return null;
        return (await attachLines(db, [entry]))[0] ?? null;
      },

      /**
       * One transaction for the entry, its lines, and the stamp on whatever it reverses.
       *
       * A half-written entry would put the whole book out of trial balance, and there is no repair
       * path — because there is no update. So the only safe way to write one is all of it or none.
       */
      post: async (input) =>
        db.transaction(async (tx) => {
          const [entry] = await tx
            .insert(journalEntries)
            .values({
              organisationId: input.organisationId,
              reference: input.reference,
              description: input.description,
              occurredOn: input.occurredOn,
              postedByUserId: input.postedByUserId,
              currency: input.currency,
              reversesEntryId: input.reversesEntryId ?? null,
            })
            .returning();
          if (!entry) throw new Error('journal entry insert returned no row');

          const lines = await tx
            .insert(journalLines)
            .values(
              input.lines.map((line, position) => ({
                entryId: entry.id,
                accountId: line.accountId,
                debitMinor: line.debitMinor,
                creditMinor: line.creditMinor,
                memo: line.memo,
                position,
              })),
            )
            .returning();

          if (input.reversesEntryId) {
            await tx
              .update(journalEntries)
              .set({ reversedByEntryId: entry.id })
              .where(eq(journalEntries.id, input.reversesEntryId));
          }

          return { ...entry, lines: lines as JournalLineRecord[] } as JournalEntryWithLines;
        }),

      /**
       * The next reference, derived inside the statement rather than read and incremented.
       *
       * Two people posting at once would otherwise both read the same highest number. The unique
       * index on (organisation, reference) is the backstop; this is what stops it firing.
       */
      nextReference: async (organisationId) => {
        const year = new Date().getUTCFullYear();
        const prefix = `V${year}-`;
        const [row] = await db
          .select({
            highest: sql<number>`coalesce(max(nullif(regexp_replace(${journalEntries.reference}, '^.*-', ''), '')::int), 0)`,
          })
          .from(journalEntries)
          .where(
            and(
              eq(journalEntries.organisationId, organisationId),
              sql`${journalEntries.reference} like ${prefix + '%'}`,
            ),
          );
        return `${prefix}${String((row?.highest ?? 0) + 1).padStart(4, '0')}`;
      },

      allLines: async (organisationId) =>
        (await db
          .select({
            id: journalLines.id,
            entryId: journalLines.entryId,
            accountId: journalLines.accountId,
            debitMinor: journalLines.debitMinor,
            creditMinor: journalLines.creditMinor,
            memo: journalLines.memo,
            position: journalLines.position,
          })
          .from(journalLines)
          .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
          .where(eq(journalEntries.organisationId, organisationId))) as JournalLineRecord[],
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

/**
 * Attach lines to invoices in one query rather than one per invoice.
 *
 * A run is forty invoices; forty round trips to render a list is the difference between a page and
 * a wait. Grouped in memory because the rows come back in one order and belong in another.
 */
async function withLines(db: Db, rows: Array<typeof invoices.$inferSelect>) {
  if (rows.length === 0) return [];

  const lines = await db
    .select()
    .from(invoiceLines)
    .where(
      inArray(
        invoiceLines.invoiceId,
        rows.map((row) => row.id),
      ),
    )
    .orderBy(asc(invoiceLines.position));

  const byInvoice = new Map<string, Array<typeof invoiceLines.$inferSelect>>();
  for (const line of lines) {
    const existing = byInvoice.get(line.invoiceId);
    if (existing) existing.push(line);
    else byInvoice.set(line.invoiceId, [line]);
  }

  return rows.map((row) => ({ ...row, lines: byInvoice.get(row.id) ?? [] }));
}
