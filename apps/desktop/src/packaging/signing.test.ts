import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { macSigningPlan } from './signing.js';

const PLIST = '/repo/apps/desktop/packaging/entitlements.mac.plist';

describe('how the Mac app is signed', () => {
  it('is ad-hoc with no certificate — and never borrows one from the keychain', () => {
    const plan = macSigningPlan({}, PLIST);
    expect(plan.signing).toBe('ad-hoc');
    expect(plan.notarise).toBe(false);
    expect(plan.args).toContain('-c.mac.identity=null');
    expect(plan.args).toContain('-c.mac.hardenedRuntime=false');
    expect(plan.warnings).toEqual([]);
  });

  it('treats an empty secret as no secret (an unset GitHub secret arrives as "")', () => {
    expect(macSigningPlan({ CSC_LINK: '', APPLE_API_KEY: '  ' }, PLIST).signing).toBe('ad-hoc');
  });

  it('signs with a Developer ID, hardened, and notarises with an API key', () => {
    const plan = macSigningPlan(
      {
        CSC_LINK: 'base64-p12',
        APPLE_API_KEY: '/tmp/AuthKey.p8',
        APPLE_API_KEY_ID: 'ABC123',
        APPLE_API_ISSUER: 'issuer-uuid',
      },
      PLIST,
    );
    expect(plan.signing).toBe('developer-id');
    expect(plan.notarise).toBe(true);
    expect(plan.args).toEqual([
      '-c.mac.hardenedRuntime=true',
      `-c.mac.entitlements=${PLIST}`,
      `-c.mac.entitlementsInherit=${PLIST}`,
    ]);
    expect(plan.args.join(' ')).not.toContain('identity');
    expect(plan.warnings).toEqual([]);
  });

  it('notarises with an Apple ID too, and with a certificate already in the keychain', () => {
    const plan = macSigningPlan(
      {
        CSC_NAME: 'Developer ID Application: Example AB (TEAM123)',
        APPLE_ID: 'dev@example.com',
        APPLE_APP_SPECIFIC_PASSWORD: 'abcd-efgh',
        APPLE_TEAM_ID: 'TEAM123',
      },
      PLIST,
    );
    expect(plan).toMatchObject({ signing: 'developer-id', notarise: true });
  });

  it('says so when a Developer ID has nothing to notarise with', () => {
    const plan = macSigningPlan({ CSC_LINK: 'base64-p12' }, PLIST);
    expect(plan).toMatchObject({ signing: 'developer-id', notarise: false });
    expect(plan.args).toContain('-c.mac.notarize=false');
    expect(plan.warnings.join(' ')).toMatch(/not notarised/);
  });

  it('says so when notarisation credentials have no Developer ID to go with', () => {
    const plan = macSigningPlan({ APPLE_KEYCHAIN_PROFILE: 'loppa' }, PLIST);
    expect(plan.signing).toBe('ad-hoc');
    expect(plan.warnings.join(' ')).toMatch(/no Developer ID/);
  });

  it('refuses credentials set in part, naming what is missing', () => {
    expect(() =>
      macSigningPlan({ CSC_LINK: 'x', APPLE_API_KEY: 'k', APPLE_API_KEY_ID: 'id' }, PLIST),
    ).toThrow(/APPLE_API_ISSUER not/);
    expect(() => macSigningPlan({ APPLE_ID: 'dev@example.com' }, PLIST)).toThrow(
      /APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID not/,
    );
  });
});

describe('the entitlements the hardened runtime is given', () => {
  it('are exactly JIT, the camera and Apple events', async () => {
    const plist = await readFile(
      new URL('../../packaging/entitlements.mac.plist', import.meta.url),
      'utf8',
    );
    const body = plist.replace(/<!--[\s\S]*?-->/g, '');
    const keys = [...body.matchAll(/<key>([^<]+)<\/key>\s*<true\/>/g)].map((match) => match[1]);
    expect(keys).toEqual([
      'com.apple.security.cs.allow-jit',
      'com.apple.security.device.camera',
      'com.apple.security.automation.apple-events',
    ]);
    // Every key is granted; nothing is listed and quietly set false.
    expect(body.match(/<key>/g)).toHaveLength(3);
  });
});
