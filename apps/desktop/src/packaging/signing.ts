/**
 * How the Mac app is signed, decided from the environment the build runs in
 * (LAUNCH-CHECKLIST §6; docs/adr/0016-desktop-edition.md).
 *
 * Two ways, and nothing in between:
 *
 * - **ad-hoc** — no certificate. `scripts/after-pack.cjs` signs with `-`, which is what lets an
 *   Apple Silicon Mac run the app at all; Gatekeeper still asks on first open. Every build today.
 * - **developer-id** — the owner's certificate is in `CSC_LINK` (a .p12, as electron-builder reads
 *   it) or `CSC_NAME` (one already in the keychain). electron-builder signs with it, the hardened
 *   runtime goes on with the entitlements the app needs, and — when Apple's notarisation
 *   credentials are there too — the app is notarised and stapled, so it opens without a question.
 *
 * Adding the secrets is the whole switch: no file changes the day the certificate arrives.
 */
export type MacSigning = 'ad-hoc' | 'developer-id';

export interface MacSigningPlan {
  signing: MacSigning;
  /** Whether electron-builder will notarise: only with a Developer ID and Apple's credentials. */
  notarise: boolean;
  /** Extra `electron-builder` arguments. */
  args: string[];
  /** Said on the console, so a half-configured build is loud rather than quietly unnotarised. */
  warnings: string[];
}

type Env = Readonly<Record<string, string | undefined>>;

const set = (env: Env, name: string) => (env[name] ?? '').trim() !== '';

/**
 * The notarisation credentials electron-builder accepts, in its own order (app-builder-lib's
 * `MacTargetHelper.getNotarizeOptions`): an Apple ID with an app-specific password and team, an
 * App Store Connect API key, or a keychain profile. A group set in part is refused.
 */
const NOTARY_GROUPS: readonly (readonly string[])[] = [
  ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID'],
  ['APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER'],
  ['APPLE_KEYCHAIN_PROFILE'],
];

export function macSigningPlan(env: Env, entitlements: string): MacSigningPlan {
  const identity = set(env, 'CSC_LINK') || set(env, 'CSC_NAME');

  for (const group of NOTARY_GROUPS) {
    const present = group.filter((name) => set(env, name));
    if (present.length > 0 && present.length < group.length) {
      const missing = group.filter((name) => !set(env, name));
      throw new Error(
        `Notarisation is half-configured: ${present.join(', ')} set, ${missing.join(', ')} not.`,
      );
    }
  }
  const credentials = NOTARY_GROUPS.some((group) => group.every((name) => set(env, name)));

  if (!identity) {
    return {
      signing: 'ad-hoc',
      notarise: false,
      // Never let electron-builder pick up whatever certificate is in this Mac's keychain.
      args: ['-c.mac.identity=null', '-c.mac.hardenedRuntime=false', '-c.mac.notarize=false'],
      warnings: credentials
        ? ['Apple notarisation credentials are set but no Developer ID is: ad-hoc signed only.']
        : [],
    };
  }

  return {
    signing: 'developer-id',
    notarise: credentials,
    args: [
      '-c.mac.hardenedRuntime=true',
      `-c.mac.entitlements=${entitlements}`,
      `-c.mac.entitlementsInherit=${entitlements}`,
      // No `timestamp`: @electron/osx-sign asks Apple's timestamp server by default, which is the
      // secure timestamp notarisation requires.
      ...(credentials ? [] : ['-c.mac.notarize=false']),
    ],
    warnings: credentials
      ? []
      : [
          'Signed with a Developer ID but not notarised: no Apple notarisation credentials are ' +
            'set, so Gatekeeper still refuses the app on first open.',
        ],
  };
}
