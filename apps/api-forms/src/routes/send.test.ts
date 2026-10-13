import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { adminUser, bearer, createTestHarness, signIn, type TestHarness } from '../test-support.js';
import { renderBatchHtml } from '../send/render.js';
import { SEND_LIMITS, type BatchRow, type BatchTemplate } from '@tp/shared/api';

let harness: TestHarness;
let token: string;

beforeEach(async () => {
  harness = await createTestHarness();
  token = (await signIn(harness, adminUser.email)).accessToken;
  // The magic link is not a sent document.
  harness.mail.sent.length = 0;
});

afterEach(async () => {
  await harness.close();
});

const KEY = '5f0c1f46-3a39-4b3c-a8f2-0a6e0a3b3c11';
const PDF = Buffer.from('%PDF-1.7 the document as it was');
const DOCX = Buffer.concat([Buffer.from('PK\x03\x04'), Buffer.from('word file')]);

const jobs = () => [...harness.state.jobs.values()].filter((job) => job.kind === 'send.document');

async function drain() {
  await harness.app.worker.drain(500);
}

/** A real multipart body, so the parser is exercised rather than bypassed. */
async function sendDocument(
  fields: Record<string, string>,
  file: { name: string; content: Buffer; type: string } | null = {
    name: 'Avtal.pdf',
    content: PDF,
    type: 'application/pdf',
  },
  auth: string | null = token,
) {
  const form = new FormData();
  if (file)
    form.append('file', new File([new Uint8Array(file.content)], file.name, { type: file.type }));
  for (const [name, value] of Object.entries(fields)) form.set(name, value);
  const encoded = new Response(form as never);
  const boundary = /boundary=(.+)$/.exec(encoded.headers.get('content-type') ?? '')?.[1];
  return harness.app.inject({
    method: 'POST',
    url: '/v1/send/document',
    headers: {
      ...(auth ? bearer(auth) : {}),
      'content-type': `multipart/form-data; boundary=${boundary}`,
    },
    payload: Buffer.from(await encoded.arrayBuffer()),
  });
}

const good = {
  key: KEY,
  confirmed: 'true',
  to: JSON.stringify(['Bo@Example.com', 'asa@example.com', 'bo@example.com']),
  subject: 'Avtalet',
  message: 'Här är det.',
};

describe('POST /v1/send/mode', () => {
  it('says what a send does here, and the caps', async () => {
    const response = await harness.app.inject({
      method: 'GET',
      url: '/v1/send/mode',
      headers: bearer(token),
    });
    // The test harness mails through the memory provider: a test, nothing delivered.
    expect(response.json()).toEqual({ mode: 'test', batch: 200, recipients: 20 });
  });
});

describe('send this document', () => {
  it('is for somebody signed in', async () => {
    expect((await sendDocument(good, undefined, null)).statusCode).toBe(401);
    expect(jobs()).toHaveLength(0);
  });

  it('queues nothing without the confirmation', async () => {
    const { confirmed: _c, ...unconfirmed } = good;
    const response = await sendDocument(unconfirmed);
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('not-confirmed');
    expect(jobs()).toHaveLength(0);
    await drain();
    expect(harness.mail.sent).toHaveLength(0);
  });

  it('queues one message per person, once, and sends only when the worker runs', async () => {
    const response = await sendDocument(good);
    expect(response.statusCode).toBe(200);
    // Two people: the repeated address is the same person.
    expect(response.json().items.map((item: { to: string }) => item.to)).toEqual([
      'bo@example.com',
      'asa@example.com',
    ]);
    expect(jobs()).toHaveLength(2);
    expect(harness.mail.sent).toHaveLength(0);

    await drain();
    expect(harness.mail.sent.map((mail) => mail.to)).toEqual(['bo@example.com', 'asa@example.com']);
    const mail = harness.mail.sent[0]!;
    expect(mail.subject).toBe('Avtalet');
    expect(mail.text).toBe('Här är det.');
    expect(mail.attachments).toHaveLength(1);
    expect(mail.attachments![0]).toMatchObject({
      filename: 'Avtal.pdf',
      contentType: 'application/pdf',
    });
    expect(mail.attachments![0]!.content.equals(PDF)).toBe(true);
  });

  it('a double press is one press', async () => {
    await sendDocument(good);
    const again = await sendDocument(good);
    expect(again.statusCode).toBe(200);
    expect(jobs()).toHaveLength(2);
    await drain();
    await drain();
    expect(harness.mail.sent).toHaveLength(2);
  });

  it('sends a Word file as it was brought in', async () => {
    const response = await sendDocument(
      { ...good, to: JSON.stringify(['bo@example.com']) },
      { name: 'Offert.docx', content: DOCX, type: 'application/octet-stream' },
    );
    expect(response.statusCode).toBe(200);
    await drain();
    const attachment = harness.mail.sent[0]!.attachments![0]!;
    expect(attachment.filename).toBe('Offert.docx');
    expect(attachment.contentType).toContain('wordprocessingml');
    expect(attachment.content.equals(DOCX)).toBe(true);
  });

  it('refuses what is not a PDF or a Word file, and too many people', async () => {
    const text = await sendDocument(good, {
      name: 'a.pdf',
      content: Buffer.from('hello'),
      type: 'application/pdf',
    });
    expect(text.statusCode).toBe(400);
    expect(text.json().error.code).toBe('not-a-document');

    const many = await sendDocument({
      ...good,
      to: JSON.stringify(
        Array.from({ length: SEND_LIMITS.recipients + 1 }, (_, i) => `p${i}@example.com`),
      ),
    });
    expect(many.statusCode).toBe(413);
    expect(many.json().error.code).toBe('too-many');
    expect(jobs()).toHaveLength(0);
  });

  it('in test mode sends everything to the one address, marked, naming the real one', async () => {
    const response = await sendDocument({ ...good, testTo: 'me@example.com' });
    expect(response.statusCode).toBe(200);
    await drain();
    expect(harness.mail.sent.map((mail) => mail.to)).toEqual(['me@example.com', 'me@example.com']);
    expect(harness.mail.sent[0]!.subject).toBe('[TEST] Avtalet');
    expect(harness.mail.sent[0]!.text).toContain('bo@example.com');
  });

  it('reports each recipient: queued, sent or failed', async () => {
    const queued = (await sendDocument(good)).json().items as { id: string }[];
    const ids = queued.map((item) => item.id).join(',');
    const status = async () =>
      (
        await harness.app.inject({
          method: 'GET',
          url: `/v1/send/status?ids=${ids}`,
          headers: bearer(token),
        })
      ).json().items as { state: string; provider: string | null }[];

    expect((await status()).map((item) => item.state)).toEqual(['queued', 'queued']);
    // The first is taken and fails for good; the second goes.
    const first = (await harness.repos.jobs.claim(new Date()))!;
    await harness.repos.jobs.fail(first.id, 'no connection', null);
    await drain();
    const after = await status();
    expect(after.map((item) => item.state).sort()).toEqual(['failed', 'sent']);
    expect(after.find((item) => item.state === 'sent')!.provider).toBe('memory');
    expect(harness.mail.sent).toHaveLength(1);
  });
});

const template: BatchTemplate = {
  layout: 'invoice',
  locale: 'sv-SE',
  currency: 'SEK',
  title: 'Hyra för {{name}}',
  body: 'Hyra, referens {{reference}}',
  vatRate: '25',
  payTo: 'Bankgiro 123-4567',
  dueOn: '2026-11-30',
};
const rows: BatchRow[] = [
  { name: 'Åsa Ek', email: 'asa@example.com', amount: '1 234,50', reference: '1001' },
  { name: 'Bo Berg', email: 'bo@example.com', amount: '999', reference: '1002' },
  { name: 'Cia Ceder', email: 'cia@example.com', amount: '0,10', reference: '1003' },
];

async function post(url: string, payload: unknown, auth: string | null = token) {
  return harness.app.inject({
    method: 'POST',
    url,
    headers: auth ? bearer(auth) : {},
    payload: payload as object,
  });
}

const batch = (over: Record<string, unknown> = {}) => ({
  key: KEY,
  confirmed: true,
  template,
  subject: 'Hyra, {{name}}',
  message: 'Hej {{name}}, {{amount}}.',
  rows,
  ...over,
});

describe('send a batch', () => {
  it('previews one recipient’s PDF and queues nothing', async () => {
    const response = await post('/v1/send/batch/preview', { template, row: rows[0] });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('application/pdf');
    expect(response.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    expect(harness.renderer.rendered.at(-1)).toContain('Hyra för Åsa Ek');
    expect(jobs()).toHaveLength(0);
  });

  it('refuses a preview of a row that cannot be used', async () => {
    const response = await post('/v1/send/batch/preview', {
      template,
      row: { ...rows[0], amount: 'tjugo' },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json().error.fields['row 1']).toEqual(['amount:bad-amount']);
  });

  it('queues nothing without the confirmation', async () => {
    const response = await post('/v1/send/batch', batch({ confirmed: undefined }));
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('not-confirmed');
    expect(jobs()).toHaveLength(0);
  });

  it('three rows become three personalised PDFs with the right sums', async () => {
    const response = await post('/v1/send/batch', batch());
    expect(response.statusCode).toBe(200);
    expect(jobs()).toHaveLength(3);
    expect(harness.mail.sent).toHaveLength(0);

    await drain();
    expect(harness.mail.sent.map((mail) => mail.to)).toEqual([
      'asa@example.com',
      'bo@example.com',
      'cia@example.com',
    ]);
    expect(harness.mail.sent[0]!.subject).toBe('Hyra, Åsa Ek');
    expect(harness.mail.sent[0]!.attachments![0]!.filename).toBe('Hyra för Åsa Ek.pdf');
    expect(harness.mail.sent[0]!.text).toMatch(/Hej Åsa Ek, 1.234,50.kr\./);

    // 1 234,50 + 25 % = 308,625 → 308,63 (half away from zero); total 1 543,13. No float.
    const html = harness.renderer.rendered.join('\n');
    expect(html).toMatch(/308,63/);
    expect(html).toMatch(/1.543,13/);
    // 0,10 + 25 % = 0,025 → 0,03 and a total of 0,13: exact even where a float would drift.
    expect(html).toMatch(/0,03/);
    expect(html).toMatch(/0,13/);
  });

  it('a double press does not double send', async () => {
    await post('/v1/send/batch', batch());
    await post('/v1/send/batch', batch());
    expect(jobs()).toHaveLength(3);
    await drain();
    await post('/v1/send/batch', batch());
    await drain();
    expect(harness.mail.sent).toHaveLength(3);
  });

  it('has a hard cap: one over is refused whole, nothing queued', async () => {
    const many = Array.from({ length: SEND_LIMITS.batch + 1 }, (_, i) => ({
      ...rows[0]!,
      email: `p${i}@example.com`,
    }));
    const response = await post('/v1/send/batch', batch({ rows: many }));
    expect(response.statusCode).toBe(413);
    expect(response.json().error.code).toBe('too-many');
    expect(jobs()).toHaveLength(0);

    const exactly = await post('/v1/send/batch', batch({ rows: many.slice(0, SEND_LIMITS.batch) }));
    expect(exactly.statusCode).toBe(200);
    expect(jobs()).toHaveLength(SEND_LIMITS.batch);
  });

  it('refuses a list with a bad row, an invoice without a typed VAT rate, or an unknown field', async () => {
    const bad = await post(
      '/v1/send/batch',
      batch({ rows: [rows[0], { ...rows[1], email: 'bo' }] }),
    );
    expect(bad.statusCode).toBe(422);
    expect(bad.json().error.fields['row 2']).toEqual(['email:bad-email']);

    const { vatRate: _v, ...noVat } = template;
    const vat = await post('/v1/send/batch', batch({ template: noVat }));
    expect(vat.statusCode).toBe(422);
    expect(vat.json().error.fields['template']).toEqual(['template:vat-rate']);

    const unknown = await post('/v1/send/batch', batch({ message: '{{rent}}' }));
    expect(unknown.statusCode).toBe(422);
    expect(jobs()).toHaveLength(0);
  });

  it('test mode sends all of it to one address, each marked', async () => {
    await post('/v1/send/batch', batch({ testTo: 'me@example.com' }));
    await drain();
    expect(new Set(harness.mail.sent.map((mail) => mail.to))).toEqual(new Set(['me@example.com']));
    expect(harness.mail.sent.every((mail) => mail.subject.startsWith('[TEST] '))).toBe(true);
    expect(harness.mail.sent).toHaveLength(3);
  });

  it('keeps a recipient’s words out of the markup and out of the headers', async () => {
    const html = renderBatchHtml(
      { ...template, layout: 'letter', body: '{{name}}' },
      { ...rows[0]!, name: '<script>x</script>' },
      'AB',
    );
    expect(html).not.toContain('<script>x');
    await post(
      '/v1/send/batch',
      batch({ rows: [{ ...rows[0], name: 'Åsa\r\nBcc: evil@example.com' }] }),
    );
    await drain();
    expect(harness.mail.sent[0]!.subject).not.toMatch(/[\r\n]/);
  });
});
