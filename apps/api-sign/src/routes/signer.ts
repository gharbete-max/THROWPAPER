import { z } from 'zod';
import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { api } from '@tp/shared';
import { SignatureVector } from '@tp/shared/forms';
import {
  DocumentHash,
  Environment,
  EnvelopeStatus,
  PartyStatus,
  whoMaySign,
  type Envelope,
} from '@tp/signing';
import { declarations } from '../db/schema.js';
import { readToken } from '../envelopes/links.js';
import { documentBytes, withEnvelope, type Definition, type Loaded } from '../envelopes/store.js';
import type { Deps } from '../server.js';
import { fail } from './envelopes.js';

const TokenParam = z.object({ token: z.string().min(1).max(300) });

const SignerView = z.object({
  envelopeId: z.string(),
  documentName: z.string(),
  documentSha256: DocumentHash,
  environment: Environment,
  status: EnvelopeStatus,
  party: z.object({ id: z.string(), name: z.string(), locale: z.string(), status: PartyStatus }),
  /** Whether this party may sign right now — false before their turn, and after. */
  maySign: z.boolean(),
  /** Exactly what they approve by signing, in their language (ADR 0012). */
  declaration: z.object({ key: z.string(), version: z.number().int(), text: z.string() }),
});

/**
 * A typed name, or a drawn mark with its strokes.
 *
 * Drawn arrived with the signing page (P1c-4a), and only with the strokes: evidence that says
 * "drawn" without keeping them would claim more than it holds. The strokes are the pad's vector
 * paths in the same narrow grammar Forms' signature field uses (`@tp/shared/forms`), geometry
 * only — no timing or pressure, which would make them biometric data (ADR 0009).
 */
const DrawnMark = SignatureVector.refine((vector) => vector.kind === 'drawn', {
  message: 'A drawn signature carries paths',
});
const SignRequest = z.union([
  z.object({ typedName: z.string().trim().min(1).max(200) }).strict(),
  z.object({ drawn: DrawnMark }).strict(),
]);

const errors = { 404: api.ErrorResponse, 409: api.ErrorResponse } as const;

/**
 * The signer's side. The link is the only credential — it names one party of one envelope and is
 * unguessable (see `envelopes/links.ts`). A bad link and a missing envelope answer the same 404,
 * so the endpoint cannot be used to learn which envelope ids exist.
 */
export function registerSignerRoutes(app: FastifyInstance, deps: Deps): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  /** Read inside the envelope's transaction (`loaded`), never the pool — see `Loaded.db`. */
  async function declarationText(
    { db, definition }: Pick<Loaded, 'db' | 'definition'>,
    locale: string,
  ): Promise<string> {
    const [row] = await db
      .select()
      .from(declarations)
      .where(
        and(
          eq(declarations.key, definition.declaration.key),
          eq(declarations.version, definition.declaration.version),
          // Whose words were pinned: an envelope from before §5.5 has no owner, the shared ones.
          definition.declaration.organisationId
            ? eq(declarations.organisationId, definition.declaration.organisationId)
            : isNull(declarations.organisationId),
        ),
      );
    const text = row?.texts[locale];
    // Checked when the envelope was created, and the table is append-only — so this is corruption.
    if (!text) throw new Error(`declaration ${definition.declaration.key} lost its ${locale} text`);
    return text;
  }

  function view(envelope: Envelope, partyId: string, text: string, definition: Definition) {
    const party = envelope.parties.find((candidate) => candidate.id === partyId)!;
    return {
      envelopeId: envelope.id,
      documentName: envelope.documentName,
      documentSha256: envelope.documentSha256,
      environment: envelope.environment,
      status: envelope.status,
      party: {
        id: party.id,
        name: party.name,
        locale: party.locale,
        status: envelope.partyStatus[party.id] ?? 'waiting',
      },
      maySign: whoMaySign(envelope).includes(party.id),
      declaration: { ...definition.declaration, text },
    };
  }

  /** Resolves a link to its envelope and party, or null for anything that is not a live link. */
  function parse(token: string) {
    return readToken(deps.linkSecret, token);
  }

  typed.get('/v1/sign/:token', {
    schema: { tags: ['signer'], params: TokenParam, response: { 200: SignerView, ...errors } },
    handler: async (request, reply) => {
      const link = parse(request.params.token);
      const result =
        link &&
        (await withEnvelope(deps, link.envelopeId, deps.now(), async (loaded, append) => {
          if (!loaded.envelope.partyStatus[link.partyId]) return null;
          // Opening the link is evidence too — once, the first time it happens on their turn.
          if (loaded.envelope.partyStatus[link.partyId] === 'invited') {
            await append({ type: 'viewed', at: deps.now().toISOString(), partyId: link.partyId });
          }
          const party = loaded.envelope.parties.find((p) => p.id === link.partyId)!;
          const text = await declarationText(loaded, party.locale);
          return view(loaded.envelope, link.partyId, text, loaded.definition);
        }));
      if (!result) return fail(reply, 404, 'not-found', 'This link does not open anything');
      return reply.send(result);
    },
  });

  typed.get('/v1/sign/:token/document', {
    schema: { tags: ['signer'], params: TokenParam },
    handler: async (request, reply) => {
      const link = parse(request.params.token);
      const sha =
        link &&
        (await withEnvelope(deps, link.envelopeId, deps.now(), async ({ envelope }) =>
          envelope.partyStatus[link.partyId] ? envelope.documentSha256 : null,
        ));
      const bytes = sha ? await documentBytes(deps.db, sha) : null;
      if (!bytes) return fail(reply, 404, 'not-found', 'This link does not open anything');
      return reply
        .header('content-type', 'application/pdf')
        .header('cache-control', 'private, no-store')
        .send(Buffer.from(bytes));
    },
  });

  typed.post('/v1/sign/:token', {
    schema: {
      tags: ['signer'],
      params: TokenParam,
      body: SignRequest,
      response: { 200: SignerView, ...errors },
    },
    handler: async (request, reply) => {
      const link = parse(request.params.token);
      const outcome =
        link &&
        (await withEnvelope(deps, link.envelopeId, deps.now(), async (loaded, append) => {
          const { envelope, definition } = loaded;
          const party = envelope.parties.find((p) => p.id === link.partyId);
          if (!party) return null;
          const text = await declarationText(loaded, party.locale);
          const at = deps.now().toISOString();
          const refused = await append({
            type: 'signed',
            at,
            partyId: party.id,
            evidence: {
              method: 'typedName' in request.body ? 'typed' : 'drawn',
              level: 'simple',
              environment: envelope.environment,
              signedAt: at,
              documentSha256: envelope.documentSha256,
              // Byte for byte what the page showed them: "what did they agree to" is the first
              // question in a dispute, and a key without its text cannot answer it.
              declaration: { ...definition.declaration, text },
              details:
                'typedName' in request.body
                  ? { typedName: request.body.typedName }
                  : { vector: JSON.stringify(request.body.drawn) },
            },
          });
          if (refused) return refused;
          return view(loaded.envelope, party.id, text, definition);
        }));
      if (!outcome) return fail(reply, 404, 'not-found', 'This link does not open anything');
      if (typeof outcome === 'string') return fail(reply, 409, outcome, 'Not signed');
      return reply.send(outcome);
    },
  });

  typed.post('/v1/sign/:token/decline', {
    schema: { tags: ['signer'], params: TokenParam, response: { 200: SignerView, ...errors } },
    handler: async (request, reply) => {
      const link = parse(request.params.token);
      const outcome =
        link &&
        (await withEnvelope(deps, link.envelopeId, deps.now(), async (loaded, append) => {
          const party = loaded.envelope.parties.find((p) => p.id === link.partyId);
          if (!party) return null;
          const refused = await append({
            type: 'declined',
            at: deps.now().toISOString(),
            partyId: party.id,
          });
          if (refused) return refused;
          const text = await declarationText(loaded, party.locale);
          return view(loaded.envelope, party.id, text, loaded.definition);
        }));
      if (!outcome) return fail(reply, 404, 'not-found', 'This link does not open anything');
      if (typeof outcome === 'string') return fail(reply, 409, outcome, 'Not declined');
      return reply.send(outcome);
    },
  });
}
