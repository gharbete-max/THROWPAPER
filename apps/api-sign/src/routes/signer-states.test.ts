import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { PDFDocument } from 'pdf-lib';
import { buildServer } from '../server.js';
import { testDatabase } from '../test-database.js';
import { declarations, envelopeEvents, sealedDocuments, serviceTokens } from '../db/schema.js';
import type { Db } from '../db/client.js';
import { generateDevCertificate, loadSealer } from '../sealing/certificate.js';
import { sha256 } from '../envelopes/store.js';

/**
 * What a signing link does in every state an envelope can be in, and how time behaves while it
 * does. Real Postgres (or PGlite where the suite is run so), like `envelopes.test.ts`.
 */
const database = await testDatabase();
const ORIGIN = 'https://forms.example.test';
const SECRET = 'test-link-secret-at-least-thirty-two-chars';

const source = await PDFDocument.create();
source.addPage().drawText('a document to sign', { x: 72, y: 720 });
const PDF = await source.save();
const PDF_SHA = sha256(PDF);

let app: FastifyInstance;
let db: Db;
let clock = new Date('2027-05-01T09:00:00.000Z');
/** Every reading of the clock moves it on: a request that takes time, as a real one does. */
let step = 0;

beforeAll(async () => {
  if (!database) return;
  db = database.db;
  await db.insert(declarations).values({
    key: 'plain',
    version: 1,
    testOnly: true,
    texts: { 'en-GB': '[placeholder]' },
  });
  app = await buildServer({
    db,
    linkSecret: SECRET,
    publicUrl: 'https://sign.example.test',
    apiUrl: 'https://api.sign.example.test',
    sealer: await loadSealer(await generateDevCertificate()),
    now: () => {
      const reading = clock;
      clock = new Date(clock.getTime() + step);
      return reading;
    },
    fetch: (async () => new Response(PDF)) as unknown as typeof fetch,
  });
});

afterAll(async () => {
  await app?.close();
  await database?.drop();
});

async function start(parties: { id: string; order: number }[], routing = 'parallel') {
  const organisationId = randomUUID();
  const token = `svc_${randomUUID()}`;
  await db.insert(serviceTokens).values({
    organisationId,
    name: 'forms',
    tokenSha256: sha256(token),
    allowedOrigins: [ORIGIN],
  });
  const response = await app.inject({
    method: 'POST',
    url: '/v1/envelopes',
    headers: { authorization: `Bearer ${token}` },
    payload: {
      organisationId,
      documentName: 'Agreement',
      documentUrl: `${ORIGIN}/a.pdf`,
      documentSha256: PDF_SHA,
      parties: parties.map((party) => ({
        ...party,
        name: `Party ${party.id.slice(0, 3)}`,
        locale: 'en-GB',
      })),
      routing,
      expiresAt: '2027-06-01T00:00:00.000Z',
      declarationKey: 'plain',
      idempotencyKey: `idem-${randomUUID()}`,
    },
  });
  expect(response.statusCode).toBe(201);
  const created = response.json() as { envelopeId: string; signUrls: Record<string, string> };
  const links = Object.fromEntries(
    Object.entries(created.signUrls).map(([id, url]) => [id, url.split('/s/')[1]!]),
  );
  return { token, organisationId, envelopeId: created.envelopeId, links };
}

const get = (link: string, suffix = '') =>
  app.inject({ method: 'GET', url: `/v1/sign/${link}${suffix}` });
const sign = (link: string) =>
  app.inject({ method: 'POST', url: `/v1/sign/${link}`, payload: { typedName: 'Anna' } });
const decline = (link: string) => app.inject({ method: 'POST', url: `/v1/sign/${link}/decline` });
const cancel = (token: string, id: string) =>
  app.inject({
    method: 'POST',
    url: `/v1/envelopes/${id}/cancel`,
    headers: { authorization: `Bearer ${token}` },
  });

describe.skipIf(!database)('a signing link in every state', () => {
  it('is dead for actions once the envelope was declined, expired, cancelled or completed', async () => {
    // declined: one refusal ends the round for everybody
    const declined = await start([
      { id: 'a', order: 1 },
      { id: 'b', order: 1 },
    ]);
    expect((await decline(declined.links['a']!)).statusCode).toBe(200);
    // completed
    const completed = await start([{ id: 'a', order: 1 }]);
    expect((await sign(completed.links['a']!)).statusCode).toBe(200);
    // cancelled
    const cancelled = await start([{ id: 'a', order: 1 }]);
    expect((await cancel(cancelled.token, cancelled.envelopeId)).statusCode).toBe(200);
    // expired: the clock passes the deadline, and the first look expires it
    const expired = await start([{ id: 'a', order: 1 }]);
    const before = clock;
    clock = new Date('2027-06-02T00:00:00.000Z');
    try {
      expect((await get(expired.links['a']!)).json().status).toBe('expired');
    } finally {
      clock = before;
    }

    const cases = [
      ['declined', declined.links['b']!, 'declined'],
      ['completed', completed.links['a']!, 'completed'],
      ['cancelled', cancelled.links['a']!, 'cancelled'],
      ['expired', expired.links['a']!, 'expired'],
    ] as const;
    for (const [name, link, status] of cases) {
      const view = await get(link);
      expect(view.statusCode, `${name}: view`).toBe(200);
      expect(view.json().status, name).toBe(status);
      expect(view.json().maySign, name).toBe(false);
      expect((await sign(link)).statusCode, `${name}: sign`).toBe(409);
      expect((await decline(link)).statusCode, `${name}: decline`).toBe(409);
    }
    // Replaying a used link leaves no trace: no second signature, no extra event.
    const trail = await db
      .select()
      .from(envelopeEvents)
      .where(eq(envelopeEvents.envelopeId, completed.envelopeId))
      .orderBy(asc(envelopeEvents.seq));
    expect(trail.map((row) => JSON.parse(row.event).type)).toEqual(['sent', 'signed']);
  });

  it('stops serving the document once the envelope was cancelled, expired or declined', async () => {
    const live = await start([{ id: 'a', order: 1 }]);
    expect((await get(live.links['a']!, '/document')).statusCode).toBe(200);

    const cancelled = await start([{ id: 'a', order: 1 }]);
    await cancel(cancelled.token, cancelled.envelopeId);
    expect((await get(cancelled.links['a']!, '/document')).statusCode).toBe(404);

    const declined = await start([{ id: 'a', order: 1 }]);
    await decline(declined.links['a']!);
    expect((await get(declined.links['a']!, '/document')).statusCode).toBe(404);

    const expired = await start([{ id: 'a', order: 1 }]);
    const before = clock;
    clock = new Date('2027-06-02T00:00:00.000Z');
    try {
      expect((await get(expired.links['a']!, '/document')).statusCode).toBe(404);
    } finally {
      clock = before;
    }

    // A signer may still read what they signed.
    const done = await start([{ id: 'a', order: 1 }]);
    await sign(done.links['a']!);
    expect((await get(done.links['a']!, '/document')).statusCode).toBe(200);
  });

  it('opens a link whose party id is the longest the contract allows, in any script', async () => {
    // 64 characters of three bytes each: the base64url of the id alone is 256 characters.
    const id = '日'.repeat(64);
    const started = await start([{ id, order: 1 }]);
    const link = started.links[id]!;
    expect(link.length).toBeGreaterThan(300);
    expect((await get(link)).statusCode).toBe(200);
    expect((await sign(link)).statusCode).toBe(200);
  });
});

describe.skipIf(!database)('the trail under load', () => {
  it('records a link opened many times at once as viewed exactly once, in a chain that still verifies', async () => {
    const started = await start([{ id: 'a', order: 1 }]);
    const opened = await Promise.all(Array.from({ length: 12 }, () => get(started.links['a']!)));
    expect(opened.map((r) => r.statusCode)).toEqual(Array(12).fill(200));
    const types = (
      await db
        .select()
        .from(envelopeEvents)
        .where(eq(envelopeEvents.envelopeId, started.envelopeId))
        .orderBy(asc(envelopeEvents.seq))
    ).map((row) => JSON.parse(row.event).type);
    expect(types).toEqual(['sent', 'viewed']);
    // And the chain is read back whole on the next look (a broken one would throw, not answer).
    expect((await sign(started.links['a']!)).statusCode).toBe(200);
  });
});

describe.skipIf(!database)('time in the record', () => {
  it('refuses to write a time earlier than the last event by more than 5 s, and keeps the trail intact', async () => {
    const started = await start([{ id: 'a', order: 1 }]);
    const link = started.links['a']!;
    const before = clock;
    try {
      clock = new Date(before.getTime() - 10_000);
      const refused = await sign(link);
      expect(refused.statusCode).toBe(409);
      expect(refused.json().error.code).toBe('clock-skew');
      // A small step back is ordinary, and the signature goes through once the clock is right.
      clock = new Date(before.getTime() - 3_000);
      expect((await sign(link)).statusCode).toBe(200);
    } finally {
      clock = before;
    }
    const trail = await db
      .select()
      .from(envelopeEvents)
      .where(eq(envelopeEvents.envelopeId, started.envelopeId))
      .orderBy(asc(envelopeEvents.seq));
    expect(trail.map((row) => JSON.parse(row.event).type)).toEqual(['sent', 'signed']);
  });

  it('never seals a file earlier than the signature it seals', async () => {
    step = 1_500;
    try {
      const started = await start([{ id: 'a', order: 1 }]);
      expect((await sign(started.links['a']!)).statusCode).toBe(200);

      const events = await db
        .select()
        .from(envelopeEvents)
        .where(eq(envelopeEvents.envelopeId, started.envelopeId))
        .orderBy(asc(envelopeEvents.seq));
      const lastAt = Date.parse(JSON.parse(events.at(-1)!.event).at);
      const [row] = await db
        .select()
        .from(sealedDocuments)
        .where(eq(sealedDocuments.envelopeId, started.envelopeId));
      // The signature dictionary's /M is the claimed signing time: D:YYYYMMDDHHMMSS.
      const m = /\/M\s*\(D:(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)/.exec(
        Buffer.from(row!.bytes).toString('latin1'),
      )!;
      const sealedAt = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!);
      expect(sealedAt).toBeGreaterThanOrEqual(Math.floor(lastAt / 1000) * 1000);
    } finally {
      step = 0;
    }
  });
});
