import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// Both products, in one process, speaking only CONTRACT §5 to each other over (injected) HTTP.
// This file lives outside either app because rule 1 forbids either app importing the other.
import {
  bearer,
  createTestHarness,
  signIn,
  testOrganisation,
  type TestHarness,
} from '../../apps/api-forms/src/test-support.js';
import { buildServer as buildSign } from '../../apps/api-sign/src/server.js';
import { openLocalSignDatabase } from '../../apps/api-sign/src/db/pglite.js';
import { MIGRATIONS } from '../../apps/api-sign/src/db/client.js';
import { declarations, serviceTokens } from '../../apps/api-sign/src/db/schema.js';
import { createHookDelivery } from '../../apps/api-sign/src/envelopes/hooks.js';
import { generateDevCertificate, loadSealer } from '../../apps/api-sign/src/sealing/certificate.js';
import { extractSeal, opensslVerify } from '../../apps/api-sign/src/sealing/openssl-validator.js';

/**
 * P1c-3: Forms sends a PDF for signing, the parties sign at Sign, Sign tells Forms (§5.4), Forms
 * asks where it stands (§5.2) and hands over the sealed file (§5.3). The two servers are the real
 * ones; only the network between them is `inject`.
 */
const FORMS = 'http://localhost:5173';
const SIGN = 'http://sign.test';
const SERVICE_TOKEN = `svc_${randomUUID()}`;

/** `fetch`, answered by a Fastify app in this process. Strips `/api` as Vite's proxy would. */
function bridge(
  getApp: () => { inject: TestHarness['app']['inject'] },
  origin: string,
): typeof fetch {
  return (async (input: string | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    if (url.origin !== origin) throw new Error(`no route to ${url.origin}`);
    const response = await getApp().inject({
      method: (init.method ?? 'GET') as 'GET',
      url: `${url.pathname.replace(/^\/api(?=\/)/, '')}${url.search}`,
      headers: init.headers as Record<string, string>,
      ...(init.body ? { payload: init.body as string } : {}),
    });
    return new Response(response.statusCode === 204 ? null : new Uint8Array(response.rawPayload), {
      status: response.statusCode,
      headers: response.headers as Record<string, string>,
    });
  }) as typeof fetch;
}

/** A one-page PDF, written out by hand (as `e2e/sign.spec.ts` does). */
function tinyPdf(): Buffer {
  const stream = 'BT /F1 18 Tf 72 760 Td (Lease) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body = '%PDF-1.7\n';
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) body += `${String(offset).padStart(10, '0')} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

let forms: TestHarness;
let sign: Awaited<ReturnType<typeof buildSign>>;
let closeSignDb: () => Promise<void>;
let hooks: ReturnType<typeof createHookDelivery>;
let admin: string;

beforeAll(async () => {
  const local = await openLocalSignDatabase({ migrationsFolder: MIGRATIONS });
  closeSignDb = local.close;
  await local.db.insert(serviceTokens).values({
    organisationId: testOrganisation.id,
    name: 'forms',
    tokenSha256: createHash('sha256').update(SERVICE_TOKEN).digest('hex'),
    allowedOrigins: [FORMS],
  });
  await local.db.insert(declarations).values({
    key: 'demo',
    version: 1,
    testOnly: true,
    texts: { 'sv-SE': '[placeholder sv]', 'en-GB': '[placeholder en]' },
  });

  hooks = createHookDelivery({ fetch: bridge(() => forms.app, FORMS), backoff: [], log: () => {} });
  sign = await buildSign({
    db: local.db,
    linkSecret: 'contract-test-link-secret-at-least-32-chars',
    publicUrl: SIGN,
    apiUrl: SIGN,
    sealer: await loadSealer(await generateDevCertificate()),
    fetch: bridge(() => forms.app, FORMS),
    hooks,
  });
  forms = await createTestHarness(
    {},
    { signing: { apiUrl: SIGN, serviceToken: SERVICE_TOKEN }, signFetch: bridge(() => sign, SIGN) },
  );
  admin = (await signIn(forms, 'admin@example.com')).accessToken;
});

afterAll(async () => {
  await forms?.app.close();
  await sign?.close();
  await closeSignDb?.();
});

describe('Forms sends a PDF to Sign, and gets a sealed one back (CONTRACT §5)', () => {
  it('creates, signs, hears the hook, and hands over a sealed file OpenSSL accepts', async () => {
    const created = await forms.app.inject({
      method: 'POST',
      url: '/v1/signing/requests',
      headers: bearer(admin),
      payload: {
        source: 'upload',
        documentName: 'Hyresavtal',
        pdfBase64: tinyPdf().toString('base64'),
        parties: [
          { name: 'Åsa Öberg', locale: 'sv-SE' },
          { name: 'Jon Smith', email: 'jon@example.com', locale: 'en-GB' },
        ],
        declarationKey: 'demo',
      },
    });
    expect(created.statusCode).toBe(201);
    const request = created.json();
    expect(request.environment).toBe('test');
    expect(
      request.parties.map((p: { signUrl: string }) => p.signUrl.startsWith(`${SIGN}/s/`)),
    ).toEqual([true, true]);

    // Nothing sealed yet.
    expect(
      (
        await forms.app.inject({
          method: 'GET',
          url: `/v1/signing/requests/${request.id}/sealed.pdf`,
          headers: bearer(admin),
        })
      ).statusCode,
    ).toBe(409);

    for (const party of request.parties as { signUrl: string; name: string }[]) {
      const token = party.signUrl.split('/s/')[1]!;
      const signed = await sign.inject({
        method: 'POST',
        url: `/v1/sign/${token}`,
        payload: { typedName: party.name },
      });
      expect(signed.statusCode).toBe(200);
    }
    await hooks.idle();

    // The hook made Forms look: the list already says completed, without anyone refreshing.
    const list = (
      await forms.app.inject({ method: 'GET', url: '/v1/signing/requests', headers: bearer(admin) })
    ).json();
    expect(list.enabled).toBe(true);
    expect(list.requests[0].status).toBe('completed');
    expect(list.requests[0].parties.map((p: { status: string }) => p.status)).toEqual([
      'signed',
      'signed',
    ]);

    const sealed = await forms.app.inject({
      method: 'GET',
      url: `/v1/signing/requests/${request.id}/sealed.pdf`,
      headers: bearer(admin),
    });
    expect(sealed.statusCode).toBe(200);
    expect(sealed.headers['content-type']).toBe('application/pdf');
    const bytes = new Uint8Array(sealed.rawPayload);
    const seal = extractSeal(bytes);
    expect(opensslVerify(seal.signedContent, seal.cms, 'embedded').ok).toBe(true);
  });

  it('sends a paper form only for a submission this organisation can see', async () => {
    const unknown = await forms.app.inject({
      method: 'POST',
      url: '/v1/signing/requests',
      headers: bearer(admin),
      payload: {
        source: 'paper',
        submissionId: '99999999-9999-4999-8999-999999999999',
        parties: [{ name: 'Åsa', locale: 'sv-SE' }],
        declarationKey: 'demo',
      },
    });
    expect(unknown.statusCode).toBe(404);
  });

  it('refuses a hook it cannot verify, and a request from somebody not signed in', async () => {
    const forged = await forms.app.inject({
      method: 'POST',
      url: '/hooks/signing',
      headers: { 'content-type': 'application/json', 'x-loppa-signature': 'sha256=00' },
      payload: JSON.stringify({
        envelopeId: 'x',
        event: 'completed',
        at: new Date().toISOString(),
      }),
    });
    expect(forged.statusCode).toBe(401);
    const anonymous = await forms.app.inject({ method: 'GET', url: '/v1/signing/requests' });
    expect(anonymous.statusCode).toBe(401);
  });

  it('says signing is not set up, rather than failing, where there is no Sign', async () => {
    const alone = await createTestHarness();
    try {
      const token = (await signIn(alone, 'admin@example.com')).accessToken;
      const list = await alone.app.inject({
        method: 'GET',
        url: '/v1/signing/requests',
        headers: bearer(token),
      });
      expect(list.json()).toEqual({ enabled: false, requests: [] });
      const create = await alone.app.inject({
        method: 'POST',
        url: '/v1/signing/requests',
        headers: bearer(token),
        payload: {
          source: 'upload',
          documentName: 'x',
          pdfBase64: tinyPdf().toString('base64'),
          parties: [{ name: 'A', locale: 'sv-SE' }],
          declarationKey: 'demo',
        },
      });
      expect(create.statusCode).toBe(503);
    } finally {
      await alone.app.close();
    }
  });
});
