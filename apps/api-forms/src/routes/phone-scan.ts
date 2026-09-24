import QRCode from 'qrcode';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { defaultTokens } from '@tp/tokens';
import { api, forms as formSchemas } from '@tp/shared';
import type { AuthGuardDeps } from '../auth/plugin.js';
import { requireAuth } from '../auth/plugin.js';
import { QR_DARK } from '../documents/admission.js';
import { imageType, type PhoneScanStore } from '../phone-scan/store.js';

const IdParam = z.object({ id: z.string().uuid() });
const PageParam = z.object({ id: z.string().uuid(), n: z.coerce.number().int().min(1) });
// 32 random bytes, base64url: anything else is not a link this server made.
const TokenParam = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) });
const errors = {
  401: api.ErrorResponse,
  404: api.ErrorResponse,
  409: api.ErrorResponse,
  422: api.ErrorResponse,
  503: api.ErrorResponse,
} as const;

function notFound() {
  return { error: { code: 'not-found', message: 'Not found' } };
}

/**
 * Scanning with a phone for this computer. The signed-in person opens a session and shows its QR
 * code; the phone — signed in to nothing — sends photographed pages to the link; the computer
 * fetches them and closes the session. The phone's routes (`/v1/phone-scan/:token`) are the only
 * ones the desktop's LAN relay passes through (`desktop/phone-relay.ts`).
 */
export function registerPhoneScanRoutes(
  app: FastifyInstance,
  deps: {
    guard: AuthGuardDeps;
    store: PhoneScanStore;
    /**
     * Where a phone can reach this app: the public origin on a server, the LAN relay on the
     * desktop. Null when there is none (a desktop on no network), and the screen says so.
     */
    phoneOrigin: () => Promise<string | null>;
  },
): void {
  const authenticated = requireAuth(deps.guard);

  function view(session: {
    id: string;
    expiresAt: Date;
    pages: unknown[];
  }): Omit<formSchemas.PhoneScanSession, 'phoneUrl' | 'qrSvg'> {
    return {
      id: session.id,
      expiresAt: session.expiresAt.toISOString(),
      pages: session.pages.length,
    };
  }

  app.post('/v1/phone-scans', {
    preHandler: authenticated,
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    schema: { tags: ['phone-scan'], response: { 201: formSchemas.PhoneScanSession, ...errors } },
    handler: async (request, reply) => {
      const auth = request.auth!;
      const origin = await deps.phoneOrigin();
      if (!origin) {
        return reply.code(503).send({
          error: { code: 'no-network', message: 'No network a phone could reach this computer on' },
        });
      }
      const { session, token } = deps.store.open({
        organisationId: auth.organisation.id,
        userId: auth.user.id,
      });
      const phoneUrl = `${origin.replace(/\/$/, '')}/phone-scan/${token}`;
      const qrSvg = await QRCode.toString(phoneUrl, {
        type: 'svg',
        errorCorrectionLevel: 'M',
        margin: 2,
        color: { dark: QR_DARK, light: defaultTokens.colour.background },
      });
      return reply.code(201).send({ ...view(session), phoneUrl, qrSvg });
    },
  });

  app.get('/v1/phone-scans/:id', {
    preHandler: authenticated,
    schema: {
      tags: ['phone-scan'],
      params: IdParam,
      response: {
        200: formSchemas.PhoneScanSession.omit({ phoneUrl: true, qrSvg: true }),
        ...errors,
      },
    },
    handler: async (request, reply) => {
      const auth = request.auth!;
      const session = deps.store.find(IdParam.parse(request.params).id, {
        organisationId: auth.organisation.id,
        userId: auth.user.id,
      });
      if (!session) return reply.code(404).send(notFound());
      return reply.send(view(session));
    },
  });

  app.get('/v1/phone-scans/:id/pages/:n', {
    preHandler: authenticated,
    schema: { tags: ['phone-scan'], params: PageParam, response: { ...errors } },
    handler: async (request, reply) => {
      const auth = request.auth!;
      const { id, n } = PageParam.parse(request.params);
      const page = deps.store.find(id, {
        organisationId: auth.organisation.id,
        userId: auth.user.id,
      })?.pages[n - 1];
      if (!page) return reply.code(404).send(notFound());
      return reply
        .header('content-type', page.contentType)
        .header('cache-control', 'no-store')
        .send(Buffer.from(page.bytes));
    },
  });

  /** Done, or abandoned: the pages go with it. They were never stored anywhere else. */
  app.delete('/v1/phone-scans/:id', {
    preHandler: authenticated,
    schema: { tags: ['phone-scan'], params: IdParam, response: { 204: z.null(), ...errors } },
    handler: async (request, reply) => {
      const auth = request.auth!;
      const session = deps.store.find(IdParam.parse(request.params).id, {
        organisationId: auth.organisation.id,
        userId: auth.user.id,
      });
      if (session) deps.store.close(session.id);
      return reply.code(204).send();
    },
  });

  // ── The phone's side: no session, only the link ──────────────────────────────────────────

  app.get('/v1/phone-scan/:token', {
    config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
    schema: {
      tags: ['phone-scan'],
      params: TokenParam,
      response: { 200: formSchemas.PhoneScanStatus, ...errors },
    },
    handler: async (request, reply) => {
      const session = deps.store.byToken(TokenParam.parse(request.params).token);
      if (!session) return reply.code(404).send(notFound());
      return reply.send({
        pages: session.pages.length,
        maxPages: formSchemas.PHONE_SCAN_MAX_PAGES,
        expiresAt: session.expiresAt.toISOString(),
      });
    },
  });

  app.post('/v1/phone-scan/:token/pages', {
    // A 6 MB photograph is ~8 MB of base64.
    bodyLimit: 9 * 1024 * 1024,
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    schema: {
      tags: ['phone-scan'],
      params: TokenParam,
      body: formSchemas.PhoneScanPage,
      response: { 201: formSchemas.PhoneScanStatus, ...errors },
    },
    handler: async (request, reply) => {
      const session = deps.store.byToken(TokenParam.parse(request.params).token);
      if (!session) return reply.code(404).send(notFound());
      const body = formSchemas.PhoneScanPage.parse(request.body);
      const bytes = new Uint8Array(Buffer.from(body.base64, 'base64'));
      const type = imageType(bytes);
      if (!type) {
        return reply
          .code(422)
          .send({ error: { code: 'not-an-image', message: 'That is not a JPEG or PNG' } });
      }
      if (!deps.store.add(session, { contentType: type, bytes })) {
        return reply
          .code(409)
          .send({ error: { code: 'full', message: 'This scan has as many pages as it can take' } });
      }
      return reply.code(201).send({
        pages: session.pages.length,
        maxPages: formSchemas.PHONE_SCAN_MAX_PAGES,
        expiresAt: session.expiresAt.toISOString(),
      });
    },
  });
}
