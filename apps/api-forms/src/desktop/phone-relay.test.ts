import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { adminUser, bearer, createTestHarness, signIn, type TestHarness } from '../test-support.js';
import { createPhoneRelay, isRelayed, lanAddress, type PhoneRelay } from './phone-relay.js';

const TOKEN = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJ0123456';

describe('what the LAN relay lets through', () => {
  it('passes the scan page, its two endpoints and the static app', () => {
    expect(isRelayed('GET', `/phone-scan/${TOKEN}`)).toBe(true);
    expect(isRelayed('GET', `/api/v1/phone-scan/${TOKEN}`)).toBe(true);
    expect(isRelayed('POST', `/api/v1/phone-scan/${TOKEN}/pages`)).toBe(true);
    expect(isRelayed('GET', '/assets/index-abc123.js')).toBe(true);
    expect(isRelayed('GET', '/favicon.svg')).toBe(true);
  });

  it('refuses everything else', () => {
    for (const [method, url] of [
      ['GET', '/'],
      ['GET', '/signing'],
      ['GET', '/api/v1/forms'],
      ['POST', '/api/v1/auth/magic-link'],
      ['GET', '/api/v1/phone-scans/00000000-0000-0000-0000-000000000000'],
      ['GET', '/api/documents/x.pdf'],
      ['DELETE', `/api/v1/phone-scan/${TOKEN}`],
      ['GET', `/phone-scan/${TOKEN}/../../api/v1/forms`],
      ['GET', '/assets/../api/v1/forms'],
      ['GET', `/phone-scan/short`],
    ] as const) {
      expect(isRelayed(method, url), `${method} ${url}`).toBe(false);
    }
  });

  it('prefers a home-network address and skips loopback and link-local', () => {
    expect(
      lanAddress({
        lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true } as never],
        vpn: [{ address: '10.8.0.2', family: 'IPv4', internal: false } as never],
        ll: [{ address: '169.254.1.1', family: 'IPv4', internal: false } as never],
        wifi: [{ address: '192.168.1.23', family: 'IPv4', internal: false } as never],
      }),
    ).toBe('192.168.1.23');
    expect(lanAddress({})).toBeNull();
  });
});

describe('the relay, listening', () => {
  let harness: TestHarness;
  let relay: PhoneRelay;

  beforeEach(async () => {
    harness = await createTestHarness();
    relay = createPhoneRelay({
      app: () => harness.app,
      active: () => 1,
      address: () => '127.0.0.1',
    });
  });
  afterEach(async () => {
    await relay.close();
    await harness.close();
  });

  it('carries a page from a phone, and nothing else', async () => {
    const admin = (await signIn(harness, adminUser.email)).accessToken;
    const opened = await harness.app.inject({
      method: 'POST',
      url: '/v1/phone-scans',
      headers: bearer(admin),
    });
    const token = (opened.json() as { phoneUrl: string }).phoneUrl.split('/phone-scan/')[1]!;
    const origin = await relay.open();
    expect(origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);

    const sent = await fetch(`${origin}/api/v1/phone-scan/${token}/pages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contentType: 'image/jpeg',
        base64: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1]).toString('base64'),
      }),
    });
    expect(sent.status).toBe(201);
    expect(sent.headers.get('strict-transport-security')).toBeNull();
    expect(sent.headers.get('content-security-policy') ?? '').not.toContain(
      'upgrade-insecure-requests',
    );

    // Signed in or not, nothing else is reachable through it.
    const other = await fetch(`${origin}/api/v1/forms`, { headers: bearer(admin) });
    expect(other.status).toBe(404);
  });
});
