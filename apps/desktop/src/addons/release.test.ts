import { describe, expect, it } from 'vitest';
import {
  UPDATE_CHECK_CONSENT,
  UPDATE_HOSTS,
  chooseInstaller,
  compareVersions,
  installerConsent,
  isUpdateHost,
  newestDesktop,
  parseReleases,
  parseSha256Sums,
  parseVersion,
  plainNotes,
  releaseFileUrl,
  sameConsent,
  versionOfTag,
  type Release,
  type ReleaseAsset,
} from './release.js';
import { isAllowedHost, isRuntimeHost } from '@tp/shared/ai';

const asset = (name: string, size = 180_000_000, digest?: string): ReleaseAsset => ({
  name,
  size,
  ...(digest ? { digest } : {}),
});
const RELEASE_ASSETS = [
  asset('Loppa-macOS-AppleSilicon.dmg'),
  asset('Loppa-macOS-Intel.dmg'),
  asset('Loppa-Windows-Portable.exe'),
  asset('Loppa-Windows-Setup.exe'),
  asset('SHA256SUMS.txt', 366),
];
const release = (tag: string, extra: Partial<Release> = {}): Release => ({
  tag_name: tag,
  assets: RELEASE_ASSETS,
  ...extra,
});

describe('versions', () => {
  it('compares numbers as numbers, not as text', () => {
    expect(compareVersions('0.10.0', '0.9.0')).toBe(1);
    expect(compareVersions('0.2.0', '0.2.0')).toBe(0);
    expect(compareVersions('1.0.0', '0.99.99')).toBe(1);
    expect(compareVersions('0.2.1', '0.2.10')).toBe(-1);
    expect(compareVersions('v0.3.0', '0.2.9')).toBe(1);
  });

  it('puts a pre-release below its own release, and orders pre-releases', () => {
    expect(compareVersions('1.0.0-rc.1', '1.0.0')).toBe(-1);
    expect(compareVersions('1.0.0', '1.0.0-rc.1')).toBe(1);
    expect(compareVersions('1.0.0-rc.2', '1.0.0-rc.10')).toBe(-1);
    expect(compareVersions('1.0.0-alpha', '1.0.0-1')).toBe(1);
    expect(compareVersions('1.0.0-rc', '1.0.0-rc.1')).toBe(-1);
    expect(compareVersions('1.0.0+build5', '1.0.0')).toBe(0);
  });

  it('reads only well-formed versions', () => {
    expect(parseVersion('0.2.0')).not.toBeNull();
    for (const bad of [
      '',
      '1',
      '1.2',
      '1.2.3.4',
      'latest',
      '1.2.x',
      '１.2.3',
      '1.2.3-',
      '../1.2.3',
    ]) {
      expect(parseVersion(bad)).toBeNull();
    }
    expect(() => compareVersions('abc', '1.0.0')).toThrow();
  });

  it('takes the version from a desktop tag and refuses any other tag', () => {
    expect(versionOfTag('desktop-v0.2.0')).toBe('0.2.0');
    expect(versionOfTag('desktop-v1.0.0-rc.1')).toBe('1.0.0-rc.1');
    expect(versionOfTag('ai-pack-qwen2.5-vl-7b-instruct-q4_k_m')).toBeNull();
    expect(versionOfTag('v0.2.0')).toBeNull();
    expect(versionOfTag('desktop-vnext')).toBeNull();
  });
});

describe('newestDesktop', () => {
  it('ignores the AI pack release, drafts and pre-releases, and does not trust the order', () => {
    const found = newestDesktop([
      release('ai-pack-qwen2.5-vl-7b-instruct-q4_k_m'),
      release('desktop-v0.1.2'),
      release('desktop-v0.3.0', { draft: true }),
      release('desktop-v0.4.0-rc.1', { prerelease: true }),
      release('desktop-v0.2.0'),
      release('desktop-v0.10.0'),
      release('desktop-v0.9.0'),
    ]);
    expect(found?.version).toBe('0.10.0');
  });

  it('is null when no desktop release is published', () => {
    expect(newestDesktop([release('ai-pack-x')])).toBeNull();
    expect(newestDesktop([])).toBeNull();
  });
});

describe('parseReleases', () => {
  it('reads the fields it needs and ignores the rest', () => {
    const parsed = parseReleases([
      {
        tag_name: 'desktop-v0.2.0',
        body: 'notes',
        html_url: 'https://github.com/x/y/releases/tag/t',
        assets: [{ name: 'a', size: 1, digest: null, url: 'ignored' }],
        other: 1,
      },
    ]);
    expect(parsed?.[0]?.assets[0]).toMatchObject({ name: 'a', size: 1 });
  });

  it('refuses what is not a list of releases', () => {
    expect(parseReleases({ message: 'rate limit exceeded' })).toBeNull();
    expect(parseReleases([{ tag_name: 7, assets: [] }])).toBeNull();
    expect(parseReleases([{ tag_name: 't', assets: [{ name: 'a', size: -1 }] }])).toBeNull();
    expect(parseReleases('x')).toBeNull();
  });
});

describe('chooseInstaller', () => {
  it.each([
    ['win32', 'x64', false, 'Loppa-Windows-Setup.exe'],
    ['win32', 'x64', true, 'Loppa-Windows-Portable.exe'],
    ['darwin', 'arm64', false, 'Loppa-macOS-AppleSilicon.dmg'],
    ['darwin', 'x64', false, 'Loppa-macOS-Intel.dmg'],
  ])('%s %s portable=%s gets %s', (platform, arch, portable, name) => {
    expect(chooseInstaller(RELEASE_ASSETS, platform, arch, portable)?.name).toBe(name);
  });

  it.each([
    ['win32', 'arm64'],
    ['win32', 'ia32'],
    ['linux', 'x64'],
    ['darwin', 'ppc64'],
    ['freebsd', 'x64'],
  ])('gives nothing for %s %s', (platform, arch) => {
    expect(chooseInstaller(RELEASE_ASSETS, platform, arch)).toBeNull();
  });

  it('never offers a file over 600 MB, an empty one, or a name that is not plain', () => {
    expect(
      chooseInstaller([asset('Loppa-Windows-Setup.exe', 601_000_000)], 'win32', 'x64'),
    ).toBeNull();
    expect(chooseInstaller([asset('Loppa-Windows-Setup.exe', 0)], 'win32', 'x64')).toBeNull();
    expect(chooseInstaller([asset('../Loppa-Windows-Setup.exe')], 'win32', 'x64')).toBeNull();
    expect(chooseInstaller([asset('a b Setup.exe')], 'win32', 'x64')).toBeNull();
    expect(
      chooseInstaller([asset('Loppa-Windows-Setup.exe', 600_000_000)], 'win32', 'x64'),
    ).not.toBeNull();
  });
});

describe('parseSha256Sums', () => {
  const a = 'ddc5461f122641609bc3fc99746409b08826dcd73352acb8f3c1259bcbf61f9b';
  const b = '974d60409d09e10a17845eaadba82573d93607f0f7b23ecf1371540b52607d86';
  it('reads both spellings, either line ending, and upper case', () => {
    const sums = parseSha256Sums(
      `${a}  Loppa-Windows-Portable.exe\r\n${b.toUpperCase()} *Loppa-Windows-Setup.exe\n\nnot a line\n`,
    );
    expect(sums.get('Loppa-Windows-Portable.exe')).toBe(a);
    expect(sums.get('Loppa-Windows-Setup.exe')).toBe(b);
    expect(sums.size).toBe(2);
  });

  it('ignores a short or malformed hash', () => {
    expect(parseSha256Sums('abc  file\n' + `${a.slice(1)}  other\n`).size).toBe(0);
  });
});

describe('the allow-list', () => {
  it('names exactly four hosts', () => {
    expect([...UPDATE_HOSTS].sort()).toEqual([
      'api.github.com',
      'github.com',
      'objects.githubusercontent.com',
      'release-assets.githubusercontent.com',
    ]);
  });

  it.each(UPDATE_HOSTS)('accepts %s (any case)', (host) => {
    expect(isUpdateHost(host)).toBe(true);
    expect(isUpdateHost(host.toUpperCase())).toBe(true);
  });

  it.each([
    'raw.githubusercontent.com',
    'user-images.githubusercontent.com',
    'githubusercontent.com',
    'evil.github.com',
    'github.com.evil.example',
    'api.github.com.evil.example',
    'notgithub.com',
    'huggingface.co',
    'localhost',
    '127.0.0.1',
    '',
  ])('refuses %j', (host) => {
    expect(isUpdateHost(host)).toBe(false);
  });

  it('does not widen the model download list or the runtime list', () => {
    expect(isAllowedHost('github.com')).toBe(false);
    expect(isAllowedHost('release-assets.githubusercontent.com')).toBe(false);
    expect(isRuntimeHost('api.github.com')).toBe(true); // the runtime's own, reviewed list: unchanged
    expect(isRuntimeHost('huggingface.co')).toBe(false);
  });
});

describe('consent shapes', () => {
  it('the update check names the host and fetches no file', () => {
    expect(UPDATE_CHECK_CONSENT).toEqual({ host: 'api.github.com', files: [], totalBytes: 0 });
  });

  it('the installer names github.com, the file and its size, exactly', () => {
    const consent = installerConsent(asset('Loppa-Windows-Setup.exe', 181254896));
    expect(consent).toEqual({
      host: 'github.com',
      files: ['Loppa-Windows-Setup.exe'],
      totalBytes: 181254896,
    });
    expect(sameConsent(consent, { ...consent })).toBe(true);
    expect(sameConsent(consent, { ...consent, totalBytes: consent.totalBytes + 1 })).toBe(false);
    expect(sameConsent(consent, { ...consent, host: 'evil.example' })).toBe(false);
    expect(sameConsent(consent, { ...consent, files: ['other.exe'] })).toBe(false);
    expect(sameConsent(consent, { ...consent, files: [...consent.files, 'extra'] })).toBe(false);
  });

  it('builds the installer address from the tag and the name, and encodes both', () => {
    expect(releaseFileUrl('desktop-v0.2.0', 'SHA256SUMS.txt')).toBe(
      'https://github.com/gharbete-max/THROWPAPER/releases/download/desktop-v0.2.0/SHA256SUMS.txt',
    );
    expect(releaseFileUrl('a/b', '../c')).not.toContain('/../');
  });
});

describe('plainNotes', () => {
  it('keeps text, drops control characters, normalises line ends and cuts long notes', () => {
    expect(plainNotes('Line\r\n\u0000two\u001b[31m')).toBe('Line\ntwo[31m');
    expect(plainNotes(null)).toBe('');
    const cut = plainNotes('x'.repeat(5000), 100);
    expect(cut.length).toBeLessThanOrEqual(101);
    expect(cut.endsWith('…')).toBe(true);
  });
});
