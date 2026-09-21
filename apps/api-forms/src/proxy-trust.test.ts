import { afterEach, describe, expect, it, vi } from 'vitest';
import { adminUser, createTestHarness, type TestHarness } from './test-support.js';

/**
 * Whose address a request has, behind exactly the hop we mean.
 *
 * Every rate limit keys on `request.ip`, and so does `login_tokens.requested_ip`. With
 * `TRUST_PROXY` empty that is the socket — right on localhost, and wrong the moment something
 * forwards for us, because then every visitor is the forwarder and six sign-in attempts from
 * anywhere close the door for the whole tenant. The local track puts ngrok in front, and the
 * ngrok agent connects from loopback, so the value that trusts that hop and nothing else is
 * `loopback`.
 *
 * `true` is never the answer: it believes the whole `X-Forwarded-For` header, including the part
 * the client wrote, and turns a lock-out into a bypass. These cases pin the four shapes the
 * laptop actually sees — plain local, through ngrok, through ngrok with a forged header, and a
 * LAN neighbour hitting the port directly — and that two visitors through the tunnel get two
 * rate-limit buckets rather than one.
 *
 * `buildServer` reads `TRUST_PROXY` from `process.env`, so each case stubs it before building.
 */
let harness: TestHarness | undefined;

afterEach(async () => {
  await harness?.close();
  harness = undefined;
  vi.unstubAllEnvs();
});

async function build(trustProxy: string) {
  vi.stubEnv('TRUST_PROXY', trustProxy);
  harness = await createTestHarness();
  const created = vi.spyOn(harness.repos.tokens, 'createLoginToken');
  return { harness, created };
}

/** Asks for a magic link as the given socket address and forwarded chain; returns the status. */
async function requestLink(
  app: TestHarness['app'],
  remoteAddress: string,
  forwardedFor?: string,
): Promise<number> {
  const response = await app.inject({
    method: 'POST',
    url: '/v1/auth/magic-link',
    remoteAddress,
    headers: forwardedFor ? { 'x-forwarded-for': forwardedFor } : {},
    payload: { email: adminUser.email },
  });
  return response.statusCode;
}

function lastIp(created: ReturnType<typeof vi.spyOn>): string | null | undefined {
  const call = created.mock.calls.at(-1) as [{ requestedIp: string | null }] | undefined;
  return call?.[0].requestedIp;
}

describe('with TRUST_PROXY empty', () => {
  it('ignores X-Forwarded-For: the socket is the visitor', async () => {
    const { harness, created } = await build('');
    expect(await requestLink(harness.app, '127.0.0.1', '203.0.113.5')).toBe(202);
    expect(lastIp(created)).toBe('127.0.0.1');
  });
});

describe('with TRUST_PROXY=loopback', () => {
  it('believes a loopback hop about the visitor', async () => {
    const { harness, created } = await build('loopback');
    expect(await requestLink(harness.app, '127.0.0.1', '203.0.113.5')).toBe(202);
    expect(lastIp(created)).toBe('203.0.113.5');
  });

  /**
   * ngrok appends the address it saw, so a client that writes its own `X-Forwarded-For` arrives
   * as `<forged>, <real>`. The walk from the right stops at the first untrusted address — the real
   * one — and the forgery is never reached.
   */
  it('takes the address the tunnel appended, not the one the client wrote', async () => {
    const { harness, created } = await build('loopback');
    expect(await requestLink(harness.app, '127.0.0.1', '198.51.100.7, 203.0.113.5')).toBe(202);
    expect(lastIp(created)).toBe('203.0.113.5');
  });

  /** A neighbour on the LAN reaching the port directly is not loopback, so their header is noise. */
  it('does not believe a non-loopback socket, however it is dressed', async () => {
    const { harness, created } = await build('loopback');
    expect(await requestLink(harness.app, '192.168.0.9', '198.51.100.7')).toBe(202);
    expect(lastIp(created)).toBe('192.168.0.9');
  });

  /** The magic-link route allows five per fifteen minutes — per visitor, not per tunnel. */
  it('gives two visitors through the tunnel two rate-limit buckets', async () => {
    const { harness } = await build('loopback');
    for (let i = 0; i < 5; i += 1) {
      expect(await requestLink(harness.app, '127.0.0.1', '203.0.113.5')).toBe(202);
    }
    expect(await requestLink(harness.app, '127.0.0.1', '203.0.113.5')).toBe(429);
    expect(await requestLink(harness.app, '127.0.0.1', '203.0.113.6')).toBe(202);
  });
});
