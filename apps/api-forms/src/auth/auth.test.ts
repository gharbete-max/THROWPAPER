import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { adminUser, bearer, createTestHarness, signIn, type TestHarness } from '../test-support.js';

let harness: TestHarness;

beforeEach(async () => {
  harness = await createTestHarness();
});

afterEach(async () => {
  await harness.close();
});

describe('magic link', () => {
  it('sends a link to a known address', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/auth/magic-link',
      payload: { email: adminUser.email },
    });

    expect(response.statusCode).toBe(202);
    expect(harness.mail.sent).toHaveLength(1);
    expect(harness.mail.sent[0]?.to).toBe(adminUser.email);
  });

  it('answers identically for an unknown address — no enumeration oracle', async () => {
    const known = await harness.app.inject({
      method: 'POST',
      url: '/v1/auth/magic-link',
      payload: { email: adminUser.email },
    });
    const unknown = await harness.app.inject({
      method: 'POST',
      url: '/v1/auth/magic-link',
      payload: { email: 'nobody@example.com' },
    });

    expect(unknown.statusCode).toBe(known.statusCode);
    expect(unknown.body).toBe(known.body);
    // ...and nothing was actually sent.
    expect(harness.mail.sent).toHaveLength(1);
  });

  it('stores only a hash of the token, never the token itself', async () => {
    await harness.app.inject({
      method: 'POST',
      url: '/v1/auth/magic-link',
      payload: { email: adminUser.email },
    });

    const secret = /token=([A-Za-z0-9_-]+)/.exec(harness.mail.sent[0]?.text ?? '')?.[1];
    expect(secret).toBeTruthy();
    const stored = harness.state.loginTokens[0];
    expect(stored?.tokenHash).not.toBe(secret);
    expect(stored?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is single use', async () => {
    await harness.app.inject({
      method: 'POST',
      url: '/v1/auth/magic-link',
      payload: { email: adminUser.email },
    });
    const token = /token=([A-Za-z0-9_-]+)/.exec(harness.mail.sent[0]?.text ?? '')?.[1];

    const first = await harness.app.inject({
      method: 'POST',
      url: '/v1/auth/token',
      payload: { token },
    });
    const second = await harness.app.inject({
      method: 'POST',
      url: '/v1/auth/token',
      payload: { token },
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(401);
    expect(second.json().error.code).toBe('magic-link-used');
  });

  it('refuses an expired link', async () => {
    await harness.app.inject({
      method: 'POST',
      url: '/v1/auth/magic-link',
      payload: { email: adminUser.email },
    });
    const token = /token=([A-Za-z0-9_-]+)/.exec(harness.mail.sent[0]?.text ?? '')?.[1];
    const stored = harness.state.loginTokens[0];
    if (stored) stored.expiresAt = new Date(Date.now() - 1000);

    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/auth/token',
      payload: { token },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('magic-link-expired');
  });

  it('refuses a token that was never issued', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/auth/token',
      payload: { token: 'not-a-real-token-but-long-enough' },
    });
    expect(response.statusCode).toBe(401);
  });
});

describe('refresh tokens', () => {
  it('rotates: the old token stops working and a new one is issued', async () => {
    const session = await signIn(harness, adminUser.email);

    const refreshed = await harness.app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refreshToken: session.refreshToken },
    });
    expect(refreshed.statusCode).toBe(200);
    expect(refreshed.json().refreshToken).not.toBe(session.refreshToken);

    const replay = await harness.app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refreshToken: session.refreshToken },
    });
    expect(replay.statusCode).toBe(401);
  });

  it('revokes the whole family when a rotated token is presented again', async () => {
    const session = await signIn(harness, adminUser.email);
    const rotated = await harness.app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refreshToken: session.refreshToken },
    });
    const current = rotated.json().refreshToken as string;

    // The leaked original comes back — that is the signal the chain is compromised.
    const replay = await harness.app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refreshToken: session.refreshToken },
    });
    expect(replay.json().error.code).toBe('refresh-reused');

    // The token the legitimate client holds is dead too.
    const afterBreach = await harness.app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refreshToken: current },
    });
    expect(afterBreach.statusCode).toBe(401);
    expect(harness.state.refreshTokens.every((token) => token.revokedAt !== null)).toBe(true);
  });

  it('refuses an expired refresh token', async () => {
    const session = await signIn(harness, adminUser.email);
    const stored = harness.state.refreshTokens[0];
    if (stored) stored.expiresAt = new Date(Date.now() - 1000);

    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refreshToken: session.refreshToken },
    });
    expect(response.json().error.code).toBe('refresh-expired');
  });

  it('logout revokes the presented token', async () => {
    const session = await signIn(harness, adminUser.email);
    const loggedOut = await harness.app.inject({
      method: 'POST',
      url: '/v1/auth/logout',
      payload: { refreshToken: session.refreshToken },
    });
    expect(loggedOut.statusCode).toBe(204);

    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refreshToken: session.refreshToken },
    });
    expect(response.statusCode).toBe(401);
  });
});

describe('bearer guard', () => {
  it('returns the signed-in user and the organisation locale config', async () => {
    const session = await signIn(harness, adminUser.email);
    const response = await harness.app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: bearer(session.accessToken),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().user.email).toBe(adminUser.email);
    expect(response.json().organisation.supportedLocales).toEqual(['sv-SE', 'en-GB']);
  });

  it('rejects a missing or malformed token', async () => {
    expect((await harness.app.inject({ method: 'GET', url: '/v1/me' })).statusCode).toBe(401);
    expect(
      (
        await harness.app.inject({
          method: 'GET',
          url: '/v1/me',
          headers: bearer('not.a.jwt'),
        })
      ).statusCode,
    ).toBe(401);
  });

  it('rejects a user disabled after the token was issued', async () => {
    const session = await signIn(harness, adminUser.email);
    const user = harness.state.users.find((candidate) => candidate.id === adminUser.id);
    if (user) user.disabledAt = new Date();

    const response = await harness.app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: bearer(session.accessToken),
    });
    expect(response.statusCode).toBe(401);
  });
});
