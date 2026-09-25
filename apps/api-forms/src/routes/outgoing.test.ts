import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isLoopbackUrl } from '../server.js';
import { adminUser, bearer, createTestHarness, signIn, type TestHarness } from '../test-support.js';
import { DraftUnavailable, type MailDraft, type MailDrafter } from '../mail/draft.js';
import { createOutgoingStore, type OutgoingQueue } from '../mail/queue.js';

let dir: string;
let queue: OutgoingQueue;
let harness: TestHarness;
let token: string;
let opened: MailDraft[];

const card = {
  filename: 'Björn-Öberg-K7M2.pdf',
  contentType: 'application/pdf',
  content: Buffer.from('%PDF-1.7 card'),
};

function drafter(fail?: Error): MailDrafter {
  return {
    label: 'Apple Mail',
    async open(draft) {
      if (fail) throw fail;
      opened.push(draft);
    },
  };
}

async function start(mailDraft: MailDrafter | null) {
  harness = await createTestHarness({}, { outgoing: queue, mailDraft });
  token = (await signIn(harness, adminUser.email)).accessToken;
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'loppa-outgoing-'));
  queue = createOutgoingStore(dir);
  opened = [];
});

afterEach(async () => {
  await harness.close();
  await rm(dir, { recursive: true, force: true });
});

describe('To send', () => {
  it('lists what is waiting, and says which program Send opens', async () => {
    await start(drafter());
    await queue.add({
      to: 'bjorn@example.com',
      subject: 'Bekräftad',
      text: 'Tack.',
      attachments: [card],
    });

    const response = await harness.app.inject({
      method: 'GET',
      url: '/v1/outgoing',
      headers: bearer(token),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      program: 'Apple Mail',
      messages: [{ to: 'bjorn@example.com', subject: 'Bekräftad', openedAt: null }],
    });
  });

  it('is for somebody signed in', async () => {
    await start(drafter());
    const message = await queue.add({ to: 'a@example.com', subject: 'A', text: '' });
    for (const [method, url] of [
      ['GET', '/v1/outgoing'],
      ['POST', `/v1/outgoing/${message.id}/open`],
      ['POST', `/v1/outgoing/${message.id}/opened`],
      ['GET', `/v1/outgoing/${message.id}/attachments/0`],
      ['DELETE', `/v1/outgoing/${message.id}`],
    ] as const) {
      expect((await harness.app.inject({ method, url })).statusCode, url).toBe(401);
    }
    expect(await queue.get(message.id)).not.toBeNull();
  });

  it('opens a message as a draft, addressed and with its attachment — and sends nothing', async () => {
    await start(drafter());
    const message = await queue.add({
      to: 'bjorn@example.com',
      subject: 'Bekräftad',
      text: 'Tack.',
      attachments: [card],
    });

    const response = await harness.app.inject({
      method: 'POST',
      url: `/v1/outgoing/${message.id}/open`,
      headers: bearer(token),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().openedAt).not.toBeNull();
    expect(opened).toHaveLength(1);
    expect(opened[0]).toMatchObject({
      to: 'bjorn@example.com',
      subject: 'Bekräftad',
      text: 'Tack.',
    });
    expect(opened[0]!.attachments.map((file) => file.filename)).toEqual(['Björn-Öberg-K7M2.pdf']);
    expect(opened[0]!.attachments[0]!.content.toString()).toBe('%PDF-1.7 card');
    // Still listed: whether it was sent is the mail program's to know.
    expect(await queue.get(message.id)).not.toBeNull();
  });

  it('says when there is no program to open, so the page uses the email link', async () => {
    await start(null);
    const message = await queue.add({ to: 'a@example.com', subject: 'A', text: '' });
    const response = await harness.app.inject({
      method: 'POST',
      url: `/v1/outgoing/${message.id}/open`,
      headers: bearer(token),
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('no-program');

    const marked = await harness.app.inject({
      method: 'POST',
      url: `/v1/outgoing/${message.id}/opened`,
      headers: bearer(token),
    });
    expect(marked.statusCode).toBe(200);
    expect((await queue.get(message.id))?.openedAt).not.toBeNull();
  });

  it('says when the program is not on this computer, and leaves the message waiting', async () => {
    await start(drafter(new DraftUnavailable('Apple Mail')));
    const message = await queue.add({ to: 'a@example.com', subject: 'A', text: '' });
    const response = await harness.app.inject({
      method: 'POST',
      url: `/v1/outgoing/${message.id}/open`,
      headers: bearer(token),
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('program-unavailable');
    expect((await queue.get(message.id))?.openedAt).toBeNull();
  });

  it('hands over an attachment to save, under its own name', async () => {
    await start(null);
    const message = await queue.add({
      to: 'a@example.com',
      subject: 'A',
      text: '',
      attachments: [card],
    });
    const response = await harness.app.inject({
      method: 'GET',
      url: `/v1/outgoing/${message.id}/attachments/0`,
      headers: bearer(token),
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('application/pdf');
    expect(response.headers['content-disposition']).toContain('attachment');
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.body).toBe('%PDF-1.7 card');

    const missing = await harness.app.inject({
      method: 'GET',
      url: `/v1/outgoing/${message.id}/attachments/1`,
      headers: bearer(token),
    });
    expect(missing.statusCode).toBe(404);
  });

  it('removes a message, and the audit log says who did', async () => {
    await start(null);
    const message = await queue.add({ to: 'a@example.com', subject: 'A', text: '' });
    const response = await harness.app.inject({
      method: 'DELETE',
      url: `/v1/outgoing/${message.id}`,
      headers: bearer(token),
    });
    expect(response.statusCode).toBe(204);
    expect(await queue.get(message.id)).toBeNull();
    expect(harness.state.audit.find((entry) => entry.action === 'outgoing.removed')?.entityId).toBe(
      message.id,
    );

    const again = await harness.app.inject({
      method: 'DELETE',
      url: `/v1/outgoing/${message.id}`,
      headers: bearer(token),
    });
    expect(again.statusCode).toBe(404);
  });

  it('answers a name that is not one of its messages with nothing', async () => {
    await start(drafter());
    for (const id of ['..', 'not-a-uuid', '00000000-0000-4000-8000-000000000000']) {
      const response = await harness.app.inject({
        method: 'POST',
        url: `/v1/outgoing/${encodeURIComponent(id)}/open`,
        headers: bearer(token),
      });
      expect([400, 404], id).toContain(response.statusCode);
    }
    expect(opened).toHaveLength(0);
  });

  it('tells the app it is the desktop edition', async () => {
    await start(null);
    const health = await harness.app.inject({ method: 'GET', url: '/health' });
    expect(health.json().edition).toBe('desktop');
  });
});

describe('a server', () => {
  it('has no To send list', async () => {
    harness = await createTestHarness();
    token = (await signIn(harness, adminUser.email)).accessToken;
    const response = await harness.app.inject({
      method: 'GET',
      url: '/v1/outgoing',
      headers: bearer(token),
    });
    expect(response.statusCode).toBe(404);
    expect((await harness.app.inject({ method: 'GET', url: '/health' })).json().edition).toBe(
      'server',
    );
  });
});

describe('whether signers’ links can be emailed', () => {
  it('says Sign is on this computer when its address is loopback, and online otherwise', async () => {
    const fetchNothing = (async () => new Response('{}')) as typeof fetch;
    harness = await createTestHarness(
      {},
      {
        signing: { apiUrl: 'http://127.0.0.1:47018', serviceToken: 't' },
        signFetch: fetchNothing,
      },
    );
    expect((await harness.app.inject({ method: 'GET', url: '/health' })).json().signing).toBe(
      'this-computer',
    );
    await harness.close();

    harness = await createTestHarness(
      {},
      {
        signing: { apiUrl: 'https://sign.example.com', serviceToken: 't' },
        signFetch: fetchNothing,
      },
    );
    expect((await harness.app.inject({ method: 'GET', url: '/health' })).json().signing).toBe(
      'online',
    );
  });

  it('says so with no Sign at all', async () => {
    harness = await createTestHarness();
    expect((await harness.app.inject({ method: 'GET', url: '/health' })).json().signing).toBe(
      'off',
    );
  });

  it('knows loopback by name and by number, and nothing else', () => {
    for (const url of [
      'http://127.0.0.1:1',
      'http://localhost/x',
      'http://[::1]:5/',
      'http://127.8.0.1',
    ])
      expect(isLoopbackUrl(url), url).toBe(true);
    for (const url of [
      'https://sign.example.com',
      'http://10.0.0.2',
      'http://127.0.0.1.example.com',
      'nonsense',
    ])
      expect(isLoopbackUrl(url), url).toBe(false);
  });
});
