import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BRAND_ASSET,
  IMMUTABLE,
  REVALIDATE,
  cacheControlFor,
  cacheControlForFile,
} from './cache-headers.js';

/**
 * The rule underneath all of this: a name containing a hash of the contents can be kept forever,
 * because it cannot change without becoming a different name. A fixed name cannot, because it is
 * how a new build announces itself.
 */
describe('files Vite hashes', () => {
  it.each([
    '/assets/index-3D1EhZ5u.js',
    '/assets/index-CxMXy9wW.css',
    '/assets/CheckIn-CqUxmhXW.js',
    '/assets/inter-latin-400-normal-C38fXH4l.woff2',
    // Hashed like a bundle, but emitted at the root rather than under `assets/`.
    '/workbox-9c191d2f.js',
  ])('keeps %s for a year', (path) => {
    expect(cacheControlFor(path)).toBe(IMMUTABLE);
  });
});

describe('files whose names never change', () => {
  /**
   * `sw.js` is the one that would hurt.
   *
   * The worker is registered with `autoUpdate` and `skipWaiting` precisely so a door screen cannot
   * be left on a stale bundle during an event. A cached service worker is a door screen that
   * cannot be updated at all — the failure the Vite config went out of its way to avoid,
   * reintroduced from the other end.
   */
  it.each(['/sw.js', '/registerSW.js', '/index.html', '/manifest.webmanifest'])(
    'revalidates %s every time',
    (path) => {
      expect(cacheControlFor(path)).toBe(REVALIDATE);
    },
  );

  it('revalidates a path it has no rule for', () => {
    expect(cacheControlFor('/something-new')).toBe(REVALIDATE);
  });
});

/**
 * The mark and the icons are referenced by name from the manifest and the shell, so they cannot be
 * renamed per build — which rules out `immutable`, because a new mark would never reach anybody
 * holding a cached one.
 */
describe('brand files at the root', () => {
  it.each(['/mark-loop-256.webp', '/mark-angled-256.png', '/icon-512.png', '/favicon.svg'])(
    'keeps %s for a day',
    (path) => {
      expect(cacheControlFor(path)).toBe(BRAND_ASSET);
    },
  );

  /**
   * A hashed image is still hashed. `assets/` is checked first, so an image emitted by the build
   * keeps the year rather than dropping to a day.
   */
  it('does not demote a hashed image to the brand policy', () => {
    expect(cacheControlFor('/assets/hero-D34DB33F.webp')).toBe(IMMUTABLE);
  });
});

/**
 * `fastify-static` hands its callback an absolute filesystem path, and the development machine for
 * this project is Windows — where `relative()` returns `assets\index-3D1EhZ5u.js` and a rule
 * written against `/assets/` matches none of it.
 */
describe('from a filesystem path', () => {
  const root = join('/srv', 'app', 'dist');

  it('resolves a hashed bundle', () => {
    expect(cacheControlForFile(root, join(root, 'assets', 'index-3D1EhZ5u.js'))).toBe(IMMUTABLE);
  });

  it('resolves the shell', () => {
    expect(cacheControlForFile(root, join(root, 'index.html'))).toBe(REVALIDATE);
  });

  it('resolves a brand file at the root', () => {
    expect(cacheControlForFile(root, join(root, 'mark-loop-256.webp'))).toBe(BRAND_ASSET);
  });

  /**
   * The Windows separator is handled in the module and deliberately not asserted here.
   *
   * `node:path` resolves to the host platform, so `relative()` in this process is the POSIX one no
   * matter what strings it is handed — a test passing `C:\app\dist` would exercise POSIX
   * `relative` on a string containing backslashes, which is neither platform's behaviour and would
   * pass or fail for reasons unrelated to the code. The normalisation it would be claiming to
   * cover is one `split('\\').join('/')`, and the real check is CI on a Windows runner.
   */
  it('resolves a bundle in a nested directory', () => {
    expect(cacheControlForFile(root, join(root, 'assets', 'chunks', 'App-Bm9Vs2yt.js'))).toBe(
      IMMUTABLE,
    );
  });
});
