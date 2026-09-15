/**
 * The parts of the site's locale handling that need the shared catalogue.
 *
 * ## Why this is not in `locale.ts`
 *
 * Not taste. `vite.config.ts` imports `SERVER_RENDERED_PATHS` from `routes.ts`, which imports
 * `locale.ts` — and Vite loads its own config **outside** the TypeScript pipeline, with Node's
 * resolver. The workspace packages are published as raw `.ts` whose internal specifiers are written
 * `./locale.js`, which only resolves once a bundler is doing the work. So anything reachable from
 * `vite.config.ts` that touches `@tp/i18n` fails the build with `ERR_MODULE_NOT_FOUND` on a file
 * that is right there on disk under a different extension.
 *
 * `vite.config.ts` already carries the same warning about `@tp/tokens`, and solves it the same way
 * — by reading the JSON directly rather than importing the package. This module is that rule
 * applied to the site's routes: the locale *data* the router needs has no dependencies, and the
 * two helpers that need the catalogue live here, where only the app and its tests reach them.
 *
 * If these are ever merged back into `locale.ts`, the build breaks and the error names neither
 * file.
 */
import { LOCALE_CODES, localeInfo } from '@tp/i18n';
import { SITE_LOCALES } from './locale.js';

/** What to show a reader for a locale, in that locale. Endonyms — see `locales.ts`. */
export function siteLocaleLabel(locale: string): string {
  return localeInfo(locale)?.endonym ?? locale;
}

/**
 * The locales the product has but the site has not been translated into yet.
 *
 * Exported so a test can report the gap as a number rather than leaving it to be noticed, and so
 * the gap shrinks visibly as columns are filled rather than silently.
 */
export const SITE_LOCALES_PENDING: readonly string[] = LOCALE_CODES.filter(
  (code) => !SITE_LOCALES.includes(code),
);
