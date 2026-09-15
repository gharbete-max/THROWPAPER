import { describe, expect, it } from 'vitest';
import { LOCALE_CODES } from '@tp/i18n';
import { FEATURE_SLUGS } from './content.js';
import { SITE_COPY, copyFor } from './copy/index.js';
import { SITE_DEFAULT_LOCALE, SITE_LOCALES, localePath, splitLocale } from './locale.js';
import { SITE_LOCALES_PENDING } from './locale-labels.js';
import { SITE_PAGES, SITE_ROUTES, isSiteRoute, isSiteShaped } from './routes.js';

/**
 * The site is complete in every language it claims, and claims only the ones it is complete in.
 *
 * This is the product's own rule turned on its own front page. `completeness.ts` refuses to publish
 * a form that claims two languages and has one, and the landing page sells that refusal as a
 * feature — so a marketing site claiming twelve and delivering five good ones plus seven guesses
 * would be the product breaking its own rule where everybody can see it.
 *
 * Two lists that must agree, with something comparing them: the same arrangement `INVOICE_COPY`
 * has with the product's locale list, and for the reason recorded there — the admission card once
 * shipped in two of twelve languages and nothing noticed until a test counted them.
 */
describe('the site copy', () => {
  it('has a file for every language the site claims', () => {
    expect(Object.keys(SITE_COPY).sort()).toEqual([...SITE_LOCALES].sort());
  });

  it('claims only languages the product itself ships in', () => {
    for (const locale of SITE_LOCALES) {
      expect(LOCALE_CODES, `${locale} is not a product locale`).toContain(locale);
    }
  });

  /**
   * Structure, not prose. TypeScript already makes a missing *field* a compile error; what it
   * cannot see is a field present and empty, which is how a half-finished translation passes a
   * build and reaches a reader as a blank heading.
   */
  it('leaves nothing blank in any language', () => {
    for (const locale of SITE_LOCALES) {
      const copy = SITE_COPY[locale]!;
      const walk = (value: unknown, path: string): void => {
        if (typeof value === 'string') {
          expect(value.trim(), `${locale} ${path} is empty`).not.toBe('');
          return;
        }
        for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
          walk(child, `${path}.${key}`);
        }
      };
      walk(copy, locale);
    }
  });

  it('describes every feature in every language', () => {
    for (const locale of SITE_LOCALES) {
      expect(Object.keys(SITE_COPY[locale]!.features).sort()).toEqual([...FEATURE_SLUGS].sort());
    }
  });

  /**
   * Untranslated English left in a translated file is the failure this catches, and it is the
   * likeliest one: a column filled in a hurry keeps a sentence or two of the source. Comparing
   * against English rather than eyeballing it means the check does not depend on knowing Danish.
   *
   * Product nouns are the honest exception — "Paloppa", "ICU", "CSV", "PDF", "bigint" and
   * "QR-kod" are the same word in every language, and demanding otherwise would be demanding a
   * mistranslation.
   */
  it('does not leave English prose sitting in another language', () => {
    const english = SITE_COPY[SITE_DEFAULT_LOCALE]!;
    const sentences = (copy: unknown, out: string[] = []): string[] => {
      if (typeof copy === 'string') {
        // Long enough to be prose rather than a shared proper noun or a one-word label.
        if (copy.split(' ').length > 6) out.push(copy);
        return out;
      }
      for (const child of Object.values(copy as Record<string, unknown>)) sentences(child, out);
      return out;
    };

    const source = new Set(sentences(english));
    for (const locale of SITE_LOCALES) {
      if (locale === SITE_DEFAULT_LOCALE) continue;
      const shared = sentences(SITE_COPY[locale]!).filter((line) => source.has(line));
      expect(shared, `${locale} still contains English prose`).toEqual([]);
    }
  });

  /** The gap is a number rather than something to be noticed, and it shrinks visibly. */
  it('reports the languages still to be translated', () => {
    expect(SITE_LOCALES_PENDING.length + SITE_LOCALES.length).toBe(LOCALE_CODES.length);
  });
});

describe('locale-prefixed addresses', () => {
  it('leaves English unprefixed and prefixes the rest', () => {
    expect(localePath(SITE_DEFAULT_LOCALE, '/features/forms')).toBe('/features/forms');
    expect(localePath('de-DE', '/features/forms')).toBe('/de/features/forms');
    expect(localePath('de-DE')).toBe('/de');
    expect(localePath(SITE_DEFAULT_LOCALE)).toBe('/');
  });

  it('round-trips every page in every language', () => {
    for (const locale of SITE_LOCALES) {
      for (const page of SITE_PAGES) {
        expect(splitLocale(localePath(locale, page))).toEqual({ locale, path: page });
      }
    }
  });

  /**
   * A two-letter path segment that is not a published language must stay a page.
   *
   * `/es/` is a 404 until Spanish is finished, rather than an English page wearing a Spanish
   * address — which would be the one URL a search engine indexes as Spanish. The same rule is what
   * keeps a future two-letter page slug from being eaten as a locale.
   */
  it('does not mistake an unpublished language for a locale', () => {
    expect(splitLocale('/es/features/forms')).toEqual({
      locale: SITE_DEFAULT_LOCALE,
      path: '/es/features/forms',
    });
    expect(isSiteRoute('/es/features/forms')).toBe(false);
  });

  it('owns every page in every language and nothing else', () => {
    expect(SITE_ROUTES).toHaveLength(SITE_PAGES.length * SITE_LOCALES.length);
    expect(isSiteRoute('/de/features/events')).toBe(true);
    expect(isSiteRoute('/sv/')).toBe(true);
    // The app's, in every language: there is no `/de/login`.
    expect(isSiteRoute('/de/login')).toBe(false);
    expect(isSiteRoute('/login')).toBe(false);
  });

  /**
   * What the site answers for, beyond what it has: a locale prefix or `/features/` can only be
   * the site's, so a wrong one is the site's not-found page rather than the app's sign-in.
   */
  it('claims addresses only it could own, and leaves the app its namespace', () => {
    expect(isSiteShaped('/features/nothing')).toBe(true);
    expect(isSiteShaped('/de/anything')).toBe(true);
    expect(isSiteShaped('/de/login')).toBe(true);
    // A real page is a route, not merely shaped like one.
    expect(isSiteShaped('/de/features/events')).toBe(false);
    // Unprefixed and not under `/features/`: the app's router decides.
    expect(isSiteShaped('/login')).toBe(false);
    expect(isSiteShaped('/events/abc')).toBe(false);
    expect(isSiteShaped('/f/some-form')).toBe(false);
  });

  /** A locale nobody published falls back rather than throwing on the public site. */
  it('falls back to English rather than failing', () => {
    expect(copyFor('xx-XX')).toBe(SITE_COPY[SITE_DEFAULT_LOCALE]);
  });
});
