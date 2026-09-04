import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from './server.js';
import { createMemoryRepositories } from './db/repositories/memory.js';

/**
 * The headers a browser needs, on a server that hands it HTML.
 *
 * There were none. Not a weak set — none: no framing policy, no `nosniff`, no referrer policy, no
 * content policy. That is a reasonable position for an API nobody points a browser at, and this one
 * serves the app, the marketing site, and every public registration page a stranger opens from a
 * link in an email.
 *
 * The policy is strict because the app earns it: no inline scripts, no CDN, no external origins. So
 * `script-src 'self'` is a real constraint here rather than the aspiration it usually is, and the
 * point of this test is that it stays real. A header dropped in a refactor is invisible — nothing
 * breaks, nothing logs, and the protection is simply gone.
 */
let app: FastifyInstance;

beforeAll(async () => {
  app = await buildServer({
    repos: createMemoryRepositories(),
    jwtSecret: 'test-secret-that-is-at-least-32-characters-long',
    probeDatabase: false,
  });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe('security headers', () => {
  it('sends them on a public page, which is where a stranger arrives', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/public/forms/anything' });
    const headers = response.headers;

    expect(headers['content-security-policy']).toBeDefined();
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  });

  it.each([
    ["script-src 'self'", 'a script from anywhere else cannot run'],
    ["object-src 'none'", 'no plugins'],
    ["frame-ancestors 'none'", 'a registration page cannot be framed and clickjacked'],
    ["base-uri 'self'", 'an injected <base> cannot redirect every relative URL'],
    ["form-action 'self'", 'a form cannot be made to post somewhere else'],
  ])('keeps %s, so %s', async (directive) => {
    const response = await app.inject({ method: 'GET', url: '/api/public/forms/anything' });
    expect(String(response.headers['content-security-policy'])).toContain(directive);
  });

  /**
   * The three things this app does that a stricter policy would break.
   *
   * Verified in a browser as well, because a policy that passes a string check and blocks the CSV
   * export is worse than no test at all. These are here so the reason each allowance exists is
   * written down next to it.
   */
  it.each([
    ['img-src', 'data:', 'the QR on an admission card'],
    ['img-src', 'blob:', 'an attachment or a CSV being saved'],
    ['style-src', "'unsafe-inline'", 'the brand palette, injected as a style block'],
  ])('allows %s %s for %s', async (_directive, allowance) => {
    const response = await app.inject({ method: 'GET', url: '/api/public/forms/anything' });
    expect(String(response.headers['content-security-policy'])).toContain(allowance);
  });

  /**
   * One capability, granted to one screen.
   *
   * Without this header every API a browser has ever shipped is available to anything that gets
   * onto the page. The camera is named because the door screen reads a QR with it.
   */
  it('grants the camera and refuses the rest', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/public/forms/anything' });
    const policy = String(response.headers['permissions-policy']);

    expect(policy).toContain('camera=(self)');
    for (const denied of ['geolocation=()', 'microphone=()', 'payment=()', 'usb=()']) {
      expect(policy).toContain(denied);
    }
  });
});
