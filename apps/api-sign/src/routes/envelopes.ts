import { randomUUID } from 'node:crypto';
import { checkPdf } from '../sealing/pdf-guard.js';
import { z } from 'zod';
import { and, asc, desc, eq, isNull, or } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { api } from '@tp/shared';
import {
  CreateEnvelopeRequest,
  CreateEnvelopeResponse,
  DeclarationListResponse,
  DeclarationView,
  WriteDeclarationRequest,
  EnvelopeStatusResponse,
  SealedDocumentResponse,
} from '@tp/shared/contract';
import { declarations, serviceTokens } from '../db/schema.js';
import { fetchDocument, originAllowed } from '../envelopes/fetch-document.js';
import { sealedToken, signToken } from '../envelopes/links.js';
import {
  createEnvelope,
  readSeal,
  sha256,
  withEnvelope,
  type Definition,
} from '../envelopes/store.js';
import type { Deps } from '../server.js';
import type { Db } from '../db/client.js';

const errors = { 401: api.ErrorResponse, 403: api.ErrorResponse, 404: api.ErrorResponse } as const;

interface Caller {
  tokenId: string;
  tokenSha256: string;
  organisationId: string;
  allowedOrigins: string[];
}

/**
 * CONTRACT §5.1 and §5.2, for callers holding a service token.
 *
 * The organisation is the token's, full stop. The request body names one too (the contract carries
 * it for the caller's own bookkeeping), and a body naming any other organisation is refused rather
 * than believed — otherwise one customer's token could create envelopes in another's name.
 */
export function registerEnvelopeRoutes(app: FastifyInstance, deps: Deps): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  /** Set by `authenticate` for every request that reaches a handler. */
  const callers = new WeakMap<FastifyRequest, Caller>();

  /**
   * Runs on `onRequest`, before the body is parsed or validated: a stranger gets 401 and nothing
   * else — not the schema's list of required fields, which would be a free map of the API.
   */
  async function authenticate(request: FastifyRequest, reply: FastifyReply) {
    const header = request.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
    if (token) {
      const [row] = await deps.db
        .select()
        .from(serviceTokens)
        .where(and(eq(serviceTokens.tokenSha256, sha256(token)), isNull(serviceTokens.revokedAt)));
      if (row) {
        callers.set(request, {
          tokenId: row.id,
          tokenSha256: row.tokenSha256,
          organisationId: row.organisationId,
          allowedOrigins: row.allowedOrigins,
        });
        return;
      }
    }
    return fail(reply, 401, 'unauthorised', 'A valid service token is required');
  }

  typed.post('/v1/envelopes', {
    onRequest: authenticate,
    schema: {
      tags: ['envelopes'],
      body: CreateEnvelopeRequest,
      response: {
        200: CreateEnvelopeResponse,
        201: CreateEnvelopeResponse,
        409: api.ErrorResponse,
        422: api.ErrorResponse,
        ...errors,
      },
    },
    handler: async (request, reply) => {
      const who = callers.get(request)!;
      const body = request.body;

      if (body.organisationId !== who.organisationId) {
        return fail(reply, 403, 'wrong-organisation', 'This token acts for another organisation');
      }
      if (body.hookUrl && !originAllowed(body.hookUrl, who.allowedOrigins)) {
        return fail(reply, 422, 'origin-not-allowed', 'hookUrl is not on an allowed origin');
      }
      const ids = body.parties.map((party) => party.id);
      if (new Set(ids).size !== ids.length) {
        return fail(reply, 422, 'duplicate-party', 'Two parties share an id');
      }
      const now = deps.now();
      if (Date.parse(body.expiresAt) <= now.getTime()) {
        return fail(reply, 422, 'past-expiry', 'expiresAt is in the past');
      }

      // The latest version of the named declaration is pinned now: what a signer sees cannot
      // change after the envelope is sent, even when a person revises the text tomorrow.
      // The organisation's own words first; the shared placeholder only if it has none by that key.
      const declaration = await latestDeclaration(deps.db, who.organisationId, body.declarationKey);
      if (!declaration) {
        return fail(reply, 422, 'unknown-declaration', 'No declaration has that key');
      }
      if (declaration.testOnly && body.environment === 'production') {
        return fail(
          reply,
          422,
          'declaration-not-authored',
          'That declaration is a test-mode placeholder; a person must write the text first',
        );
      }
      const missing = body.parties.find((party) => !declaration.texts[party.locale]);
      if (missing) {
        return fail(
          reply,
          422,
          'declaration-missing-locale',
          `The declaration has no text in ${missing.locale}`,
        );
      }

      const fetched = await fetchDocument(body.documentUrl, who.allowedOrigins, deps.fetch);
      if (!fetched.ok) return fail(reply, 422, fetched.reason, 'The document could not be used');
      if (sha256(fetched.bytes) !== body.documentSha256) {
        return fail(reply, 422, 'wrong-document', 'The document does not match documentSha256');
      }
      // Refused now, not when the last party signs: a PDF the sealer cannot open would otherwise
      // take every signature on it and then fail to complete.
      // Parsed first in a worker on a budget (`pdf-guard.ts`): a document that would hold the event
      // loop for seconds is refused without this server ever loading it.
      const checked = await checkPdf(fetched.bytes);
      if (!checked.ok) {
        return checked.reason === 'too-costly'
          ? fail(reply, 422, 'pdf-too-costly', 'The document is too costly to open')
          : fail(reply, 422, 'unreadable-pdf', 'The document is not a PDF Sign can seal');
      }

      const definition: Definition = {
        organisationId: who.organisationId,
        envelope: {
          id: randomUUID(),
          documentName: body.documentName,
          documentSha256: body.documentSha256,
          routing: body.routing,
          parties: body.parties,
          environment: body.environment,
          expiresAt: body.expiresAt,
        },
        declaration: {
          key: declaration.key,
          version: declaration.version,
          organisationId: declaration.organisationId,
        },
        hookUrl: body.hookUrl ?? null,
      };
      const { id, created } = await createEnvelope(deps.db, {
        definition,
        idempotencyKey: body.idempotencyKey,
        document: fetched.bytes,
        at: now,
        serviceTokenId: who.tokenId,
      });
      // The one event not appended through `withEnvelope`, so its hook is posted here.
      if (created && definition.hookUrl) {
        deps.hooks?.deliver({
          hookUrl: definition.hookUrl,
          tokenSha256: who.tokenSha256,
          events: [{ envelopeId: id, event: 'sent', at: now.toISOString() }],
        });
      }

      const answer = await withEnvelope(deps, id, now, async ({ definition, envelope }) => {
        // A key reused for a different document is a caller bug, not a retry.
        if (!created && definition.envelope.documentSha256 !== body.documentSha256) return null;
        return {
          envelopeId: id,
          status: envelope.status,
          signUrls: Object.fromEntries(
            envelope.parties.map((party) => [
              party.id,
              `${deps.publicUrl}/s/${signToken(deps.linkSecret, id, party.id)}`,
            ]),
          ),
        };
      });
      if (!answer) {
        return fail(reply, 409, 'idempotency-key-reused', 'That key was used for another document');
      }
      return reply.code(created ? 201 : 200).send(answer);
    },
  });

  typed.get('/v1/envelopes/:id', {
    onRequest: authenticate,
    schema: {
      tags: ['envelopes'],
      params: z.object({ id: z.string().uuid() }),
      response: { 200: EnvelopeStatusResponse, ...errors },
    },
    handler: async (request, reply) => {
      const who = callers.get(request)!;

      const status = await withEnvelope(
        deps,
        request.params.id,
        deps.now(),
        async ({ organisationId, envelope }) =>
          // Another organisation's envelope does not exist, as far as this caller can tell.
          organisationId !== who.organisationId
            ? null
            : {
                envelopeId: envelope.id,
                status: envelope.status,
                environment: envelope.environment,
                documentSha256: envelope.documentSha256,
                parties: envelope.parties.map((party) => ({
                  ...party,
                  status: envelope.partyStatus[party.id] ?? 'waiting',
                })),
              },
      );
      if (!status) return fail(reply, 404, 'not-found', 'Not found');
      return reply.send(status);
    },
  });

  /** §5.5 — the latest version of every declaration this organisation may use. */
  typed.get('/v1/declarations', {
    onRequest: authenticate,
    schema: { tags: ['declarations'], response: { 200: DeclarationListResponse, ...errors } },
    handler: async (request, reply) => {
      const who = callers.get(request)!;
      const rows = await deps.db
        .select()
        .from(declarations)
        .where(
          or(
            eq(declarations.organisationId, who.organisationId),
            isNull(declarations.organisationId),
          ),
        )
        .orderBy(asc(declarations.key), desc(declarations.version));
      // One per key and owner: the latest. An organisation's own key hides a shared one.
      const latest = new Map<string, (typeof rows)[number]>();
      for (const row of rows) {
        const current = latest.get(row.key);
        const own = row.organisationId !== null;
        if (!current || (own && current.organisationId === null)) latest.set(row.key, row);
      }
      return reply.send({ declarations: [...latest.values()].map(declarationView) });
    },
  });

  /**
   * §5.5 — a person's words, as a new version. Never Loppa's (rule 8): this only stores what the
   * caller sends, and the caller's screen is where a person writes it. A version already used by
   * an envelope stays as it was — envelopes pin theirs — so a change can never alter what somebody
   * already signed.
   */
  typed.post('/v1/declarations', {
    onRequest: authenticate,
    schema: {
      tags: ['declarations'],
      body: WriteDeclarationRequest,
      response: { 201: DeclarationView, 422: api.ErrorResponse, ...errors },
    },
    handler: async (request, reply) => {
      const who = callers.get(request)!;
      const body = request.body;
      if (body.organisationId !== who.organisationId) {
        return fail(reply, 403, 'wrong-organisation', 'This token acts for another organisation');
      }
      const row = await deps.db.transaction(async (tx) => {
        const [previous] = await tx
          .select({ version: declarations.version })
          .from(declarations)
          .where(
            and(
              eq(declarations.organisationId, who.organisationId),
              eq(declarations.key, body.key),
            ),
          )
          .orderBy(desc(declarations.version))
          .limit(1)
          .for('update');
        const [inserted] = await tx
          .insert(declarations)
          .values({
            organisationId: who.organisationId,
            key: body.key,
            version: (previous?.version ?? 0) + 1,
            texts: body.texts,
            testOnly: false,
          })
          .returning();
        return inserted!;
      });
      return reply.code(201).send(declarationView(row));
    },
  });

  typed.get('/v1/envelopes/:id/sealed', {
    onRequest: authenticate,
    schema: {
      tags: ['envelopes'],
      params: z.object({ id: z.string().uuid() }),
      response: { 200: SealedDocumentResponse, 409: api.ErrorResponse, ...errors },
    },
    handler: async (request, reply) => {
      const who = callers.get(request)!;
      const now = deps.now();

      const found = await withEnvelope(deps, request.params.id, now, async (loaded) => {
        if (loaded.organisationId !== who.organisationId) return null;
        if (loaded.envelope.status !== 'completed') return { status: loaded.envelope.status };
        const seal = await readSeal(loaded.db, loaded.envelope.id, loaded.trailSha256);
        // Completed and sealed are one transaction (`withEnvelope`), so a missing seal is damage.
        if (!seal) throw new Error(`envelope ${loaded.envelope.id} is completed without a seal`);
        return { sha256: seal.sha256 };
      });
      if (!found) return fail(reply, 404, 'not-found', 'Not found');
      if ('status' in found) {
        return fail(reply, 409, 'not-completed', `The envelope is ${found.status}, not completed`);
      }

      const expiresAt = new Date(now.getTime() + SEALED_LINK_SECONDS * 1000);
      return reply.send({
        envelopeId: request.params.id,
        url: `${deps.apiUrl}/v1/sealed/${sealedToken(deps.linkSecret, request.params.id, expiresAt)}`,
        sealedSha256: found.sha256,
        expiresAt: expiresAt.toISOString(),
      });
    },
  });
}

/** How long a §5.3 link lives. Long enough to download, short enough that a leaked one dies. */
export const SEALED_LINK_SECONDS = 10 * 60;

/** The declaration an envelope in `organisationId` would pin for `key`: its own, else shared. */
async function latestDeclaration(db: Db, organisationId: string, key: string) {
  const rows = await db
    .select()
    .from(declarations)
    .where(
      and(
        eq(declarations.key, key),
        or(eq(declarations.organisationId, organisationId), isNull(declarations.organisationId)),
      ),
    )
    .orderBy(desc(declarations.version));
  return rows.find((row) => row.organisationId === organisationId) ?? rows[0];
}

function declarationView(row: typeof declarations.$inferSelect): DeclarationView {
  return {
    key: row.key,
    version: row.version,
    texts: row.texts,
    authored: !row.testOnly,
    shared: row.organisationId === null,
  };
}

export function fail(reply: FastifyReply, status: number, code: string, message: string) {
  return reply.code(status).send({ error: { code, message } });
}
