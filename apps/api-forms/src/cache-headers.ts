/**
 * How long a browser may keep each kind of file the app ships.
 *
 * Every response was going out as `cache-control: public, max-age=0`, which is `fastify-static`'s
 * default and means "ask me again every time". A returning visitor re-requested all 83 hashed
 * bundles on every navigation and got 83 `304 Not Modified` replies — a round trip each, on a
 * connection that may be a venue's wifi, to be told nothing had changed. The bytes were already
 * correct; the conversation was the cost.
 *
 * The split below is the whole idea: a file whose name contains a hash of its contents can never
 * change without changing its name, so it can be kept forever. A file whose name is fixed is the
 * opposite — it is how a new build announces itself, so it must be checked every time.
 */
import { relative } from 'node:path';

/**
 * A year, and `immutable` on top of it.
 *
 * `max-age` alone still lets a browser revalidate on reload; `immutable` is what tells it not to
 * bother. Safe only because Vite puts a content hash in every one of these names — `index` is
 * `index-3D1EhZ5u.js`, and a rebuild that changes a byte changes the name, so nothing can be
 * stale under this policy without also being unreferenced.
 */
export const IMMUTABLE = 'public, max-age=31536000, immutable';

/**
 * Checked on every request, kept if unchanged.
 *
 * `no-cache` is the confusing one: it does not mean "do not store", it means "do not serve from
 * store without asking". The file is still cached and an `ETag` still turns an unchanged file into
 * a 304 — what it rules out is serving a stale copy silently.
 *
 * This is the correct policy for exactly the files whose names never change, and getting it wrong
 * on `sw.js` is the expensive version of that mistake: the service worker is registered with
 * `autoUpdate` and `skipWaiting` because — in the words of the Vite config — "a door screen
 * serving a stale bundle during an event is a worse failure than a reload". A cached service
 * worker is a door screen that cannot be updated at all.
 */
export const REVALIDATE = 'no-cache';

/**
 * A day, for the brand files that sit at the root without a hash.
 *
 * The mark, the icons and the favicon are referenced by name from the manifest and the shell, so
 * they cannot be renamed per build the way a bundle can — which rules out `immutable`, because a
 * new mark would never reach anybody holding a cached one. A day is long enough that the 505 KB
 * hero loop is fetched once rather than once per visit, and short enough that a rebrand takes a
 * day to propagate rather than a year.
 */
export const BRAND_ASSET = 'public, max-age=86400';

/** Vite's own output directory. Everything in it carries a content hash — see `IMMUTABLE`. */
const HASHED_DIRECTORY = '/assets/';

/**
 * The generated Workbox runtime, which carries a hash in its name the way a bundle does but sits
 * at the root rather than under `assets/`.
 */
const HASHED_AT_ROOT = /^\/workbox-[A-Za-z0-9]+\.js$/;

/** Unhashed brand files. Matched on extension because the mark's names change with the artwork. */
const BRAND_FILE = /\.(png|webp|svg|ico|jpg|jpeg|avif)$/i;

/**
 * The policy for one URL path.
 *
 * Takes the path rather than the file, so it can be reasoned about — and tested — without a disk.
 */
export function cacheControlFor(pathname: string): string {
  if (pathname.startsWith(HASHED_DIRECTORY)) return IMMUTABLE;
  if (HASHED_AT_ROOT.test(pathname)) return IMMUTABLE;
  /*
   * Before the extension check, deliberately. `favicon.svg` and the icons are brand files, but
   * `sw.js` and `registerSW.js` are not, and neither is `index.html` — and an unhashed name is the
   * default case here rather than the exception.
   */
  if (BRAND_FILE.test(pathname)) return BRAND_ASSET;
  return REVALIDATE;
}

/**
 * The same decision, from the absolute path `fastify-static` hands its `setHeaders` callback.
 *
 * Separated from `cacheControlFor` because the conversion is where this can go wrong and nowhere
 * else: the development machine for this project is Windows, where `relative()` returns
 * `assets\index-3D1EhZ5u.js` and a rule written against `/assets/` matches none of it. Normalising
 * the separator here means the policy above never has to know which platform it is running on.
 */
export function cacheControlForFile(root: string, filePath: string): string {
  const withinRoot = relative(root, filePath).split('\\').join('/');
  return cacheControlFor(`/${withinRoot}`);
}
