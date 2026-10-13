import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LOCALE_CODES } from '@tp/i18n';
import { SEND_LIMITS, type BatchRow } from '@tp/shared/api';
import { adminUser, bearer, createTestHarness, signIn, testOrganisation } from '../test-support.js';
import type { TestHarness } from '../test-support.js';
import { buildMimeMessage } from '../mail/ses.js';
import {
  UNSUBSCRIBE_COPY_LOCALES,
  deriveUnsubscribeKey,
  signUnsubscribeToken,
  verifyUnsubscribeToken,
} from '../send/unsubscribe.js';

let harness: TestHarness;
let token: string;

beforeEach(async () => {
  harness = await createTestHarness();
  token = (await signIn(harness, adminUser.email)).accessToken;
  // The magic link is not a campaign.
  harness.mail.sent.length = 0;
});

afterEach(async () => {
  await harness.close();
});

const KEY = crypto.randomUUID();
const jobs = () => [...harness.state.jobs.values()].filter((job) => job.kind === 'send.campaign');
const drain = () => harness.app.worker.drain(500);

// Stand-ins for the sender's own words. The product writes none of them.
const FOOTER = 'Sender, address. Stop: {{unsubscribe}}';
const rows: BatchRow[] = [
  { name: 'Åsa Ek', email: 'asa@example.com', amount: '', reference: '' },
  { name: 'Bo Berg', email: 'bo@example.com', amount: '', reference: '' },
  { name: '', email: 'cia@example.com', amount: '', reference: '' },
];

const post = (url: string, payload: unknown, auth: string | null = token) =>
  harness.app.inject({
    method: 'POST',
    url,
    headers: auth ? bearer(auth) : {},
    payload: payload as object,
  });

const campaign = (over: Record<string, unknown> = {}) => ({
  key: KEY,
  confirmed: true,
  subject: 'News for {{name | friend}}',
  body: 'Hello {{name | there}}, read https://example.org/news?id=7',
  footer: FOOTER,
  rows,
  ...over,
});

const unsubscribeUrlOf = (text: string) =>
  /http:\/\/localhost:5173\/api(\/v1\/unsubscribe\?t=\S+)/.exec(text)![1]!;

describe('queueing a campaign', () => {
  it('is for somebody signed in', async () => {
    expect((await post('/v1/send/campaign', campaign(), null)).statusCode).toBe(401);
    expect(jobs()).toHaveLength(0);
  });

  it('queues nothing without the confirmation', async () => {
    const response = await post('/v1/send/campaign', campaign({ confirmed: undefined }));
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('not-confirmed');
    expect(jobs()).toHaveLength(0);
    await drain();
    expect(harness.mail.sent).toHaveLength(0);
  });

  it('refuses to send until the footer is typed and carries the unsubscribe link', async () => {
    for (const footer of ['', '   ', 'Sender, address']) {
      const response = await post('/v1/send/campaign', campaign({ footer }));
      expect(response.statusCode).toBe(422);
      expect(response.json().error.fields['campaign'][0]).toMatch(/^footer:footer-/);
    }
    expect(jobs()).toHaveLength(0);
  });

  it('three rows become three previewable, merged messages, each with its own link and headers', async () => {
    const response = await post('/v1/send/campaign', campaign());
    expect(response.statusCode).toBe(200);
    expect(response.json().items).toHaveLength(3);
    expect(response.json().skipped).toEqual([]);
    expect(jobs()).toHaveLength(3);
    expect(harness.mail.sent).toHaveLength(0);

    await drain();
    expect(harness.mail.sent.map((mail) => mail.to)).toEqual([
      'asa@example.com',
      'bo@example.com',
      'cia@example.com',
    ]);
    expect(harness.mail.sent.map((mail) => mail.subject)).toEqual([
      'News for Åsa Ek',
      'News for Bo Berg',
      'News for friend',
    ]);
    expect(harness.mail.sent[2]!.text).toContain('Hello there,');
    const [first, second] = harness.mail.sent;
    const link = unsubscribeUrlOf(first!.text);
    expect(link).not.toBe(unsubscribeUrlOf(second!.text));
    expect(first!.headers).toEqual({
      'List-Unsubscribe': `<http://localhost:5173/api${link}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    });
    const mime = buildMimeMessage({ ...first!, from: 'a@b.test' });
    expect(mime).toContain(`List-Unsubscribe: <http://localhost:5173/api${link}>`);
    expect(mime).toContain('List-Unsubscribe-Post: List-Unsubscribe=One-Click');
  });

  it('tracks nothing: plain text only, the sender’s links as written, no pixel', async () => {
    await post('/v1/send/campaign', campaign());
    await drain();
    for (const mail of harness.mail.sent) {
      expect(mail.html).toBeUndefined();
      expect(mail.attachments).toBeUndefined();
      expect(mail.text).toContain('https://example.org/news?id=7');
      expect(mail.text).not.toMatch(/<(img|a|html|body)\b/i);
      // Every link in the message is the sender's own or the recipient's unsubscribe link.
      const links = mail.text.match(/https?:\/\/\S+/g) ?? [];
      expect(links.filter((link) => !link.includes('/v1/unsubscribe?t='))).toEqual([
        'https://example.org/news?id=7',
      ]);
    }
  });

  it('a double press, a retry and a repeated address are one message each', async () => {
    const repeated = [...rows, { ...rows[0]!, email: 'ASA@example.com' }];
    await post('/v1/send/campaign', campaign({ rows: repeated }));
    await post('/v1/send/campaign', campaign({ rows: repeated }));
    expect(jobs()).toHaveLength(3);
    await drain();
    await post('/v1/send/campaign', campaign());
    await drain();
    expect(harness.mail.sent).toHaveLength(3);
    // A different press (another key) is a different campaign.
    await post('/v1/send/campaign', campaign({ key: crypto.randomUUID() }));
    expect(jobs()).toHaveLength(6);
  });

  it('has a hard cap: one over is refused whole, nothing queued', async () => {
    const many = Array.from({ length: SEND_LIMITS.campaign + 1 }, (_, i) => ({
      ...rows[0]!,
      email: `p${i}@example.com`,
    }));
    const over = await post('/v1/send/campaign', campaign({ rows: many }));
    expect(over.statusCode).toBe(413);
    expect(over.json().error.code).toBe('too-many');
    expect(jobs()).toHaveLength(0);

    const exactly = await post(
      '/v1/send/campaign',
      campaign({ rows: many.slice(0, SEND_LIMITS.campaign) }),
    );
    expect(exactly.statusCode).toBe(200);
    expect(jobs()).toHaveLength(SEND_LIMITS.campaign);
  });

  it('names the rows it cannot use: a bad address, or an empty field with no fallback', async () => {
    const bad = await post(
      '/v1/send/campaign',
      campaign({ rows: [rows[0], { ...rows[1], email: 'bo' }] }),
    );
    expect(bad.statusCode).toBe(422);
    expect(bad.json().error.fields['row 2']).toEqual(['email:bad-email']);

    const empty = await post('/v1/send/campaign', campaign({ body: 'Dear {{name}}' }));
    expect(empty.statusCode).toBe(422);
    expect(empty.json().error.fields['row 3']).toEqual(['name:empty-field']);
    expect(jobs()).toHaveLength(0);
  });

  it('keeps a cell’s line breaks out of the headers', async () => {
    await post(
      '/v1/send/campaign',
      campaign({ rows: [{ ...rows[0], name: 'Åsa\r\nBcc: evil@example.com' }] }),
    );
    await drain();
    expect(harness.mail.sent[0]!.subject).not.toMatch(/[\r\n]/);
    expect(harness.mail.sent[0]!.headers).not.toHaveProperty('Bcc');
  });

  it('test mode: all to one address, marked, the link the sender’s own, the list ignored', async () => {
    await harness.repos.campaignSuppressions.add(testOrganisation.id, 'bo@example.com', 'manual');
    const response = await post('/v1/send/campaign', campaign({ testTo: 'me@example.com' }));
    expect(response.json().skipped).toEqual([]);
    await drain();
    expect(harness.mail.sent).toHaveLength(3);
    expect(new Set(harness.mail.sent.map((mail) => mail.to))).toEqual(new Set(['me@example.com']));
    expect(harness.mail.sent.every((mail) => mail.subject.startsWith('[TEST] '))).toBe(true);
    // Trying the link in a test never suppresses a real recipient.
    const found = unsubscribeUrlOf(harness.mail.sent[1]!.text).split('t=').pop()!;
    const decoded = Buffer.from(found.split('.')[1]!, 'base64url').toString();
    expect(decoded).toBe('me@example.com');
  });
});

describe('suppression', () => {
  it('skips an address on the list, says so, and sends the rest', async () => {
    await post('/v1/send/suppressions', { email: 'Bo@Example.com', reason: 'bounced' });
    const response = await post('/v1/send/campaign/audience', {
      emails: rows.map((row) => row.email),
    });
    expect(response.json()).toEqual({ suppressed: ['bo@example.com'] });

    const queued = await post('/v1/send/campaign', campaign());
    expect(queued.json().skipped).toEqual(['bo@example.com']);
    expect(queued.json().items).toHaveLength(2);
    await drain();
    expect(harness.mail.sent.map((mail) => mail.to)).toEqual([
      'asa@example.com',
      'cia@example.com',
    ]);
  });

  it('an unsubscribe link asks on GET, records on POST, and then no campaign reaches that address', async () => {
    await post('/v1/send/campaign', campaign());
    await drain();
    const path = unsubscribeUrlOf(harness.mail.sent[0]!.text);

    const asked = await harness.app.inject({ method: 'GET', url: path });
    expect(asked.statusCode).toBe(200);
    expect(asked.headers['content-type']).toContain('text/html');
    expect(asked.body).toContain('asa@example.com');
    expect(asked.body).toContain('<form method="post">');
    // A scanner that follows the link has unsubscribed nobody.
    expect(await harness.repos.campaignSuppressions.list(testOrganisation.id)).toEqual([]);

    const done = await harness.app.inject({
      method: 'POST',
      url: path,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'List-Unsubscribe=One-Click',
    });
    expect(done.statusCode).toBe(200);
    const list = await harness.repos.campaignSuppressions.list(testOrganisation.id);
    expect(list.map((entry) => [entry.email, entry.reason])).toEqual([
      ['asa@example.com', 'unsubscribed'],
    ]);
    // Twice is still once.
    await harness.app.inject({ method: 'POST', url: path });
    expect(await harness.repos.campaignSuppressions.list(testOrganisation.id)).toHaveLength(1);

    harness.mail.sent.length = 0;
    const again = await post('/v1/send/campaign', campaign({ key: crypto.randomUUID() }));
    expect(again.json().skipped).toEqual(['asa@example.com']);
    await drain();
    expect(harness.mail.sent.map((mail) => mail.to)).toEqual(['bo@example.com', 'cia@example.com']);
  });

  it('a link that is not ours records nothing', async () => {
    await post('/v1/send/campaign', campaign());
    await drain();
    const real = unsubscribeUrlOf(harness.mail.sent[0]!.text);
    const [org, , mac] = real.split('t=').pop()!.split('.') as [string, string, string];
    const forged = `${org}.${Buffer.from('bo@example.com').toString('base64url')}.${mac}`;
    for (const bad of [forged, 'nonsense', `${org}.x.y`]) {
      const response = await harness.app.inject({
        method: 'POST',
        url: `/v1/unsubscribe?t=${bad}`,
      });
      expect(response.statusCode).toBe(400);
    }
    expect(await harness.repos.campaignSuppressions.list(testOrganisation.id)).toEqual([]);
  });

  it('somebody who unsubscribes after the press but before the send gets nothing', async () => {
    const queued = await post('/v1/send/campaign', campaign());
    await harness.repos.campaignSuppressions.add(
      testOrganisation.id,
      'asa@example.com',
      'unsubscribed',
    );
    await drain();
    expect(harness.mail.sent.map((mail) => mail.to)).toEqual(['bo@example.com', 'cia@example.com']);
    const status = await harness.app.inject({
      method: 'GET',
      url: `/v1/send/status?ids=${queued
        .json()
        .items.map((item: { id: string }) => item.id)
        .join(',')}`,
      headers: bearer(token),
    });
    expect(status.json().items.map((item: { state: string }) => item.state)).toEqual([
      'skipped',
      'sent',
      'sent',
    ]);
  });

  it('can be listed and cleared', async () => {
    await post('/v1/send/suppressions', { email: 'bo@example.com' });
    const listed = await harness.app.inject({
      method: 'GET',
      url: '/v1/send/suppressions',
      headers: bearer(token),
    });
    expect(listed.json().items).toMatchObject([{ email: 'bo@example.com', reason: 'manual' }]);
    await harness.app.inject({
      method: 'DELETE',
      url: '/v1/send/suppressions?email=bo%40example.com',
      headers: bearer(token),
    });
    expect(await harness.repos.campaignSuppressions.list(testOrganisation.id)).toEqual([]);
  });

  it('does not stop a one-off document or a batch of documents to the same address', async () => {
    await harness.repos.campaignSuppressions.add(
      testOrganisation.id,
      'asa@example.com',
      'unsubscribed',
    );

    const form = new FormData();
    form.append('file', new File([new Uint8Array(Buffer.from('%PDF-1.7 a document'))], 'a.pdf'));
    form.set('to', JSON.stringify(['asa@example.com']));
    form.set('subject', 'The document');
    form.set('message', '');
    form.set('key', crypto.randomUUID());
    form.set('confirmed', 'true');
    const encoded = new Response(form as never);
    const boundary = /boundary=(.+)$/.exec(encoded.headers.get('content-type') ?? '')?.[1];
    const one = await harness.app.inject({
      method: 'POST',
      url: '/v1/send/document',
      headers: { ...bearer(token), 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: Buffer.from(await encoded.arrayBuffer()),
    });
    expect(one.statusCode).toBe(200);

    const batch = await post('/v1/send/batch', {
      key: crypto.randomUUID(),
      confirmed: true,
      template: {
        layout: 'letter',
        locale: 'en-GB',
        currency: 'SEK',
        title: 'Hi {{name}}',
        body: 'x',
      },
      subject: 'A letter',
      message: 'm',
      rows: [rows[0]],
    });
    expect(batch.statusCode).toBe(200);

    await harness.app.worker.drain(500);
    expect(harness.mail.sent.filter((mail) => mail.to === 'asa@example.com')).toHaveLength(2);
  });

  it('is read by campaigns and by nothing else', () => {
    const root = fileURLToPath(new URL('..', import.meta.url));
    const readers: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (/\.ts$/.test(entry.name) && !/\.test\.ts$/.test(entry.name)) {
          if (readFileSync(path, 'utf8').includes('campaignSuppressions')) {
            readers.push(relative(root, path).replace(/\\/g, '/'));
          }
        }
      }
    };
    walk(root);
    expect(readers.sort()).toEqual([
      'db/repositories/drizzle.ts',
      'db/repositories/memory.ts',
      'db/repositories/types.ts',
      'db/schema.ts',
      'db/seed-demo.ts',
      'demo/dataset.ts',
      'routes/campaign.ts',
      'send/campaign.ts',
    ]);
  });
});

describe('the unsubscribe link and page', () => {
  const key = deriveUnsubscribeKey('a-signing-secret-for-this-test-only-0123456789');

  it('binds an organisation and an address, and nothing else verifies', () => {
    const signed = signUnsubscribeToken(testOrganisation.id, ' Bo@Example.com ', key);
    expect(verifyUnsubscribeToken(signed, key)).toEqual({
      organisationId: testOrganisation.id,
      email: 'bo@example.com',
    });
    expect(
      verifyUnsubscribeToken(signed, deriveUnsubscribeKey('another-secret-0123456789012345')),
    ).toBeNull();
    const [org, , mac] = signed.split('.') as [string, string, string];
    const other = Buffer.from('asa@example.com').toString('base64url');
    expect(verifyUnsubscribeToken(`${org}.${other}.${mac}`, key)).toBeNull();
  });

  it('has its words in all twelve languages', () => {
    expect([...UNSUBSCRIBE_COPY_LOCALES].sort()).toEqual([...LOCALE_CODES].sort());
  });
});

describe('List-Unsubscribe headers in the message', () => {
  it('are written one to a line; a name that is not a header name, or a line break in a value, is not', () => {
    const mime = buildMimeMessage({
      to: 'a@b.test',
      from: 'c@d.test',
      subject: 's',
      text: 't',
      headers: { 'List-Unsubscribe': '<https://x.test/u>\r\nBcc: evil@x.test', 'Bad Name:': 'x' },
    });
    const head = mime.split('\r\n\r\n')[0]!;
    expect(head).toContain('List-Unsubscribe: <https://x.test/u> Bcc: evil@x.test');
    expect(head.split('\r\n').some((line) => line.startsWith('Bcc:'))).toBe(false);
    expect(head).not.toContain('Bad Name');
  });
});
