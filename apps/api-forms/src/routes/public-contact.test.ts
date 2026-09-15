import { afterEach, describe, expect, it } from 'vitest';
import { createTestHarness, type TestHarness } from '../test-support.js';

/**
 * The site's "get in touch" form, which posts the way a form posted in 1998.
 *
 * No script on the site, so the request is urlencoded and the answer is a redirect — and the
 * redirect is the one thing here that could be abused, so its shape is held.
 */
let harness: TestHarness;
afterEach(() => harness?.close());

const post = (body: Record<string, string>) =>
  harness.app.inject({
    method: 'POST',
    url: '/public/contact',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: new URLSearchParams(body).toString(),
  });

const MESSAGE = {
  name: 'Anna Lindqvist',
  organisation: 'Föreningen Vänner',
  email: 'anna@example.com',
  message: 'Vi har årsmöte i maj. Kan vi prova?',
  next: '/sv/contact/sent',
};

describe('the contact form', () => {
  it('sends the message to our inbox and lands on the thank-you page in their language', async () => {
    harness = await createTestHarness();
    const response = await post(MESSAGE);
    expect(response.statusCode).toBe(303);
    expect(response.headers.location).toBe('/sv/contact/sent');
    expect(harness.mail.sent).toHaveLength(1);
    expect(harness.mail.sent[0]!.to).toBe('hello@paloppa.test');
    expect(harness.mail.sent[0]!.text).toContain('anna@example.com');
    expect(harness.mail.sent[0]!.text).toContain('årsmöte');
  });

  it('answers a bot the same way, and sends nothing', async () => {
    harness = await createTestHarness();
    const response = await post({ ...MESSAGE, website: 'http://spam.example' });
    expect(response.statusCode).toBe(303);
    expect(harness.mail.sent).toHaveLength(0);
  });

  it('never redirects anywhere but the thank-you page', async () => {
    harness = await createTestHarness();
    for (const next of ['https://evil.example', '//evil.example', '/login', '/contact/sent/../x']) {
      const response = await post({ ...MESSAGE, next });
      expect(response.statusCode, next).toBe(400);
    }
    expect(harness.mail.sent).toHaveLength(0);
  });

  it('refuses loudly when nobody is configured to receive it', async () => {
    harness = await createTestHarness({}, { contactAddress: null });
    const response = await post(MESSAGE);
    expect(response.statusCode).toBe(503);
    expect(harness.mail.sent).toHaveLength(0);
  });
});
