import { z } from 'zod';
import {
  DESKTOP_TAG_PREFIX,
  MAX_INSTALLER_BYTES,
  RELEASE_REPO,
  type AiConsent,
} from '@tp/shared/ai';

/**
 * Reading GitHub's release list, and choosing what to offer from it (ADR 0026, amended). Pure: no
 * network, no clock, no disk. The fetching is `addons.ts`; the narrow list of hosts it may talk to
 * is here, because it belongs with the addresses it is built from.
 *
 * The update check is a question to one address and its answer is data: a tag, some notes and a
 * list of files. Nothing in the answer is followed or run; the address of the installer is built
 * from the tag and the file name, not taken from the answer.
 */

/**
 * The only hosts the update check and the installer download may reach, first address and every
 * redirect: the release page and API, and the two names GitHub has served release files from
 * (checked by a real request on 2026-10-26: `release-assets.githubusercontent.com`; the older
 * `objects.githubusercontent.com` is still answered). Exact names: not a suffix rule, so that a
 * user-content subdomain is not on the list. This is a second list on purpose, narrower than the
 * model download's (`isAllowedHost`) and the runtime's (`isRuntimeHost`), which it does not widen.
 */
export const UPDATE_HOSTS = [
  'github.com',
  'api.github.com',
  'release-assets.githubusercontent.com',
  'objects.githubusercontent.com',
] as const;

export function isUpdateHost(host: string): boolean {
  return (UPDATE_HOSTS as readonly string[]).includes(host.toLowerCase());
}

export const RELEASES_URL = `https://api.github.com/repos/${RELEASE_REPO}/releases?per_page=30`;
export const SUMS_NAME = 'SHA256SUMS.txt';

const releaseFileUrl = (tag: string, name: string) =>
  `https://github.com/${RELEASE_REPO}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(name)}`;
export { releaseFileUrl };

// --- versions -------------------------------------------------------------------------------

interface Version {
  numbers: [number, number, number];
  pre: string[];
}

/** `1.2.3`, `v1.2.3`, `1.2.3-rc.1`; build metadata (`+x`) is ignored. Anything else is null. */
export function parseVersion(text: string): Version | null {
  const match =
    /^v?(\d{1,9})\.(\d{1,9})\.(\d{1,9})(?:-([0-9A-Za-z.-]{1,50}))?(?:\+[0-9A-Za-z.-]+)?$/.exec(
      text.trim(),
    );
  if (!match) return null;
  return {
    numbers: [Number(match[1]), Number(match[2]), Number(match[3])],
    pre: match[4] ? match[4].split('.') : [],
  };
}

/** Semantic-version order: a release outranks its own pre-releases; numeric parts compare as numbers. */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) throw new Error('not a version');
  for (let i = 0; i < 3; i += 1) {
    if (x.numbers[i]! !== y.numbers[i]!) return x.numbers[i]! < y.numbers[i]! ? -1 : 1;
  }
  if (x.pre.length === 0 || y.pre.length === 0) {
    return x.pre.length === y.pre.length ? 0 : x.pre.length === 0 ? 1 : -1;
  }
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i += 1) {
    const p = x.pre[i];
    const q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    if (p === q) continue;
    const pn = /^\d+$/.test(p);
    const qn = /^\d+$/.test(q);
    if (pn && qn) return Number(p) < Number(q) ? -1 : 1;
    if (pn !== qn) return pn ? -1 : 1;
    return p < q ? -1 : 1;
  }
  return 0;
}

/** `desktop-v0.2.0` is version `0.2.0`; a tag of another prefix, or a malformed one, is null. */
export function versionOfTag(tag: string): string | null {
  if (!tag.startsWith(DESKTOP_TAG_PREFIX)) return null;
  const version = tag.slice(DESKTOP_TAG_PREFIX.length);
  return parseVersion(version) ? version : null;
}

// --- releases -------------------------------------------------------------------------------

const ReleaseAsset = z.object({
  name: z.string().max(255),
  size: z.number().int().nonnegative(),
  /** `sha256:<hex>` on a release GitHub has hashed; absent on older ones. */
  digest: z.string().nullish(),
});
export type ReleaseAsset = z.infer<typeof ReleaseAsset>;

const Release = z.object({
  tag_name: z.string().max(200),
  body: z.string().nullish(),
  html_url: z.string().url().nullish(),
  draft: z.boolean().optional(),
  prerelease: z.boolean().optional(),
  assets: z.array(ReleaseAsset).max(200),
});
export type Release = z.infer<typeof Release>;

/** What GitHub answered, or null when it is not a list of releases. */
export function parseReleases(json: unknown): Release[] | null {
  const parsed = z.array(Release).safeParse(json);
  return parsed.success ? parsed.data : null;
}

/**
 * The newest published desktop release, by version and not by the order GitHub lists them in: the
 * AI pack's release (another tag prefix), drafts and pre-releases are never offered.
 */
export function newestDesktop(
  releases: readonly Release[],
): { release: Release; version: string } | null {
  let best: { release: Release; version: string } | null = null;
  for (const release of releases) {
    if (release.draft || release.prerelease) continue;
    const version = versionOfTag(release.tag_name);
    if (!version) continue;
    if (!best || compareVersions(version, best.version) > 0) best = { release, version };
  }
  return best;
}

/**
 * The installer for this computer among a release's files, or null. Windows: the Setup program, or
 * the portable one when this copy is the portable program. macOS: the disk image for this chip.
 * Nothing is guessed for other systems, and nothing over {@link MAX_INSTALLER_BYTES} is an installer.
 */
export function chooseInstaller(
  assets: readonly ReleaseAsset[],
  platform: string,
  arch: string,
  portable = false,
): ReleaseAsset | null {
  const fits = (a: ReleaseAsset) =>
    a.size > 0 && a.size <= MAX_INSTALLER_BYTES && plainName(a.name);
  const pick = (test: RegExp) => assets.find((a) => fits(a) && test.test(a.name)) ?? null;
  if (platform === 'win32') {
    if (arch !== 'x64') return null;
    return portable ? pick(/portable.*\.exe$/i) : pick(/setup.*\.exe$/i);
  }
  if (platform === 'darwin') {
    return arch === 'arm64'
      ? pick(/(apple.?silicon|arm64|aarch64).*\.dmg$/i)
      : arch === 'x64'
        ? pick(/(intel|x64|x86_64).*\.dmg$/i)
        : null;
  }
  return null;
}

/** A file name safe to put in a path and in a URL. */
export const plainName = (name: string): boolean => /^[A-Za-z0-9][A-Za-z0-9._-]{0,150}$/.test(name);

/** The `<hex>  <name>` lines of a SHA256SUMS file (also `<hex> *<name>`); other lines are ignored. */
export function parseSha256Sums(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const match = /^([0-9a-fA-F]{64}) [ *]?(.+?)\s*$/.exec(line);
    if (match) out.set(match[2]!, match[1]!.toLowerCase());
  }
  return out;
}

/** What the person agrees to before the releases page is asked: the host and nothing to fetch. */
export const UPDATE_CHECK_CONSENT: AiConsent = {
  host: 'api.github.com',
  files: [],
  totalBytes: 0,
};

/** What the person agrees to before the installer is fetched: the host, the file and the size. */
export function installerConsent(asset: ReleaseAsset): AiConsent {
  return { host: 'github.com', files: [asset.name], totalBytes: asset.size };
}

export function sameConsent(a: AiConsent, b: AiConsent): boolean {
  return (
    a.host === b.host &&
    a.totalBytes === b.totalBytes &&
    a.files.length === b.files.length &&
    b.files.every((name, i) => a.files[i] === name)
  );
}

/** Release notes as plain text a window can show: no control characters, cut to a readable length. */
export function plainNotes(body: string | null | undefined, max = 4000): string {
  const text = (body ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/\r\n?/g, '\n')
    .trim();
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}
