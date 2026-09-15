/**
 * Which languages the public site is published in, and how a URL says so.
 *
 * ## Why the site declares its own list rather than reusing the product's twelve
 *
 * The product ships in twelve languages. The site does not yet, and pretending otherwise is the
 * exact thing this product refuses to let its customers do: *"A form that claims two languages and
 * has one is not ready"* — `completeness.ts` blocks publishing over it, and the landing page sells
 * that refusal as a feature. A marketing site that claimed twelve and delivered five good ones and
 * seven guesses would be the product breaking its own rule on its own front page.
 *
 * So `SITE_LOCALES` is the list the site is **complete** in, and it is allowed to be shorter than
 * `LOCALE_CODES`. Growing it is adding a column to `SITE_COPY`; `content.test.ts` fails until that
 * column is whole, which is the same shape of guarantee the invoice and admission copy already
 * have. Nothing here half-translates a page, and no page mixes two languages.
 *
 * ## Why the locale is in the path and not in a cookie
 *
 * A cookie would be the easy answer and it is not available. This app sets **no cookies at all** —
 * that is a recorded position, it is why no consent banner is required as the software stands, and
 * spending it on a language preference would be a poor trade for something a URL does better.
 *
 * A path also gives each language a real address. `Accept-Language` alone serves twelve languages
 * from one URL, which a crawler reads as one page that keeps changing, and which nobody can link
 * to. `/de/features/events` is a page: it can be shared, indexed, and carry its own `hreflang`.
 *
 * English is unprefixed rather than living at `/en/`. It is the default, `/` must resolve to
 * something, and a redirect from `/` to `/en/` is a hop every visitor pays for the benefit of
 * symmetry nobody sees.
 */
/*
 * Deliberately importing nothing.
 *
 * `vite.config.ts` reaches this module through `routes.ts`, and loads it with Node's resolver
 * rather than through Vite — where a workspace package written in TypeScript cannot be resolved.
 * The two helpers that need `@tp/i18n` are in `locale-labels.ts`, which explains the whole trap.
 */

/**
 * The languages the site is complete in, in the order the picker lists them.
 *
 * English first because it is the fallback; the rest follow `LOCALES`. Adding one here without
 * translating every key is a failing test rather than a half-English page.
 */
export const SITE_LOCALES: readonly string[] = ['en-GB', 'sv-SE', 'da-DK', 'nb-NO', 'de-DE'];

/** What an unprefixed path is written in. */
export const SITE_DEFAULT_LOCALE = 'en-GB';

/**
 * The URL segment for a locale: the language subtag, not the full code.
 *
 * `/sv/` rather than `/sv-SE/`. The region is meaningful to the catalogue — `en-GB` and `en-US`
 * differ in more than spelling — and meaningless in a path where exactly one region per language
 * is published. Should that ever stop being true, this is the one function that decides it.
 */
export function segmentFor(locale: string): string {
  return locale.split('-')[0]!;
}

const BY_SEGMENT = new Map(
  SITE_LOCALES.filter((locale) => locale !== SITE_DEFAULT_LOCALE).map((locale) => [
    segmentFor(locale),
    locale,
  ]),
);

export interface SplitPath {
  /** The locale the URL asks for, already checked against `SITE_LOCALES`. */
  locale: string;
  /** The path with the locale segment removed, always starting with `/`. */
  path: string;
}

/**
 * Split `/de/features/events` into the locale and the page.
 *
 * An unknown segment is *not* a locale. `/pricing` must stay the page `/pricing` rather than
 * becoming the locale `pricing` and the page `/`, and `/es/` is a 404 until Spanish is finished
 * rather than an English page wearing a Spanish address — which would be the one URL a search
 * engine indexes as Spanish.
 */
export function splitLocale(pathname: string): SplitPath {
  const match = /^\/([a-z]{2})(\/.*)?$/.exec(pathname);
  const locale = match ? BY_SEGMENT.get(match[1]!) : undefined;
  if (!match || !locale) return { locale: SITE_DEFAULT_LOCALE, path: pathname };
  return { locale, path: match[2] ?? '/' };
}

/**
 * The address of `path` in `locale` — the inverse of `splitLocale`.
 *
 * Every link on the site goes through this, which is what keeps a visitor inside the language they
 * chose. A hand-written `/features/forms` in the markup is a silent trapdoor back to English, and
 * it is the failure this function exists to make impossible to write by accident.
 */
export function localePath(locale: string, path = '/'): string {
  const rest = path === '/' ? '' : path;
  if (locale === SITE_DEFAULT_LOCALE) return rest || '/';
  return `/${segmentFor(locale)}${rest}`;
}

/* `siteLocaleLabel` and `SITE_LOCALES_PENDING` are in `locale-labels.ts`; see the note above. */
