import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LOCALE_CODES } from '@tp/i18n';
import {
  adminUser,
  bearer,
  createTestHarness,
  operatorUser,
  signIn,
  type TestHarness,
} from '../test-support.js';
import { INVITATION_COPY_LOCALES } from './invitations.js';

/**
 * P1c-4b: Forms emails each signer their link when Sign says it is their turn — only when the
 * sender asked, only once per turn, and again only when a person presses "remind".
 *
 * Sign is a fake here, answering §5.1 and §5.2 from a table the test moves along.
 */
const SIGN = 'http://sign.test';
let harness: TestHarness;
let token: string;
let partyStatus: Record<string, string>;

function fakeSign(): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url === `${SIGN}/v1/envelopes` && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as {
        parties: { id: string; name: string; email?: string; locale: string; order: number }[];
      };
      partyStatus = Object.fromEntries(
        body.parties.map((p) => [p.id, p.order === 1 ? 'invited' : 'waiting']),
      );
      (fakeSign as unknown as { parties: unknown }).parties = body.parties;
      return Response.json(
        {
          envelopeId: 'env-1',
          status: 'sent',
          signUrls: Object.fromEntries(body.parties.map((p) => [p.id, `${SIGN}/s/${p.id}`])),
        },
        { status: 201 },
      );
    }
    if (url === `${SIGN}/v1/envelopes/env-1`) {
      const parties = (fakeSign as unknown as { parties: { id: string }[] }).parties;
      return Response.json({
        envelopeId: 'env-1',
        status: Object.values(partyStatus).every((s) => s === 'signed') ? 'completed' : 'sent',
        environment: 'test',
        documentSha256: 'a'.repeat(64),
        parties: parties.map((p) => ({ ...p, status: partyStatus[p.id] })),
      });
    }
    return new Response(null, { status: 404 });
  }) as typeof fetch;
}

beforeEach(async () => {
  harness = await createTestHarness(
    {},
    { signing: { apiUrl: SIGN, serviceToken: 'test-token' }, signFetch: fakeSign() },
  );
  token = (await signIn(harness, adminUser.email)).accessToken;
  harness.mail.sent.length = 0;
});
afterEach(() => harness.close());

function send(inviteByEmail: boolean) {
  return harness.app.inject({
    method: 'POST',
    url: '/v1/signing/requests',
    headers: bearer(token),
    payload: {
      source: 'upload',
      documentName: 'Hyresavtal',
      pdfBase64: Buffer.from('%PDF-1.4 test').toString('base64'),
      parties: [
        { name: 'Anna', email: 'anna@example.com', locale: 'sv-SE' },
        { name: 'Bo', email: 'bo@example.com', locale: 'en-GB' },
        { name: 'Cecilia', locale: 'sv-SE' },
      ],
      routing: 'sequential',
      declarationKey: 'demo',
      inviteByEmail,
    },
  });
}

describe('inviting signers by email', () => {
  it('emails whose turn it is, in their language, once; the next when the step moves on', async () => {
    const created = await send(true);
    expect(created.statusCode).toBe(201);
    const id = created.json().id as string;
    expect(created.json().parties.map((p: { status: string }) => p.status)).toEqual([
      'invited',
      'waiting',
      'waiting',
    ]);
    await harness.app.worker.drain();
    expect(harness.mail.sent.map((m) => m.to)).toEqual(['anna@example.com']);
    const first = harness.mail.sent[0]!;
    expect(first.subject).toContain('Hyresavtal');
    expect(first.text).toContain(`${SIGN}/s/p1`);
    expect(first.html).toContain('lang="sv-SE"');
    // A test-mode envelope says so.
    expect(first.text).toContain('test');

    // A second look at the same step sends nothing more.
    await harness.app.inject({
      method: 'GET',
      url: `/v1/signing/requests/${id}`,
      headers: bearer(token),
    });
    await harness.app.worker.drain();
    expect(harness.mail.sent).toHaveLength(1);

    // Anna signs; Bo's turn. The refresh (a hook, or the screen) queues his.
    partyStatus = { p1: 'signed', p2: 'invited', p3: 'waiting' };
    await harness.app.inject({
      method: 'GET',
      url: `/v1/signing/requests/${id}`,
      headers: bearer(token),
    });
    await harness.app.worker.drain();
    expect(harness.mail.sent.map((m) => m.to)).toEqual(['anna@example.com', 'bo@example.com']);
    expect(harness.mail.sent[1]!.subject).toContain('asks you to sign');

    // Cecilia has no address: her turn sends nothing, and she cannot be reminded.
    partyStatus = { p1: 'signed', p2: 'signed', p3: 'invited' };
    await harness.app.inject({
      method: 'GET',
      url: `/v1/signing/requests/${id}`,
      headers: bearer(token),
    });
    await harness.app.worker.drain();
    expect(harness.mail.sent).toHaveLength(2);
    const remindCecilia = await harness.app.inject({
      method: 'POST',
      url: `/v1/signing/requests/${id}/parties/p3/remind`,
      headers: bearer(token),
    });
    expect(remindCecilia.statusCode).toBe(409);
  });

  it('sends nothing unless asked, and reminds only on a press, only whose turn it is', async () => {
    const created = await send(false);
    const id = created.json().id as string;
    await harness.app.worker.drain();
    expect(harness.mail.sent).toHaveLength(0);

    const early = await harness.app.inject({
      method: 'POST',
      url: `/v1/signing/requests/${id}/parties/p2/remind`,
      headers: bearer(token),
    });
    expect(early.statusCode).toBe(409);

    const reminded = await harness.app.inject({
      method: 'POST',
      url: `/v1/signing/requests/${id}/parties/p1/remind`,
      headers: bearer(token),
    });
    expect(reminded.statusCode).toBe(200);
    expect(reminded.json().parties[0].invitedByEmailAt).toBeTruthy();
    await harness.app.worker.drain();
    expect(harness.mail.sent.map((m) => m.to)).toEqual(['anna@example.com']);
    expect(harness.mail.sent[0]!.text).toContain('påminnelse');
  });

  it('has copy in every language the product ships in', () => {
    expect(LOCALE_CODES.filter((code) => !INVITATION_COPY_LOCALES.includes(code))).toEqual([]);
  });
});

/**
 * A signing request carries every party's link, and a link is the signer's authority. The routes
 * checked only the organisation, so one operator could read — and sign — another's requests.
 */
describe('who may see a signing request', () => {
  const otherOperator = {
    ...operatorUser,
    id: '44444444-4444-4444-8444-444444444444',
    email: 'other@example.com',
    name: 'Olle Annan',
  };

  async function asOperators() {
    await harness.close();
    harness = await createTestHarness(
      { users: [adminUser, operatorUser, otherOperator] },
      { signing: { apiUrl: SIGN, serviceToken: 'test-token' }, signFetch: fakeSign() },
    );
    const sender = (await signIn(harness, operatorUser.email)).accessToken;
    const other = (await signIn(harness, otherOperator.email)).accessToken;
    const admin = (await signIn(harness, adminUser.email)).accessToken;
    token = sender;
    const created = await send(false);
    expect(created.statusCode).toBe(201);
    return { id: created.json().id as string, sender, other, admin };
  }

  it('is the sender and the admins, never another operator', async () => {
    const { id, sender, other, admin } = await asOperators();
    const get = (who: string, url: string, method: 'GET' | 'POST' = 'GET') =>
      harness.app.inject({ method, url, headers: bearer(who) });

    for (const [who, expected] of [
      [sender, 1],
      [admin, 1],
      [other, 0],
    ] as const) {
      const list = await get(who, '/v1/signing/requests');
      expect(list.json().requests).toHaveLength(expected);
    }

    expect((await get(sender, `/v1/signing/requests/${id}`)).statusCode).toBe(200);
    expect((await get(admin, `/v1/signing/requests/${id}`)).statusCode).toBe(200);

    const peek = await get(other, `/v1/signing/requests/${id}`);
    expect(peek.statusCode).toBe(404);
    expect(peek.body).not.toContain(`${SIGN}/s/`);
    expect((await get(other, `/v1/signing/requests/${id}/sealed.pdf`)).statusCode).toBe(404);
    expect(
      (await get(other, `/v1/signing/requests/${id}/parties/p1/remind`, 'POST')).statusCode,
    ).toBe(404);
  });
});
