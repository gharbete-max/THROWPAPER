import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { forms as formSchemas } from '@tp/shared';
import { defaultTokens } from '@tp/tokens';
import { adminUser, bearer, createTestHarness, signIn, type TestHarness } from '../test-support.js';
import { renderConfirmation } from '../email/templates.js';
import { buildMimeMessage } from './ses.js';
import { createMemoryMailProvider } from './provider.js';
import { createMailSendHandler } from './send-job.js';

let harness: TestHarness;
let adminToken: string;

const fields = [
  {
    id: 'f1',
    key: 'full_name',
    type: 'short_text' as const,
    label: { 'sv-SE': 'Namn', 'en-GB': 'Name' },
    required: true,
  },
  {
    id: 'f2',
    key: 'email',
    type: 'email' as const,
    label: { 'sv-SE': 'E-post', 'en-GB': 'Email' },
    required: true,
  },
];

async function registerSomeone(locale: 'sv-SE' | 'en-GB' = 'sv-SE') {
  const event = await harness.app.inject({
    method: 'POST',
    url: '/v1/events',
    headers: bearer(adminToken),
    payload: {
      name: { 'sv-SE': 'Vårmötet', 'en-GB': 'Spring meeting' },
      startsAt: '2027-05-14T09:00:00.000Z',
      endsAt: '2027-05-14T16:00:00.000Z',
      venueName: 'Näringslivets Hus',
      status: 'open',
    },
  });

  const created = await harness.app.inject({
    method: 'POST',
    url: '/v1/forms',
    headers: bearer(adminToken),
    payload: { slug: 'anmalan', title: { 'sv-SE': 'Anmälan', 'en-GB': 'Registration' } },
  });
  const formId = created.json().id as string;

  await harness.app.inject({
    method: 'PATCH',
    url: `/v1/forms/${formId}`,
    headers: bearer(adminToken),
    payload: { eventId: event.json().id },
  });
  await harness.app.inject({
    method: 'PUT',
    url: `/v1/forms/${formId}/draft`,
    headers: bearer(adminToken),
    payload: { definition: { ...formSchemas.emptyDefinition, fields } },
  });
  await harness.app.inject({
    method: 'POST',
    url: `/v1/forms/${formId}/publish`,
    headers: bearer(adminToken),
    payload: { overrideIncompleteTranslations: false },
  });

  await harness.app.inject({
    method: 'POST',
    url: '/public/forms/anmalan',
    payload: { locale, values: { full_name: 'Björn Öberg', email: 'bjorn@example.com' } },
  });

  return { formId };
}

beforeEach(async () => {
  harness = await createTestHarness();
  adminToken = (await signIn(harness, adminUser.email)).accessToken;
});

afterEach(async () => {
  await harness.close();
});

describe('sending on submission', () => {
  it('enqueues rather than sending inline — a registration must not wait on a provider', async () => {
    await registerSomeone();

    const mailJobs = harness.state.jobs.filter((job) => job.kind === 'mail.send');
    expect(mailJobs).toHaveLength(2);
    // The magic link from signing in is the only mail so far.
    expect(harness.mail.sent.filter((m) => m.subject.includes('bekräftad'))).toHaveLength(0);
  });

  it('sends the confirmation with the admission PDF attached', async () => {
    await registerSomeone();
    await harness.app.worker.drain();

    const confirmation = harness.mail.sent.find((mail) => mail.to === 'bjorn@example.com');
    expect(confirmation).toBeTruthy();
    expect(confirmation?.attachments).toHaveLength(1);
    expect(confirmation?.attachments?.[0]?.contentType).toBe('application/pdf');
  });

  it('writes a per-recipient message log', async () => {
    await registerSomeone();
    await harness.app.worker.drain();

    const logged = harness.state.messages.find(
      (message) => message.templateKey === 'registration.confirmation',
    );
    expect(logged?.to).toBe('bjorn@example.com');
    expect(logged?.providerMessageId).toBeTruthy();
    expect(logged?.sentAt).toBeTruthy();
  });

  it('confirms in the language the form was filled in', async () => {
    await registerSomeone('en-GB');
    await harness.app.worker.drain();

    const confirmation = harness.mail.sent.find((mail) => mail.to === 'bjorn@example.com');
    expect(confirmation?.subject).toContain('Your registration is confirmed');
    expect(confirmation?.subject).toContain('Spring meeting');
  });

  it('does not double-send when the job is retried', async () => {
    await registerSomeone();
    await harness.app.worker.drain();
    // Re-enqueueing the same keys must be a no-op.
    await harness.app.worker.drain();

    const confirmations = harness.mail.sent.filter((mail) => mail.to === 'bjorn@example.com');
    expect(confirmations).toHaveLength(1);
  });

  it('skips the operator notification when no address is configured', async () => {
    await registerSomeone();
    await harness.app.worker.drain();

    const notification = harness.state.jobs.find((job) =>
      job.idempotencyKey.includes('registration.notification'),
    );
    expect(notification?.status).toBe('done');
    expect(notification?.result).toMatchObject({ skipped: expect.any(String) });
  });
});

describe('the confirmation email itself', () => {
  it('resolves every style — email clients understand no custom properties', async () => {
    const html = await renderConfirmation(defaultTokens, {
      lang: 'sv-SE',
      heading: 'Din anmälan är bekräftad',
      intro: 'Tack.',
      eventName: 'Vårmötet',
      when: 'torsdag 14 maj',
      where: 'Göteborg',
      referenceLabel: 'Referens',
      reference: 'AB12-CD34',
      attachmentNote: 'Bifogat.',
      footer: 'Demo AB',
      webVersionLabel: 'Visa i webbläsare',
      webVersionUrl: 'https://example.com/r/AB12-CD34',
    });

    expect(html).not.toContain('var(--');
    expect(html).toContain('<table');
    // The brand's primary colour arrives resolved, from phase 1's compiler.
    expect(html.toLowerCase()).toContain(defaultTokens.colour.primary.toLowerCase());
  });

  it('keeps Swedish characters intact', async () => {
    const html = await renderConfirmation(defaultTokens, {
      lang: 'sv-SE',
      heading: 'Din anmälan är bekräftad',
      intro: 'Tack.',
      eventName: 'Vårmötet',
      when: '',
      where: '',
      referenceLabel: 'Referens',
      reference: 'AB12-CD34',
      attachmentNote: '',
      footer: '',
      webVersionLabel: 'Visa',
      webVersionUrl: 'https://example.com',
    });
    expect(html).toContain('anmälan');
    expect(html).toContain('Vårmötet');
  });
});

describe('the SES MIME envelope', () => {
  const base = {
    to: 'bjorn@example.com',
    from: 'anmalan@demo.se',
    subject: 'Din anmälan är bekräftad',
    text: 'Tack för din anmälan.',
  };

  it('encodes a non-ASCII subject, or it arrives as mojibake', () => {
    const mime = buildMimeMessage(base);
    expect(mime).toContain('Subject: =?UTF-8?B?');
    expect(mime).not.toContain('Subject: Din anmälan');
  });

  it('leaves an ASCII subject readable', () => {
    const mime = buildMimeMessage({ ...base, subject: 'Registration confirmed' });
    expect(mime).toContain('Subject: Registration confirmed');
  });

  it('wraps text and HTML as alternatives of each other', () => {
    const mime = buildMimeMessage({ ...base, html: '<p>Tack</p>' });
    expect(mime).toContain('multipart/alternative');
    expect(mime).toContain('text/plain; charset=utf-8');
    expect(mime).toContain('text/html; charset=utf-8');
  });

  it('adds a mixed part only when there is an attachment', () => {
    expect(buildMimeMessage(base)).not.toContain('multipart/mixed');

    const withPdf = buildMimeMessage({
      ...base,
      attachments: [
        {
          filename: 'admission.pdf',
          contentType: 'application/pdf',
          content: Buffer.from('%PDF-1.4'),
        },
      ],
    });
    expect(withPdf).toContain('multipart/mixed');
    expect(withPdf).toContain('Content-Disposition: attachment; filename="admission.pdf"');
  });

  it('wraps base64 bodies — some servers reject long lines', () => {
    const mime = buildMimeMessage({ ...base, text: 'x'.repeat(500) });
    const longest = Math.max(...mime.split('\r\n').map((line) => line.length));
    expect(longest).toBeLessThanOrEqual(78);
  });
});

describe('the no-override rule reaches the send path', () => {
  it('refuses to send through a real provider when the domain is unverified', async () => {
    const provider = { ...createMemoryMailProvider(), name: 'ses' };
    const handler = createMailSendHandler({
      repos: harness.repos,
      provider,
      admission: {
        repos: harness.repos,
        renderer: harness.renderer,
        store: harness.store,
        jwtSecret: 'test-secret-at-least-thirty-two-characters-long',
      },
      appUrl: 'http://localhost:5173',
      operatorAddress: null,
    });

    await registerSomeone();
    const submissionId = harness.state.submissions[0]!.id;
    const job = harness.state.jobs.find((candidate) => candidate.kind === 'mail.send')!;

    await expect(
      handler({
        job: { ...job, payload: { templateKey: 'registration.confirmation', submissionId } },
        progress: async () => {},
      }),
    ).rejects.toThrow(/not verified/);
  });
});
