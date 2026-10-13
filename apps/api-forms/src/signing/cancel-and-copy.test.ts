import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  adminUser,
  bearer,
  createTestHarness,
  operatorUser,
  signIn,
  type TestHarness,
} from '../test-support.js';

/**
 * Cancelling a signing request (CONTRACT §5.7) and sending the signed copy to its signers, both
 * through the one mail path (the worker and the configured provider: the desktop's To send, or
 * the console in test mode). Sign is a fake that the test moves along.
 */
const SIGN = 'http://sign.test';
const SEALED = Buffer.from('%PDF-1.7 sealed copy');
let harness: TestHarness;
let token: string;
let envelope: { status: string; parties: { id: string }[] };
let cancelCalls: number;

function fakeSign(): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url === `${SIGN}/v1/envelopes` && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as { parties: { id: string }[] };
      envelope = { status: 'sent', parties: body.parties };
      return Response.json(
        {
          envelopeId: 'env-1',
          status: 'sent',
          signUrls: Object.fromEntries(body.parties.map((p) => [p.id, `${SIGN}/s/${p.id}`])),
        },
        { status: 201 },
      );
    }
    const status = () =>
      Response.json({
        envelopeId: 'env-1',
        status: envelope.status,
        environment: 'test',
        documentSha256: 'a'.repeat(64),
        parties: envelope.parties.map((p) => ({
          ...p,
          name: p.id,
          locale: 'en-GB',
          order: 1,
          status: envelope.status === 'completed' ? 'signed' : 'invited',
        })),
      });
    if (url === `${SIGN}/v1/envelopes/env-1`) return status();
    if (url === `${SIGN}/v1/envelopes/env-1/cancel` && init?.method === 'POST') {
      cancelCalls += 1;
      if (envelope.status === 'sent') envelope.status = 'cancelled';
      else if (envelope.status !== 'cancelled') {
        return Response.json({ error: { code: 'finished', message: 'no' } }, { status: 409 });
      }
      return status();
    }
    if (url === `${SIGN}/v1/envelopes/env-1/sealed`) {
      if (envelope.status !== 'completed') {
        return Response.json({ error: { code: 'not-completed', message: 'no' } }, { status: 409 });
      }
      return Response.json({
        envelopeId: 'env-1',
        url: `${SIGN}/sealed.pdf`,
        sealedSha256: createHash('sha256').update(SEALED).digest('hex'),
        expiresAt: '2099-01-01T00:00:00.000Z',
      });
    }
    if (url === `${SIGN}/sealed.pdf`) return new Response(SEALED);
    return new Response(null, { status: 404 });
  }) as typeof fetch;
}

async function start() {
  harness = await createTestHarness(
    { users: [adminUser, operatorUser] },
    { signing: { apiUrl: SIGN, serviceToken: 'test-token' }, signFetch: fakeSign() },
  );
  token = (await signIn(harness, adminUser.email)).accessToken;
  harness.mail.sent.length = 0;
  cancelCalls = 0;
}

beforeEach(start);
afterEach(() => harness.close());

async function send(inviteByEmail = false, as = token) {
  const created = await harness.app.inject({
    method: 'POST',
    url: '/v1/signing/requests',
    headers: bearer(as),
    payload: {
      source: 'upload',
      documentName: 'Hyresavtal',
      pdfBase64: Buffer.from('%PDF-1.4 test').toString('base64'),
      parties: [
        { name: 'Anna', email: 'anna@example.com', locale: 'sv-SE' },
        { name: 'Bo', email: 'bo@example.com', locale: 'en-GB' },
        { name: 'Cecilia', locale: 'sv-SE' },
      ],
      routing: 'parallel',
      declarationKey: 'demo',
      inviteByEmail,
    },
  });
  expect(created.statusCode).toBe(201);
  return created.json().id as string;
}

const post = (id: string, action: string, as = token) =>
  harness.app.inject({
    method: 'POST',
    url: `/v1/signing/requests/${id}/${action}`,
    headers: bearer(as),
  });

describe('cancelling a signing request', () => {
  it('withdraws it at Sign, shows it as cancelled, and stops queued invitations and reminders', async () => {
    const id = await send(true);
    const cancelled = await post(id, 'cancel');
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json().status).toBe('cancelled');
    expect(cancelCalls).toBe(1);

    // The invitations were queued before the cancel; sending them now would be wrong.
    await harness.app.worker.drain();
    expect(harness.mail.sent).toHaveLength(0);
    expect((await post(id, 'parties/p1/remind')).statusCode).toBe(409);

    const listed = await harness.app.inject({
      method: 'GET',
      url: '/v1/signing/requests',
      headers: bearer(token),
    });
    expect(listed.json().requests[0].status).toBe('cancelled');
  });

  it('refuses one that has finished, and one the person cannot see', async () => {
    const id = await send();
    envelope.status = 'completed';
    const finished = await post(id, 'cancel');
    expect(finished.statusCode).toBe(422);
    expect(finished.json().error.code).toBe('finished');

    const other = (await signIn(harness, operatorUser.email)).accessToken;
    expect((await post(id, 'cancel', other)).statusCode).toBe(404);
    expect(
      (await harness.app.inject({ method: 'POST', url: `/v1/signing/requests/${id}/cancel` }))
        .statusCode,
    ).toBe(401);
  });
});

describe('sending the signed copy', () => {
  it('waits for everyone to have signed, and for nothing else', async () => {
    const id = await send();
    const early = await post(id, 'send-signed');
    expect(early.statusCode).toBe(409);
    expect(early.json().error.code).toBe('not-completed');
    await harness.app.worker.drain();
    expect(harness.mail.sent).toHaveLength(0);
  });

  it('queues the sealed PDF to each signer with an address, in their language, and marks them', async () => {
    const id = await send();
    envelope.status = 'completed';
    const queued = await post(id, 'send-signed');
    expect(queued.statusCode).toBe(200);
    expect(
      queued.json().parties.map((p: { signedCopyQueuedAt?: string }) => !!p.signedCopyQueuedAt),
    ).toEqual([true, true, false]);

    // Nothing has left yet: the press only queues, the worker and provider do the rest.
    await harness.app.worker.drain();
    expect(harness.mail.sent.map((m) => m.to).sort()).toEqual([
      'anna@example.com',
      'bo@example.com',
    ]);
    const anna = harness.mail.sent.find((m) => m.to === 'anna@example.com')!;
    expect(anna.subject).toContain('Hyresavtal');
    expect(anna.html).toContain('lang="sv-SE"');
    // A test-mode envelope says so.
    expect(anna.text).toContain('test');
    expect(anna.attachments).toHaveLength(1);
    expect(anna.attachments![0]!.filename).toBe('Hyresavtal-signed.pdf');
    expect(anna.attachments![0]!.contentType).toBe('application/pdf');
    expect(anna.attachments![0]!.content.equals(SEALED)).toBe(true);
  });

  it('is for the person who can see the request', async () => {
    const id = await send();
    envelope.status = 'completed';
    const other = (await signIn(harness, operatorUser.email)).accessToken;
    expect((await post(id, 'send-signed', other)).statusCode).toBe(404);
    await harness.app.worker.drain();
    expect(harness.mail.sent.filter((m) => m.attachments?.length)).toHaveLength(0);
  });
});
