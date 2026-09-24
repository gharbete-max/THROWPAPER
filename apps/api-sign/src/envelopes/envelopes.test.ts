import { randomUUID, webcrypto } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asc, eq, sql as raw } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../server.js';
import { testDatabase } from '../test-database.js';
import { PDFDocument } from 'pdf-lib';
import { declarations, envelopeEvents, serviceTokens } from '../db/schema.js';
import type { Db } from '../db/client.js';
import { generateDevCertificate, loadSealer, type Sealer } from '../sealing/certificate.js';
import { extractSeal, opensslVerify } from '../sealing/openssl-validator.js';
import { sha256 } from './store.js';
import { createHookDelivery, hookSignature } from './hooks.js';

/**
 * CONTRACT §5.1–5.2 and the signer's link, against a real, throwaway Postgres.
 *
 * Real, because the claims worth testing live there: that evidence cannot be edited, that an edit
 * made behind the trigger's back is caught, that two signers at once do not tear the trail.
 */
const database = await testDatabase();

const ORIGIN = 'https://forms.example.test';
const SECRET = 'test-link-secret-at-least-thirty-two-chars';
const PDF = await pdfSaying('a document to sign');
const PDF_SHA = sha256(PDF);
const API = 'https://api.sign.example.test';
const SEAL = await generateDevCertificate();
const sealer = await loadSealer(SEAL);

async function pdfSaying(text: string): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.addPage().drawText(text, { x: 72, y: 720 });
  return pdf.save();
}

let app: FastifyInstance;
let db: Db;
let clock = new Date('2027-05-01T09:00:00.000Z');
const fetched: string[] = [];

async function tokenFor(organisationId: string, revoked = false): Promise<string> {
  const token = `svc_${randomUUID()}`;
  await db.insert(serviceTokens).values({
    organisationId,
    name: 'forms',
    tokenSha256: sha256(token),
    allowedOrigins: [ORIGIN],
    revokedAt: revoked ? clock : null,
  });
  return token;
}

function envelopeRequest(organisationId: string, overrides: Record<string, unknown> = {}) {
  return {
    organisationId,
    documentName: 'Hyresavtal',
    documentUrl: `${ORIGIN}/documents/lease.pdf`,
    documentSha256: PDF_SHA,
    parties: [
      { id: 'landlord', name: 'Åsa Öberg', locale: 'sv-SE', order: 1 },
      { id: 'tenant', name: 'Jon Smith', locale: 'en-GB', order: 2 },
    ],
    routing: 'sequential',
    expiresAt: '2027-06-01T00:00:00.000Z',
    declarationKey: 'lease',
    idempotencyKey: `idem-${randomUUID()}`,
    ...overrides,
  };
}

function create(token: string, body: object) {
  return app.inject({
    method: 'POST',
    url: '/v1/envelopes',
    headers: { authorization: `Bearer ${token}` },
    payload: body,
  });
}

function linkOf(signUrl: string): string {
  return signUrl.split('/s/')[1]!;
}

beforeAll(async () => {
  if (!database) return;
  db = database.db;
  await db.insert(declarations).values([
    {
      key: 'lease',
      version: 1,
      testOnly: true,
      texts: { 'sv-SE': '[v1 sv — placeholder]', 'en-GB': '[v1 en — placeholder]' },
    },
    {
      key: 'lease',
      version: 2,
      testOnly: true,
      texts: { 'sv-SE': '[v2 sv — placeholder]', 'en-GB': '[v2 en — placeholder]' },
    },
    { key: 'swedish-only', version: 1, testOnly: true, texts: { 'sv-SE': '[sv only]' } },
    {
      key: 'authored',
      version: 1,
      testOnly: false,
      texts: { 'sv-SE': '[stands in for text a person wrote]' },
    },
  ]);
  app = await buildServer({
    db,
    linkSecret: SECRET,
    publicUrl: 'https://sign.example.test',
    apiUrl: API,
    sealer,
    now: () => clock,
    fetch: (async (url: string | URL) => {
      fetched.push(String(url));
      const body = String(url).endsWith('not.pdf')
        ? 'hello'
        : String(url).endsWith('broken.pdf')
          ? '%PDF-1.7\n% says it is a PDF and is not one\n%%EOF\n'
          : PDF;
      return new Response(body);
    }) as typeof fetch,
  });
});

afterAll(async () => {
  await app?.close();
  await database?.drop();
});

describe.skipIf(!database)('creating an envelope (§5.1)', () => {
  it('stores it, sends it, and answers with one signing link per party', async () => {
    const org = randomUUID();
    const response = await create(await tokenFor(org), envelopeRequest(org));

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.status).toBe('sent');
    expect(Object.keys(body.signUrls).sort()).toEqual(['landlord', 'tenant']);
    expect(body.signUrls.landlord).toMatch(/^https:\/\/sign\.example\.test\/s\//);
  });

  it('answers a retried request with the same envelope and the same links', async () => {
    const org = randomUUID();
    const token = await tokenFor(org);
    const request = envelopeRequest(org);

    const first = await create(token, request);
    const again = await create(token, request);

    expect(again.statusCode).toBe(200);
    expect(again.json()).toEqual(first.json());
  });

  it('refuses a reused key for a different document', async () => {
    const org = randomUUID();
    const token = await tokenFor(org);
    const request = envelopeRequest(org);
    await create(token, request);

    const other = await pdfSaying('another document');
    const response = await buildServerWith(other).then((server) =>
      server.inject({
        method: 'POST',
        url: '/v1/envelopes',
        headers: { authorization: `Bearer ${token}` },
        payload: { ...request, documentSha256: sha256(other) },
      }),
    );
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('idempotency-key-reused');
  });

  it('pins the latest declaration version when it is sent', async () => {
    const org = randomUUID();
    const created = (await create(await tokenFor(org), envelopeRequest(org))).json();
    const view = await app.inject({
      method: 'GET',
      url: `/v1/sign/${linkOf(created.signUrls.landlord)}`,
    });
    expect(view.json().declaration).toEqual({
      key: 'lease',
      version: 2,
      text: '[v2 sv — placeholder]',
    });
  });
});

describe.skipIf(!database)('who may call', () => {
  it('refuses a missing, unknown or revoked token', async () => {
    const org = randomUUID();
    const revoked = await tokenFor(org, true);
    for (const token of ['', 'svc_nobody', revoked]) {
      expect((await create(token, envelopeRequest(org))).statusCode).toBe(401);
    }
  });

  it('answers a stranger 401 before reading the body, so the schema is not a free map', async () => {
    const response = await create('svc_nobody', {});
    expect(response.statusCode).toBe(401);
    expect(response.body).not.toContain('documentUrl');
  });

  it("refuses a body naming another organisation than the token's", async () => {
    const response = await create(await tokenFor(randomUUID()), envelopeRequest(randomUUID()));
    expect(response.statusCode).toBe(403);
  });

  it("does not show one organisation another's envelope", async () => {
    const owner = randomUUID();
    const created = (await create(await tokenFor(owner), envelopeRequest(owner))).json();

    const stranger = await app.inject({
      method: 'GET',
      url: `/v1/envelopes/${created.envelopeId}`,
      headers: { authorization: `Bearer ${await tokenFor(randomUUID())}` },
    });
    expect(stranger.statusCode).toBe(404);
  });
});

describe.skipIf(!database)('what Sign will fetch', () => {
  it('never requests a document from an origin the token does not list', async () => {
    const org = randomUUID();
    const before = fetched.length;
    const response = await create(
      await tokenFor(org),
      envelopeRequest(org, { documentUrl: 'http://169.254.169.254/latest/meta-data/' }),
    );
    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('origin-not-allowed');
    expect(fetched.length).toBe(before);
  });

  it('refuses a hook on an origin the token does not list', async () => {
    const org = randomUUID();
    const response = await create(
      await tokenFor(org),
      envelopeRequest(org, { hookUrl: 'http://localhost:6379/' }),
    );
    expect(response.json().error.code).toBe('origin-not-allowed');
  });

  it('refuses bytes that do not match the hash the caller sent, and bytes that are not a PDF', async () => {
    const org = randomUUID();
    const token = await tokenFor(org);
    const wrong = await create(token, envelopeRequest(org, { documentSha256: 'a'.repeat(64) }));
    expect(wrong.json().error.code).toBe('wrong-document');
    const notPdf = await create(token, envelopeRequest(org, { documentUrl: `${ORIGIN}/not.pdf` }));
    expect(notPdf.json().error.code).toBe('not-a-pdf');
  });

  it('refuses a file that starts like a PDF but cannot be opened — it could never be sealed', async () => {
    const org = randomUUID();
    const broken = new TextEncoder().encode('%PDF-1.7\n% says it is a PDF and is not one\n%%EOF\n');
    const response = await create(
      await tokenFor(org),
      envelopeRequest(org, {
        documentUrl: `${ORIGIN}/broken.pdf`,
        documentSha256: sha256(broken),
      }),
    );
    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('unreadable-pdf');
  });
});

describe.skipIf(!database)('the declaration (ADR 0012)', () => {
  it('refuses an unknown key, and a party whose language it lacks', async () => {
    const org = randomUUID();
    const token = await tokenFor(org);
    const unknown = await create(token, envelopeRequest(org, { declarationKey: 'nope' }));
    expect(unknown.json().error.code).toBe('unknown-declaration');
    const missing = await create(token, envelopeRequest(org, { declarationKey: 'swedish-only' }));
    expect(missing.json().error.code).toBe('declaration-missing-locale');
  });

  it('refuses a production envelope against a placeholder nobody wrote', async () => {
    const org = randomUUID();
    const response = await create(
      await tokenFor(org),
      envelopeRequest(org, { environment: 'production' }),
    );
    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('declaration-not-authored');
  });
});

describe.skipIf(!database)('signing', () => {
  it('takes the parties in order, records what each saw, and completes', async () => {
    const org = randomUUID();
    const token = await tokenFor(org);
    const created = (await create(token, envelopeRequest(org))).json();
    const landlord = linkOf(created.signUrls.landlord);
    const tenant = linkOf(created.signUrls.tenant);

    // Not the tenant's turn yet: they can look, and they cannot sign.
    const early = await app.inject({ method: 'GET', url: `/v1/sign/${tenant}` });
    expect(early.json().maySign).toBe(false);
    const refused = await sign(tenant, 'Jon Smith');
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.code).toBe('not-their-turn');

    const opened = await app.inject({ method: 'GET', url: `/v1/sign/${landlord}` });
    expect(opened.json().party.status).toBe('viewed');
    expect((await sign(landlord, 'Åsa Öberg')).json().party.status).toBe('signed');
    expect((await sign(tenant, 'Jon Smith')).json().status).toBe('completed');

    const status = await app.inject({
      method: 'GET',
      url: `/v1/envelopes/${created.envelopeId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(status.json().status).toBe('completed');
    expect(status.json().parties.map((p: { status: string }) => p.status)).toEqual([
      'signed',
      'signed',
    ]);

    // The trail holds the declaration as shown, in the signer's own language.
    const signed = (await trailOf(created.envelopeId))
      .map((row) => JSON.parse(row.event))
      .filter((event) => event.type === 'signed');
    expect(signed.map((event) => event.evidence.declaration.text)).toEqual([
      '[v2 sv — placeholder]',
      '[v2 en — placeholder]',
    ]);
    expect(signed[0].evidence.details).toEqual({ typedName: 'Åsa Öberg' });
  });

  it('takes a drawn signature with its strokes, and refuses a path outside the pad grammar', async () => {
    const org = randomUUID();
    const token = await tokenFor(org);
    const created = (await create(token, envelopeRequest(org, { routing: 'parallel' }))).json();
    const link = linkOf(created.signUrls.landlord);
    const drawn = {
      v: 1,
      kind: 'drawn',
      width: 600,
      height: 200,
      paths: ['M 10 150 Q 60 20 120 140 L 200 60', 'M 250 100 l 0.01 0'],
    };

    const hostile = await app.inject({
      method: 'POST',
      url: `/v1/sign/${link}`,
      payload: { drawn: { ...drawn, paths: ['M 0 0 Z <script>'] } },
    });
    expect(hostile.statusCode).toBe(400);
    const typedAsDrawn = await app.inject({
      method: 'POST',
      url: `/v1/sign/${link}`,
      payload: { drawn: { v: 1, kind: 'typed', width: 600, height: 200, text: 'Åsa' } },
    });
    expect(typedAsDrawn.statusCode).toBe(400);

    const signed = await app.inject({
      method: 'POST',
      url: `/v1/sign/${link}`,
      payload: { drawn },
    });
    expect(signed.statusCode).toBe(200);
    const [event] = (await trailOf(created.envelopeId))
      .map((row) => JSON.parse(row.event))
      .filter((candidate) => candidate.type === 'signed');
    expect(event.evidence.method).toBe('drawn');
    expect(JSON.parse(event.evidence.details.vector)).toEqual(drawn);

    // And a drawn envelope seals like any other, and the seal holds.
    await sign(linkOf(created.signUrls.tenant), 'Jon Smith');
    const sealed = await app.inject({
      method: 'GET',
      url: `/v1/envelopes/${created.envelopeId}/sealed`,
      headers: { authorization: `Bearer ${token}` },
    });
    const bytes = new Uint8Array(
      (await app.inject({ method: 'GET', url: sealed.json().url.slice(API.length) })).rawPayload,
    );
    const seal = extractSeal(bytes);
    expect(opensslVerify(seal.signedContent, seal.cms, SEAL.certPem).ok).toBe(true);
  });

  it('serves the document to a link holder, and nothing to a forged link', async () => {
    const org = randomUUID();
    const created = (await create(await tokenFor(org), envelopeRequest(org))).json();
    const link = linkOf(created.signUrls.landlord);

    const document = await app.inject({ method: 'GET', url: `/v1/sign/${link}/document` });
    expect(document.headers['content-type']).toBe('application/pdf');
    expect(sha256(document.rawPayload)).toBe(PDF_SHA);

    // Same envelope, another party's id, the landlord's MAC: forged.
    const [envelopeId, , mac] = link.split('.');
    const forged = `${envelopeId}.${Buffer.from('tenant').toString('base64url')}.${mac}`;
    expect((await app.inject({ method: 'GET', url: `/v1/sign/${forged}` })).statusCode).toBe(404);
  });

  it('lets exactly one of two simultaneous signatures through', async () => {
    const org = randomUUID();
    const created = (
      await create(await tokenFor(org), envelopeRequest(org, { routing: 'parallel' }))
    ).json();
    const link = linkOf(created.signUrls.landlord);

    const results = await Promise.all([sign(link, 'Åsa'), sign(link, 'Åsa')]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);

    expect((await trailOf(created.envelopeId)).map((row) => row.seq)).toEqual([1, 2]);
  });

  it('expires on the deadline, and a late signature is refused', async () => {
    const org = randomUUID();
    const token = await tokenFor(org);
    const created = (await create(token, envelopeRequest(org))).json();

    const saved = clock;
    clock = new Date('2027-06-01T00:00:00.000Z');
    try {
      const late = await sign(linkOf(created.signUrls.landlord), 'Åsa');
      expect(late.json().error.code).toBe('finished');
      const status = await app.inject({
        method: 'GET',
        url: `/v1/envelopes/${created.envelopeId}`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(status.json().status).toBe('expired');
    } finally {
      clock = saved;
    }
  });
});

describe.skipIf(!database)('the record cannot be changed', () => {
  it('refuses UPDATE, DELETE and TRUNCATE on evidence, whoever asks', async () => {
    const org = randomUUID();
    const created = (await create(await tokenFor(org), envelopeRequest(org))).json();
    const id = created.envelopeId;
    // Completed, so there is a sealed row: a row trigger on an empty table would prove nothing.
    await sign(linkOf(created.signUrls.landlord), 'Åsa Öberg');
    expect((await sign(linkOf(created.signUrls.tenant), 'Jon Smith')).json().status).toBe(
      'completed',
    );

    const statements = [
      raw`update envelope_events set event = '{}' where envelope_id = ${id}`,
      raw`delete from envelopes where id = ${id}`,
      raw`delete from documents`,
      raw`truncate envelope_events cascade`,
      raw`update declarations set texts = '{}'`,
      raw`update sealed_documents set bytes = '\\x00'`,
      raw`delete from sealed_documents`,
      raw`truncate sealed_documents`,
    ];
    for (const statement of statements) {
      // Drizzle wraps the driver's error; Postgres's own words are the cause.
      const error = await db.execute(statement).then(
        () => null,
        (thrown: { cause?: Error }) => thrown.cause ?? thrown,
      );
      expect(String((error as Error | null)?.message)).toMatch(/append-only/);
    }
  });

  it('detects an edit made by somebody who switched the trigger off, and acts on nothing', async () => {
    const org = randomUUID();
    const token = await tokenFor(org);
    const created = (await create(token, envelopeRequest(org, { routing: 'parallel' }))).json();
    const id = created.envelopeId;

    // The table owner can disable a trigger. The chain is what still holds.
    await db.execute(raw`alter table envelopes disable trigger envelopes_append_only`);
    try {
      await db.execute(
        raw`update envelopes set definition = replace(definition, 'Jon Smith', 'Eve Mallory') where id = ${id}`,
      );
    } finally {
      await db.execute(raw`alter table envelopes enable trigger envelopes_append_only`);
    }

    const status = await app.inject({
      method: 'GET',
      url: `/v1/envelopes/${id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(status.statusCode).toBe(500);
    expect(JSON.stringify(status.json())).not.toContain('audit trail');
    expect((await sign(linkOf(created.signUrls.tenant), 'Eve')).statusCode).toBe(500);
  });

  it('detects a rewritten signature in the trail — who signed is not editable either', async () => {
    const org = randomUUID();
    const token = await tokenFor(org);
    const created = (await create(token, envelopeRequest(org, { routing: 'parallel' }))).json();
    const id = created.envelopeId;
    await sign(linkOf(created.signUrls.landlord), 'Åsa Öberg');

    // A still-valid event, so replay alone would accept it: only the chain can tell.
    await db.execute(raw`alter table envelope_events disable trigger envelope_events_append_only`);
    try {
      await db.execute(
        raw`update envelope_events set event = replace(event, 'Åsa Öberg', 'Eve Mallory')
            where envelope_id = ${id} and seq = 2`,
      );
    } finally {
      await db.execute(raw`alter table envelope_events enable trigger envelope_events_append_only`);
    }

    const status = await app.inject({
      method: 'GET',
      url: `/v1/envelopes/${id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(status.statusCode).toBe(500);
    expect((await sign(linkOf(created.signUrls.tenant), 'Jon')).statusCode).toBe(500);
  });
});

describe.skipIf(!database)('the sealed document (§5.3)', () => {
  /** An envelope both parties have signed, and the token that created it. */
  async function completedEnvelope(org = randomUUID()) {
    const token = await tokenFor(org);
    const created = (await create(token, envelopeRequest(org, { routing: 'parallel' }))).json();
    await sign(linkOf(created.signUrls.landlord), 'Åsa Öberg');
    const last = await sign(linkOf(created.signUrls.tenant), 'Jon Smith');
    expect(last.json().status).toBe('completed');
    return { token, id: created.envelopeId as string, created };
  }

  function sealedOf(token: string, id: string) {
    return app.inject({
      method: 'GET',
      url: `/v1/envelopes/${id}/sealed`,
      headers: { authorization: `Bearer ${token}` },
    });
  }

  it('gives a short-lived link to a sealed file that an independent validator accepts', async () => {
    const { token, id } = await completedEnvelope();
    const response = await sealedOf(token, id);
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.url.startsWith(`${API}/v1/sealed/`)).toBe(true);
    expect(Date.parse(body.expiresAt) - clock.getTime()).toBe(10 * 60 * 1000);

    const download = await app.inject({ method: 'GET', url: body.url.slice(API.length) });
    expect(download.statusCode).toBe(200);
    expect(download.headers['content-type']).toBe('application/pdf');
    const bytes = new Uint8Array(download.rawPayload);
    expect(sha256(bytes)).toBe(body.sealedSha256);
    // The seal is over the document *and* the audit page, so it is not the document's hash.
    expect(body.sealedSha256).not.toBe(PDF_SHA);

    const seal = extractSeal(bytes);
    expect(opensslVerify(seal.signedContent, seal.cms, SEAL.certPem).ok).toBe(true);
    // One page of document, one audit page each for Swedish and English.
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(3);
  });

  it('answers 409 until the envelope is complete, and 404 to another organisation', async () => {
    const org = randomUUID();
    const token = await tokenFor(org);
    const created = (await create(token, envelopeRequest(org))).json();
    const early = await sealedOf(token, created.envelopeId);
    expect(early.statusCode).toBe(409);
    expect(early.json().error.code).toBe('not-completed');

    const { id } = await completedEnvelope();
    expect((await sealedOf(await tokenFor(randomUUID()), id)).statusCode).toBe(404);
  });

  it('stops opening once the link expires, and cannot be forged or borrowed', async () => {
    const { token, id, created } = await completedEnvelope();
    const path = (await sealedOf(token, id)).json().url.slice(API.length) as string;

    const saved = clock;
    clock = new Date(clock.getTime() + 10 * 60 * 1000);
    try {
      expect((await app.inject({ method: 'GET', url: path })).statusCode).toBe(404);
    } finally {
      clock = saved;
    }

    // A later expiry under the same MAC: the expiry is inside the MAC, so this is a forgery.
    const [envelopeId, expiry, mac] = path.split('/').at(-1)!.split('.');
    const extended = `/v1/sealed/${envelopeId}.${Number(expiry) + 3600}.${mac}`;
    expect((await app.inject({ method: 'GET', url: extended })).statusCode).toBe(404);

    // A signing link is not a download link, even for the same envelope.
    const signing = `/v1/sealed/${linkOf(created.signUrls.landlord)}`;
    expect((await app.inject({ method: 'GET', url: signing })).statusCode).toBe(404);
  });

  it('seals in the same transaction as the last signature: a seal that fails signs nothing', async () => {
    const org = randomUUID();
    const token = await tokenFor(org);
    const created = (await create(token, envelopeRequest(org, { routing: 'parallel' }))).json();
    await sign(linkOf(created.signUrls.landlord), 'Åsa Öberg');

    // A sealer whose key cannot sign: the seal throws inside the completing transaction.
    const { publicKey } = (await crypto.subtle.generateKey(
      {
        name: 'RSASSA-PKCS1-v1_5',
        hash: 'SHA-256',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
      },
      true,
      ['sign', 'verify'],
    )) as webcrypto.CryptoKeyPair;
    const broken = await buildServer({
      db,
      linkSecret: SECRET,
      publicUrl: 'https://sign.example.test',
      apiUrl: API,
      sealer: { ...sealer, key: publicKey } as Sealer,
      now: () => clock,
    });
    try {
      const failed = await broken.inject({
        method: 'POST',
        url: `/v1/sign/${linkOf(created.signUrls.tenant)}`,
        payload: { typedName: 'Jon Smith' },
      });
      expect(failed.statusCode).toBe(500);
    } finally {
      await broken.close();
    }

    const status = await app.inject({
      method: 'GET',
      url: `/v1/envelopes/${created.envelopeId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(status.json().status).toBe('sent');
    expect(status.json().parties.map((p: { status: string }) => p.status)).toEqual([
      'signed',
      'invited',
    ]);

    // And with a working seal, the same signature goes through and is sealed.
    expect((await sign(linkOf(created.signUrls.tenant), 'Jon Smith')).statusCode).toBe(200);
    expect((await sealedOf(token, created.envelopeId)).statusCode).toBe(200);
  });

  it('refuses to serve sealed bytes edited behind the trigger', async () => {
    const { token, id } = await completedEnvelope();
    await db.execute(
      raw`alter table sealed_documents disable trigger sealed_documents_append_only`,
    );
    try {
      await db.execute(
        raw`update sealed_documents set bytes = bytes || '\\x20'::bytea where envelope_id = ${id}`,
      );
    } finally {
      await db.execute(
        raw`alter table sealed_documents enable trigger sealed_documents_append_only`,
      );
    }
    expect((await sealedOf(token, id)).statusCode).toBe(500);
  });
});

describe.skipIf(!database)('telling the caller (§5.4)', () => {
  it('posts each event in order after it commits, signed so only the token holder can check it', async () => {
    const posted: { url: string; signature: string; body: string }[] = [];
    let failFirst = true;
    const hooks = createHookDelivery({
      backoff: [0, 0],
      log: () => {},
      fetch: (async (url: string, init: RequestInit) => {
        // The caller is briefly down: the first attempt fails and is retried.
        if (failFirst) {
          failFirst = false;
          return new Response('', { status: 503 });
        }
        posted.push({
          url,
          signature: String((init.headers as Record<string, string>)['x-loppa-signature']),
          body: String(init.body),
        });
        return new Response(null, { status: 204 });
      }) as unknown as typeof fetch,
    });
    const server = await buildServer({
      db,
      linkSecret: SECRET,
      publicUrl: 'https://sign.example.test',
      apiUrl: API,
      sealer,
      hooks,
      now: () => clock,
      fetch: (async () => new Response(PDF)) as unknown as typeof fetch,
    });
    try {
      const org = randomUUID();
      const token = await tokenFor(org);
      const hookUrl = `${ORIGIN}/hooks/signing`;
      const created = (
        await server.inject({
          method: 'POST',
          url: '/v1/envelopes',
          headers: { authorization: `Bearer ${token}` },
          payload: envelopeRequest(org, { routing: 'parallel', hookUrl }),
        })
      ).json();
      for (const [party, name] of [
        ['landlord', 'Åsa Öberg'],
        ['tenant', 'Jon Smith'],
      ] as const) {
        await server.inject({
          method: 'POST',
          url: `/v1/sign/${linkOf(created.signUrls[party])}`,
          payload: { typedName: name },
        });
      }
      await hooks.idle();

      expect(posted.map((hook) => JSON.parse(hook.body).event)).toEqual([
        'sent',
        'signed',
        'signed',
        'completed',
      ]);
      expect(posted.every((hook) => hook.url === hookUrl)).toBe(true);
      // What a caller does: HMAC the raw body with the SHA-256 of the token it holds.
      for (const hook of posted) {
        expect(hook.signature).toBe(hookSignature(sha256(token), hook.body));
        expect(hook.signature).not.toBe(hookSignature(sha256('svc_somebody_else'), hook.body));
      }
    } finally {
      await server.close();
    }
  });

  it('never lets an unreachable caller stop a signature', async () => {
    const hooks = createHookDelivery({
      backoff: [],
      log: () => {},
      fetch: (async () => {
        throw new Error('ECONNREFUSED');
      }) as unknown as typeof fetch,
    });
    const server = await buildServer({
      db,
      linkSecret: SECRET,
      publicUrl: 'https://sign.example.test',
      apiUrl: API,
      sealer,
      hooks,
      now: () => clock,
      fetch: (async () => new Response(PDF)) as unknown as typeof fetch,
    });
    try {
      const org = randomUUID();
      const created = (
        await server.inject({
          method: 'POST',
          url: '/v1/envelopes',
          headers: { authorization: `Bearer ${await tokenFor(org)}` },
          payload: envelopeRequest(org, { hookUrl: `${ORIGIN}/hooks/signing` }),
        })
      ).json();
      const signed = await server.inject({
        method: 'POST',
        url: `/v1/sign/${linkOf(created.signUrls.landlord)}`,
        payload: { typedName: 'Åsa' },
      });
      expect(signed.statusCode).toBe(200);
      await hooks.idle();
    } finally {
      await server.close();
    }
  });
});

function trailOf(envelopeId: string) {
  return db
    .select()
    .from(envelopeEvents)
    .where(eq(envelopeEvents.envelopeId, envelopeId))
    .orderBy(asc(envelopeEvents.seq));
}

function sign(link: string, typedName: string) {
  return app.inject({ method: 'POST', url: `/v1/sign/${link}`, payload: { typedName } });
}

/** A second server on the same database whose fetch returns other bytes. */
function buildServerWith(bytes: Uint8Array) {
  return buildServer({
    db,
    linkSecret: SECRET,
    publicUrl: 'https://sign.example.test',
    apiUrl: API,
    sealer,
    now: () => clock,
    fetch: (async () => new Response(bytes)) as unknown as typeof fetch,
  });
}
