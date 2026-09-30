import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { api } from '@tp/shared';
import { BUILDER_GRAPH } from '@tp/shared/builder';
import {
  ALIASES_VERSION,
  AliasFile,
  AliasImportResult,
  AliasRefusedResponse,
  AliasesRemoved,
  BUILTIN_ALIASES,
  ImportAliases,
  LearnedAliasList,
  MAX_IMPORTED_ALIASES,
  RememberAlias,
  RememberedAlias,
  aliasImportDiff,
  aliasRefusal,
  formatAliasFile,
  keyOf,
  type AliasEntry,
  type AliasRefusal,
  type Language,
} from '@tp/shared/interpret';
import { recordAudit } from '../audit.js';
import type { AuthGuardDeps } from '../auth/plugin.js';
import { requireAuth } from '../auth/plugin.js';
import type { Repositories } from '../db/repositories/index.js';
import type { BuilderAliasRecord } from '../db/repositories/types.js';

/**
 * The organisation's learned aliases — `docs/plan/INTENT-LADDER.md`, "Aliases" (S6).
 *
 * - `GET /v1/builder/aliases`: every learned alias, for the ladder to read with the built-in ones.
 * - `POST /v1/builder/aliases`: "Remember 'blabla' as a way to say this?" — pressed. Never called
 *   without that press: the phrase is stored exactly as shown, and only then.
 * - `DELETE /v1/builder/aliases/:id`, `DELETE /v1/builder/aliases`: one, or all of them — back to
 *   the built-in aliases. An administrator's, with the confirmation in the screen (rule 7).
 * - `GET /v1/builder/aliases/export`, `POST /v1/builder/aliases/import`: the alias file, in the
 *   same shape as the shipped ones. An import shows what it would do and stores nothing until it
 *   is confirmed.
 *
 * Forms-internal: documented by its Zod schemas in `@tp/shared/interpret`, not `CONTRACT.md`.
 */

const IdParam = z.object({ id: z.string().uuid() });

const errorResponses = {
  401: api.ErrorResponse,
  403: api.ErrorResponse,
  404: api.ErrorResponse,
  422: api.ErrorResponse,
} as const;

/** An alias file of `MAX_IMPORTED_ALIASES` entries runs to about a megabyte. */
const IMPORT_BODY_LIMIT = 4 * 1024 * 1024;

const today = () => new Date().toISOString().slice(0, 10);

/** A stored alias as the file and the ladder read it. */
const entryOf = (record: BuilderAliasRecord): AliasEntry => ({
  phrase: record.phrase,
  nodeId: record.nodeId,
  optionId: record.optionId,
  locale: record.locale as Language,
  source: record.source,
  createdAt: record.createdAt,
  count: record.count,
  notes: record.notes,
});

const asListed = (record: BuilderAliasRecord) => ({ id: record.id, ...entryOf(record) });

function refused(reply: FastifyReply, refusal: AliasRefusal) {
  const message =
    refusal.reason === 'present'
      ? 'Loppa already reads it that way'
      : refusal.reason === 'collision'
        ? `It already means ${refusal.means ?? 'another answer'}`
        : `It cannot be remembered: ${refusal.reason}`;
  return reply.code(409).send({
    error: {
      code: 'alias-refused',
      message,
      reason: refusal.reason,
      ...(refusal.means ? { means: refusal.means } : {}),
    },
  });
}

export function registerBuilderAliasRoutes(
  app: FastifyInstance,
  deps: { repos: Repositories; guard: AuthGuardDeps },
): void {
  const adminOnly = requireAuth(deps.guard, ['admin']);
  const anySignedIn = requireAuth(deps.guard, ['admin', 'operator']);
  const learned = async (organisationId: string) => deps.repos.builderAliases.list(organisationId);

  app.get('/v1/builder/aliases', {
    preHandler: anySignedIn,
    schema: { tags: ['forms'], response: { 200: LearnedAliasList, ...errorResponses } },
    handler: async (request) => ({
      aliases: (await learned(request.auth!.organisation.id)).map(asListed),
    }),
  });

  /**
   * Remembered: stored, or — remembered again — counted once more. A phrase that already means
   * another answer is refused and says which: a learned alias never overrides a built-in one, nor
   * an earlier learned one.
   */
  app.post('/v1/builder/aliases', {
    preHandler: anySignedIn,
    schema: {
      tags: ['forms'],
      body: RememberAlias,
      response: {
        200: RememberedAlias,
        201: RememberedAlias,
        409: AliasRefusedResponse,
        ...errorResponses,
      },
    },
    handler: async (request, reply) => {
      const organisationId = request.auth!.organisation.id;
      const wanted = RememberAlias.parse(request.body);
      const decide = async () => {
        const stored = await learned(organisationId);
        const refusal = aliasRefusal(BUILDER_GRAPH, wanted, [
          ...BUILTIN_ALIASES,
          ...stored.map(entryOf),
        ]);
        const key = keyOf(wanted.phrase);
        const same = stored.find(
          (a) =>
            a.locale === wanted.locale &&
            a.nodeId === wanted.nodeId &&
            a.optionId === wanted.optionId &&
            keyOf(a.phrase) === key,
        );
        return { refusal, same, key };
      };

      const first = await decide();
      if (first.refusal?.reason === 'present' && first.same) {
        const bumped = await deps.repos.builderAliases.bump(organisationId, first.same.id);
        if (bumped) return reply.send({ alias: asListed(bumped), created: false });
      }
      if (first.refusal) return refused(reply, first.refusal);

      const [added] = await deps.repos.builderAliases.add(organisationId, [
        {
          phrase: wanted.phrase,
          key: first.key,
          nodeId: wanted.nodeId,
          optionId: wanted.optionId,
          locale: wanted.locale,
          source: 'user-confirmed',
          createdAt: today(),
          count: 1,
          notes: '',
        },
      ]);
      if (added) return reply.code(201).send({ alias: asListed(added), created: true });
      // Someone remembered the same phrase a moment ago: decide again against what is stored now.
      const again = await decide();
      if (again.refusal?.reason === 'present' && again.same) {
        return reply.send({ alias: asListed(again.same), created: false });
      }
      return refused(reply, again.refusal ?? { reason: 'present' });
    },
  });

  app.delete('/v1/builder/aliases/:id', {
    preHandler: adminOnly,
    schema: {
      tags: ['forms'],
      params: IdParam,
      response: { 200: AliasesRemoved, ...errorResponses },
    },
    handler: async (request, reply) => {
      const { id } = IdParam.parse(request.params);
      const removed = await deps.repos.builderAliases.remove(request.auth!.organisation.id, id);
      if (!removed) {
        return reply
          .code(404)
          .send({ error: { code: 'not-found', message: 'No such learned phrase' } });
      }
      await recordAudit(deps.repos, request, {
        action: 'builder-alias.delete',
        entityType: 'builder_alias',
        entityId: id,
        before: entryOf(removed),
        after: null,
      });
      return reply.send({ removed: 1 });
    },
  });

  /** Back to the built-in aliases: every learned one removed. */
  app.delete('/v1/builder/aliases', {
    preHandler: adminOnly,
    schema: { tags: ['forms'], response: { 200: AliasesRemoved, ...errorResponses } },
    handler: async (request) => {
      const removed = await deps.repos.builderAliases.clear(request.auth!.organisation.id);
      await recordAudit(deps.repos, request, {
        action: 'builder-alias.clear',
        entityType: 'builder_alias',
        entityId: null,
        before: { count: removed },
        after: null,
      });
      return { removed };
    },
  });

  /** The alias file: the shipped files' shape and bytes, so a diff of two exports reads. */
  app.get('/v1/builder/aliases/export', {
    preHandler: adminOnly,
    schema: { tags: ['forms'], response: { ...errorResponses } },
    handler: async (request, reply) => {
      const stored = await learned(request.auth!.organisation.id);
      return reply
        .header('content-type', 'application/json; charset=utf-8')
        .header('content-disposition', 'attachment; filename="aliases.json"')
        .send(formatAliasFile({ aliasesVersion: ALIASES_VERSION, entries: stored.map(entryOf) }));
    },
  });

  /**
   * What importing a file would do — added, already there, refused and why — and, confirmed, the
   * same thing done. A file that does not parse is refused with its first problem: it never
   * reaches the ladder.
   */
  app.post('/v1/builder/aliases/import', {
    preHandler: adminOnly,
    bodyLimit: IMPORT_BODY_LIMIT,
    schema: {
      tags: ['forms'],
      body: ImportAliases,
      response: { 200: AliasImportResult, ...errorResponses },
    },
    handler: async (request, reply) => {
      const organisationId = request.auth!.organisation.id;
      const body = ImportAliases.parse(request.body);
      const file = AliasFile.safeParse(body.file);
      if (!file.success) {
        const issue = file.error.issues[0];
        return reply.code(422).send({
          error: {
            code: 'invalid-alias-file',
            message: `${issue?.path.join('.') || 'file'}: ${issue?.message ?? 'not an alias file'}`,
          },
        });
      }
      if (file.data.entries.length > MAX_IMPORTED_ALIASES) {
        return reply.code(422).send({
          error: {
            code: 'invalid-alias-file',
            message: `At most ${MAX_IMPORTED_ALIASES} entries in one file`,
          },
        });
      }
      const stored = await learned(organisationId);
      const diff = aliasImportDiff(
        BUILDER_GRAPH,
        file.data,
        [...BUILTIN_ALIASES, ...stored.map(entryOf)],
        today(),
      );
      if (body.confirm && diff.added.length > 0) {
        await deps.repos.builderAliases.add(
          organisationId,
          // Every added entry is stamped `imported` by the diff, whatever the file said.
          diff.added.map((entry) => ({
            ...entry,
            source: 'imported' as const,
            key: keyOf(entry.phrase),
          })),
        );
        await recordAudit(deps.repos, request, {
          action: 'builder-alias.import',
          entityType: 'builder_alias',
          entityId: null,
          before: null,
          after: { added: diff.added.length },
        });
      }
      return {
        added: diff.added,
        present: diff.present,
        refused: diff.refused.map(({ entry, reason, means }) => ({
          entry,
          reason,
          ...(means ? { means } : {}),
        })),
        stored: body.confirm,
      };
    },
  });
}
