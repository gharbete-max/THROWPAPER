import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  adminUser,
  bearer,
  createTestHarness,
  operatorUser,
  signIn,
  type TestHarness,
} from '../test-support.js';
import { createPhoneScanStore, PHONE_SCAN_TTL_MS } from '../phone-scan/store.js';

let harness: TestHarness;
let adminToken: string;

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 1, 2, 3]);

beforeEach(async () => {
  harness = await createTestHarness();
  adminToken = (await signIn(harness, adminUser.email)).accessToken;
});
afterEach(() => harness.close());

async function open(token = adminToken) {
  const response = await harness.app.inject({
    method: 'POST',
    url: '/v1/phone-scans',
    headers: bearer(token),
  });
  expect(response.statusCode).toBe(201);
  const body = response.json() as { id: string; phoneUrl: string; qrSvg: string; pages: number };
  return { ...body, token: body.phoneUrl.split('/phone-scan/')[1]! };
}

function send(token: string, bytes: Buffer, contentType = 'image/jpeg') {
  return harness.app.inject({
    method: 'POST',
    url: `/v1/phone-scan/${token}/pages`,
    payload: { contentType, base64: bytes.toString('base64') },
  });
}

describe('scanning with a phone', () => {
  it('carries pages from the phone to the person who opened the scan, and no one else', async () => {
    const session = await open();
    expect(session.phoneUrl).toMatch(/^http:\/\/localhost:5173\/phone-scan\/[A-Za-z0-9_-]{43}$/);
    expect(session.qrSvg).toContain('<svg');
    expect(session.pages).toBe(0);

    // The phone: no sign-in, only the link.
    const status = await harness.app.inject({
      method: 'GET',
      url: `/v1/phone-scan/${session.token}`,
    });
    expect(status.json()).toMatchObject({ pages: 0, maxPages: 20 });
    expect((await send(session.token, JPEG)).json()).toMatchObject({ pages: 1 });

    const mine = await harness.app.inject({
      method: 'GET',
      url: `/v1/phone-scans/${session.id}`,
      headers: bearer(adminToken),
    });
    expect(mine.json().pages).toBe(1);
    const page = await harness.app.inject({
      method: 'GET',
      url: `/v1/phone-scans/${session.id}/pages/1`,
      headers: bearer(adminToken),
    });
    expect(page.headers['content-type']).toBe('image/jpeg');
    expect(Buffer.from(page.rawPayload)).toEqual(JPEG);

    // A colleague in the same organisation cannot read it.
    const operator = (await signIn(harness, operatorUser.email)).accessToken;
    const theirs = await harness.app.inject({
      method: 'GET',
      url: `/v1/phone-scans/${session.id}/pages/1`,
      headers: bearer(operator),
    });
    expect(theirs.statusCode).toBe(404);

    // Closing it ends the link.
    await harness.app.inject({
      method: 'DELETE',
      url: `/v1/phone-scans/${session.id}`,
      headers: bearer(adminToken),
    });
    expect((await send(session.token, JPEG)).statusCode).toBe(404);
  });

  it('takes images only, judged by their bytes', async () => {
    const { token } = await open();
    const pdf = Buffer.from('%PDF-1.7 not a photo');
    expect((await send(token, pdf)).statusCode).toBe(422);
    expect((await send(token, pdf, 'image/png')).statusCode).toBe(422);
  });

  it('refuses a link it did not make, and needs a sign-in to open one', async () => {
    const forged = 'A'.repeat(43);
    expect((await send(forged, JPEG)).statusCode).toBe(404);
    expect((await harness.app.inject({ method: 'POST', url: '/v1/phone-scans' })).statusCode).toBe(
      401,
    );
  });

  it('stops at twenty pages', async () => {
    const { token } = await open();
    for (let i = 0; i < 20; i += 1) expect((await send(token, JPEG)).statusCode).toBe(201);
    expect((await send(token, JPEG)).statusCode).toBe(409);
  });
});

describe('the phone-scan store', () => {
  it('forgets a session after fifteen minutes, and keeps only the token hash', () => {
    let now = 0;
    const store = createPhoneScanStore(() => now);
    const { session, token } = store.open({ organisationId: 'o', userId: 'u' });
    expect(store.byToken(token)?.id).toBe(session.id);
    expect(JSON.stringify(session)).not.toContain(token);
    now = PHONE_SCAN_TTL_MS;
    expect(store.byToken(token)).toBeNull();
    expect(store.active()).toBe(0);
  });

  it('keeps at most three open per person', () => {
    let now = 0;
    const store = createPhoneScanStore(() => now++);
    const first = store.open({ organisationId: 'o', userId: 'u' });
    store.open({ organisationId: 'o', userId: 'u' });
    store.open({ organisationId: 'o', userId: 'u' });
    store.open({ organisationId: 'o', userId: 'u' });
    expect(store.byToken(first.token)).toBeNull();
    expect(store.active()).toBe(3);
  });
});
