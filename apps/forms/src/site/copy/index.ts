import type { SiteCopy } from '../content.js';
import { SITE_DEFAULT_LOCALE } from '../locale.js';
import { enGB } from './en-GB.js';
import { svSE } from './sv-SE.js';
import { daDK } from './da-DK.js';
import { nbNO } from './nb-NO.js';
import { deDE } from './de-DE.js';

/**
 * Every language the site is published in, by locale code.
 *
 * Two lists that must agree — this and `SITE_LOCALES` — with `content.test.ts` comparing them, the
 * same arrangement `INVOICE_COPY` has with the product's locale list and for the same reason: the
 * admission card once shipped in two of twelve languages and nothing noticed until a test counted
 * them.
 */
export const SITE_COPY: Record<string, SiteCopy> = {
  'en-GB': enGB,
  'sv-SE': svSE,
  'da-DK': daDK,
  'nb-NO': nbNO,
  'de-DE': deDE,
};

/**
 * The words for a locale, falling back to English.
 *
 * The fallback is a backstop for a caller that invented a locale, not a strategy. Nothing reaches
 * it in normal operation: `splitLocale` only returns a locale that is in `SITE_LOCALES`, and the
 * test makes `SITE_LOCALES` and `SITE_COPY` agree. It exists so that a mistake shows up as an
 * English page rather than as a crash on the public site.
 */
export function copyFor(locale: string): SiteCopy {
  return SITE_COPY[locale] ?? SITE_COPY[SITE_DEFAULT_LOCALE]!;
}
