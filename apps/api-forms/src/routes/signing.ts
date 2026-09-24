import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { api, forms as formSchemas } from '@tp/shared';
import { SigningHookEvent } from '@tp/shared/contract';
import type { AuthGuardDeps } from '../auth/plugin.js';
import { requireAuth } from '../auth/plugin.js';
import type {
  Repositories,
  SigningRequestParty,
  SigningRequestRecord,
} from '../db/repositories/index.js';
import { recordAudit } from '../audit.js';
import type { DocumentStore } from '../documents/store.js';
import { fillPaper } from '../documents/paper.js';
import type { PdfRenderer } from '../documents/render.js';
import type { PrivateUploadStore } from '../uploads/private-store.js';
import { resolveFormAccess } from '../forms/access.js';
import { SignRefused, SignUnavailable, type SignClient } from '../signing/client.js';
import { createHash } from 'node:crypto';
import { pagesToPdf } from '../signing/scan.js';

const IdParam = z.object({ id: z.string().uuid() });
const errors = {
  401: api.ErrorResponse,
  404: api.ErrorResponse,
  409: api.ErrorResponse,
  422: api.ErrorResponse,
  502: api.ErrorResponse,
  503: api.ErrorResponse,
} as const;

/** The most a PDF sent for signing may weigh — Sign itself refuses above 25 MB. */
const MAX_PDF_BYTES = 10 * 1024 * 1024;

/**
 * Sending a document for signing (ROADMAP P1c-3): Forms is the caller of CONTRACT §5.
 *
 * Forms keeps a row per request — the envelope's id, the parties and their links, the last status
 * — and nothing of the evidence, which lives at Sign (ADR 0009). The PDF reaches Sign the way the
 * contract says: Sign fetches it once from a short-lived signed link on this server, and refuses
 * it unless it hashes to what Forms said.
 */
export function registerSigningRoutes(
  app: FastifyInstance,
  deps: {
    repos: Repositories;
    guard: AuthGuardDeps;
    store: DocumentStore;
    uploadStore: PrivateUploadStore;
    renderer: PdfRenderer;
    /** Absent when this deployment has no Sign: the routes say so rather than fail. */
    sign: SignClient | null;
    /** Where Sign can reach this API from: the documents it fetches and the hooks it posts. */
    publicApiUrl: string;
  },
): void {
  const authenticated = requireAuth(deps.guard);

  function unavailable(reply: FastifyReply) {
    return reply.code(503).send({
      error: { code: 'signing-not-configured', message: 'Signing is not set up here' },
    });
  }

  function failed(reply: FastifyReply, error: unknown) {
    if (error instanceof SignRefused) {
      return reply
        .code(error.status >= 500 ? 502 : 422)
        .send({ error: { code: error.code, message: 'Sign refused the request' } });
    }
    if (error instanceof SignUnavailable) {
      return reply.code(502).send({ error: { code: 'sign-unavailable', message: error.message } });
    }
    throw error;
  }

  app.get('/v1/signing/requests', {
    preHandler: authenticated,
    schema: {
      tags: ['signing'],
      response: { 200: formSchemas.SigningRequestList, ...errors },
    },
    handler: async (request, reply) => {
      const auth = request.auth!;
      const rows = await deps.repos.signingRequests.list(auth.organisation.id);
      return reply.send({ enabled: deps.sign !== null, requests: rows.map(view) });
    },
  });

  app.post('/v1/signing/requests', {
    preHandler: authenticated,
    // A 10 MB PDF is ~13.4 MB of base64.
    bodyLimit: 15 * 1024 * 1024,
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    schema: {
      tags: ['signing'],
      body: formSchemas.CreateSigningRequest,
      response: { 201: formSchemas.SigningRequestView, ...errors },
    },
    handler: async (request, reply) => {
      const auth = request.auth!;
      if (!deps.sign) return unavailable(reply);
      const body = formSchemas.CreateSigningRequest.parse(request.body);

      let pdf: Buffer;
      let documentName: string;
      let submissionId: string | null = null;
      if (body.source === 'upload') {
        pdf = Buffer.from(body.pdfBase64, 'base64');
        documentName = body.documentName;
      } else if (body.source === 'scan') {
        try {
          pdf = await pagesToPdf(body.pages);
        } catch {
          return reply.code(422).send({
            error: { code: 'unreadable-scan', message: 'A scanned page is not an image' },
          });
        }
        documentName = body.documentName;
      } else {
        const submission = await deps.repos.submissions.findById(
          auth.organisation.id,
          body.submissionId,
        );
        if (!submission || !(await resolveFormAccess(deps.repos, auth, submission.formId))) {
          return reply.code(404).send({ error: { code: 'not-found', message: 'Not found' } });
        }
        const version = (await deps.repos.forms.listVersions(submission.formId)).find(
          (candidate) => candidate.id === submission.formVersionId,
        );
        const definition = formSchemas.FormDefinition.safeParse(version?.definition);
        if (!definition.success || !definition.data.paper) {
          return reply
            .code(409)
            .send({ error: { code: 'no-paper', message: 'This form was not made from paper' } });
        }
        const filled = await fillPaper(
          { uploadStore: deps.uploadStore, renderer: deps.renderer },
          submission,
          definition.data,
          {
            supported: auth.organisation.supportedLocales,
            default: auth.organisation.defaultLocale,
          },
        );
        if (!filled)
          return reply.code(404).send({ error: { code: 'not-found', message: 'Not found' } });
        pdf = filled.pdf;
        documentName = filled.filename.replace(/\.pdf$/i, '');
        submissionId = submission.id;
      }

      if (pdf.byteLength === 0 || pdf.byteLength > MAX_PDF_BYTES) {
        return reply.code(422).send({
          error: { code: 'pdf-size', message: 'The PDF must be between 1 byte and 10 MB' },
        });
      }
      if (pdf.subarray(0, 5).toString('latin1') !== '%PDF-') {
        return reply.code(422).send({ error: { code: 'not-a-pdf', message: 'That is not a PDF' } });
      }

      // Stored where the download route serves it, behind a link that dies in ten minutes: long
      // enough for Sign to fetch it once, short enough that a leaked link is worth nothing.
      const stored = await deps.store.put(`${randomUUID()}.pdf`, pdf);
      const documentUrl = `${deps.publicApiUrl}${deps.store.signedPath(stored.key, 10 * 60)}`;
      const id = randomUUID();
      const parties = body.parties.map((party, index) => ({
        id: `p${index + 1}`,
        name: party.name,
        ...(party.email ? { email: party.email } : {}),
        locale: party.locale,
        order: body.routing === 'sequential' ? index + 1 : 1,
      }));

      let created;
      try {
        created = await deps.sign.create({
          organisationId: auth.organisation.id,
          documentName,
          documentUrl,
          documentSha256: createHash('sha256').update(pdf).digest('hex'),
          parties,
          routing: body.routing,
          expiresAt: new Date(Date.now() + body.expiresInDays * 86_400_000).toISOString(),
          declarationKey: body.declarationKey,
          environment: body.environment,
          hookUrl: `${deps.publicApiUrl}/hooks/signing`,
          // This request's id: a retry after a lost answer finds the same envelope at Sign.
          idempotencyKey: id,
        });
      } catch (error) {
        return failed(reply, error);
      }

      const record = await deps.repos.signingRequests.create({
        id,
        organisationId: auth.organisation.id,
        envelopeId: created.envelopeId,
        documentName,
        source: body.source,
        submissionId,
        environment: body.environment,
        status: created.status,
        parties: parties.map((party) => ({
          ...party,
          status: 'invited',
          signUrl: created.signUrls[party.id] ?? '',
        })),
        createdBy: auth.user.id,
      });
      await recordAudit(deps.repos, request, {
        action: 'signing.requested',
        entityType: 'signing_request',
        entityId: record.id,
        after: { envelopeId: record.envelopeId, parties: record.parties.length },
      });
      return reply.code(201).send(view(record));
    },
  });

  /** Where it stands, asked of Sign (§5.2) — the truth, which a hook only hints at. */
  app.get('/v1/signing/requests/:id', {
    preHandler: authenticated,
    schema: {
      tags: ['signing'],
      params: IdParam,
      response: { 200: formSchemas.SigningRequestView, ...errors },
    },
    handler: async (request, reply) => {
      const auth = request.auth!;
      const record = await deps.repos.signingRequests.findById(
        auth.organisation.id,
        IdParam.parse(request.params).id,
      );
      if (!record)
        return reply.code(404).send({ error: { code: 'not-found', message: 'Not found' } });
      if (!deps.sign) return reply.send(view(record));
      try {
        return reply.send(view(await refresh(deps.sign, deps.repos, record)));
      } catch (error) {
        return failed(reply, error);
      }
    },
  });

  /** The sealed PDF, fetched from Sign through §5.3 and handed over as it came. */
  app.get('/v1/signing/requests/:id/sealed.pdf', {
    preHandler: authenticated,
    schema: { tags: ['signing'], params: IdParam, response: { ...errors } },
    handler: async (request, reply) => {
      const auth = request.auth!;
      const record = await deps.repos.signingRequests.findById(
        auth.organisation.id,
        IdParam.parse(request.params).id,
      );
      if (!record)
        return reply.code(404).send({ error: { code: 'not-found', message: 'Not found' } });
      if (!deps.sign) return unavailable(reply);
      let sealed;
      try {
        sealed = await deps.sign.sealed(record.envelopeId);
      } catch (error) {
        return failed(reply, error);
      }
      if (!sealed) {
        return reply
          .code(409)
          .send({ error: { code: 'not-completed', message: 'Not everyone has signed yet' } });
      }
      const filename = `${record.documentName.replace(/[^\p{L}\p{N} ._-]+/gu, '_')}-signed.pdf`;
      return reply
        .header('content-type', 'application/pdf')
        .header(
          'content-disposition',
          `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        )
        .header('cache-control', 'private, no-store')
        .send(Buffer.from(sealed.bytes));
    },
  });

  /**
   * CONTRACT §5.4. Sign's hook is a hint — "look now" — so it is checked, and then the state is
   * read from §5.2 rather than believed. The raw body is what is signed, so it is parsed here as a
   * string, in a scope of its own, and never re-serialised before the check.
   */
  void app.register(async (scope) => {
    scope.addContentTypeParser('application/json', { parseAs: 'string' }, (_request, raw, done) =>
      done(null, raw),
    );
    scope.post('/hooks/signing', {
      config: { rateLimit: { max: 600, timeWindow: '1 minute' } },
      handler: async (request, reply) => {
        if (!deps.sign) return unavailable(reply);
        const raw = typeof request.body === 'string' ? request.body : '';
        const header = request.headers['x-loppa-signature'];
        if (!deps.sign.verifyHook(raw, typeof header === 'string' ? header : undefined)) {
          return reply.code(401).send({ error: { code: 'bad-signature', message: 'Unsigned' } });
        }
        const parsed = SigningHookEvent.safeParse(JSON.parse(raw));
        if (!parsed.success) {
          return reply
            .code(400)
            .send({ error: { code: 'bad-event', message: 'Not a §5.4 event' } });
        }
        const record = await deps.repos.signingRequests.findByEnvelope(parsed.data.envelopeId);
        // Acknowledged either way: an envelope this deployment does not know is not Sign's fault.
        if (record) {
          try {
            await refresh(deps.sign, deps.repos, record);
          } catch (error) {
            request.log.warn({ err: error }, 'signing hook: status refresh failed');
          }
        }
        return reply.code(204).send();
      },
    });
  });
}

async function refresh(
  sign: SignClient,
  repos: Repositories,
  record: SigningRequestRecord,
): Promise<SigningRequestRecord> {
  const status = await sign.status(record.envelopeId);
  const parties: SigningRequestParty[] = record.parties.map((party) => ({
    ...party,
    status: status.parties.find((candidate) => candidate.id === party.id)?.status ?? party.status,
  }));
  return (
    (await repos.signingRequests.saveStatus(record.id, { status: status.status, parties })) ??
    record
  );
}

function view(record: SigningRequestRecord): formSchemas.SigningRequestView {
  return {
    id: record.id,
    envelopeId: record.envelopeId,
    documentName: record.documentName,
    source: record.source,
    submissionId: record.submissionId,
    environment: record.environment,
    status: record.status,
    parties: record.parties,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}
