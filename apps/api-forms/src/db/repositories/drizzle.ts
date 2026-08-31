import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import {
  auditLog,
  events,
  formVersions,
  forms,
  loginTokens,
  organisations,
  refreshTokens,
  users,
} from '../schema.js';
import type {
  EventCreate,
  EventRecord,
  EventUpdate,
  FormCreate,
  FormRecord,
  FormUpdate,
  FormVersionRecord,
  Repositories,
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
      // Registrations land in phase 3.
      countRegistrations: async () => 0,
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

function first<T>(rows: T[]): T | null {
  return rows[0] ?? null;
}

function toUser(row: typeof users.$inferSelect | null): UserRecord | null {
  return row;
}
