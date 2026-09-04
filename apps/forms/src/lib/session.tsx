import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { api } from '@tp/shared';
import { DEFAULT_FALLBACKS, resolveLocale, type LocaleConfig } from '@tp/i18n';
import { TRANSLATED_LOCALES, loadCatalogue } from './messages/index.js';
import { client, restoreSession, setSession } from './api.js';
import { syncDocumentLanguage } from './theme.js';

interface SessionValue {
  user: api.SessionUser | null;
  organisation: api.OrganisationSummary | null;
  /** Locale the UI is rendering in. Persisted per browser, seeded from the browser language. */
  locale: string;
  setLocale: (locale: string) => void;
  /**
   * The languages the organisation publishes **content** in — form labels, event names.
   *
   * Drives the builder's translation tabs and the completeness check that blocks publishing a
   * half-translated form.
   */
  locales: LocaleConfig;
  /**
   * The languages the **interface** is available in, which is a different list.
   *
   * Conflating the two was a real bug. Seeding the demo organisation with all twelve made every
   * seeded event show "missing translation" for ten languages nobody had written — correct, but
   * only because the org was claiming to publish in languages it had no content for. Narrowing
   * the organisation instead took Japanese out of the *interface* picker, which has nothing to do
   * with it: what somebody reads the buttons in is their own business, and the app is translated
   * into twelve regardless of what any one customer publishes.
   *
   * So: this is the app's own list, and `locales` above stays the organisation's.
   */
  interfaceLocales: LocaleConfig;
  /**
   * The language to **author content in**, which is neither of the above on its own.
   *
   * `locale` is what the operator reads the buttons in, and since the interface list was split
   * from the organisation's it can be any of the twelve the app speaks. Writing content in it is
   * a different question with a different answer: a German-reading operator at a Swedish
   * association who adds a field would otherwise seed its label in `de-DE` — a language the
   * organisation does not publish, so the translation editor never shows the box (it lists the
   * organisation's locales), the completeness report never counts it, and a respondent gets the
   * German text through `pickText`'s last-ditch "any content at all" branch.
   *
   * So: the interface language when the organisation actually publishes in it, and the
   * organisation's own default otherwise.
   */
  contentLocale: string;
  loading: boolean;
  signInWithToken: (token: string) => Promise<void>;
  signOut: () => Promise<void>;
}

/**
 * The language to write form content in, given the one being read and what the organisation
 * publishes.
 *
 * A pure function so the rule has somewhere to be tested. The interface language when the
 * organisation actually publishes in it — an operator working in Swedish at a Swedish
 * organisation writes Swedish — and the organisation's own default otherwise.
 */
export function authoringLocale(interfaceLocale: string, organisation: LocaleConfig): string {
  return organisation.supported.includes(interfaceLocale) ? interfaceLocale : organisation.default;
}

const SessionContext = createContext<SessionValue | null>(null);
const LOCALE_KEY = 'tp.locale';

const FALLBACK_LOCALES: LocaleConfig = { supported: ['sv-SE', 'en-GB'], default: 'sv-SE' };

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<api.SessionUser | null>(null);
  const [organisation, setOrganisation] = useState<api.OrganisationSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [locale, setLocaleState] = useState<string>(() => readStoredLocale() ?? navigator.language);

  useEffect(() => {
    let cancelled = false;
    restoreSession()
      .then((me) => {
        if (cancelled || !me) return;
        setUser(me.user);
        setOrganisation(me.organisation);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const locales: LocaleConfig = useMemo(
    () =>
      organisation
        ? {
            supported: organisation.supportedLocales,
            default: organisation.defaultLocale,
            // Nordic readers meeting an untranslated string are better served by a neighbouring
            // language than by dropping straight to English — see DEFAULT_FALLBACKS.
            fallbacks: DEFAULT_FALLBACKS,
          }
        : FALLBACK_LOCALES,
    [organisation],
  );

  /**
   * What the interface renders in.
   *
   * The organisation's default is honoured when the app speaks it, so a Swedish customer's
   * operators land in Swedish; otherwise English, which is the one language always loaded.
   */
  const interfaceLocales: LocaleConfig = useMemo(
    () => ({
      supported: TRANSLATED_LOCALES,
      default: TRANSLATED_LOCALES.includes(organisation?.defaultLocale ?? '')
        ? (organisation?.defaultLocale ?? 'en-GB')
        : 'en-GB',
      fallbacks: DEFAULT_FALLBACKS,
    }),
    [organisation],
  );

  // Never render in a language the app has not been translated into.
  const resolved = resolveLocale(interfaceLocales, locale);

  // Never author content in a language the organisation does not publish. See `contentLocale`.
  const contentLocale = authoringLocale(resolved, locales);

  /**
   * Fetch the authoring language's catalogue, even when nothing is rendering in it.
   *
   * The builder seeds a new field's label from the message catalogue — "New question", "Option
   * 1" — in `contentLocale`. That is not necessarily the language on screen, and the catalogues
   * are downloaded on demand, so an operator reading the app in English at a Swedish
   * organisation would find `sv-SE` simply absent and the field created with `label: {}`: the
   * "missing in every locale" state the seeding exists to prevent. Asking for it here is one
   * line and closes the window before anybody can click.
   */
  useEffect(() => {
    void loadCatalogue(contentLocale);
  }, [contentLocale]);

  /**
   * The document's own language follows the one being read.
   *
   * `resolved` rather than `locale`: what matters is the language actually on screen after the
   * fallback chain has had its say, which is what a screen reader is about to pronounce.
   */
  useEffect(() => {
    syncDocumentLanguage(resolved);
  }, [resolved]);

  const setLocale = useCallback((next: string) => {
    setLocaleState(next);
    try {
      localStorage.setItem(LOCALE_KEY, next);
    } catch {
      /* storage disabled — the choice lasts for this tab only */
    }
  }, []);

  const signInWithToken = useCallback(async (token: string) => {
    const pair = await client.exchange(token);
    setSession(pair);
    setUser(pair.user);
    setOrganisation(pair.organisation);
  }, []);

  const signOut = useCallback(async () => {
    await client.logout();
    setUser(null);
    setOrganisation(null);
  }, []);

  const value = useMemo(
    () => ({
      user,
      organisation,
      locale: resolved,
      setLocale,
      locales,
      interfaceLocales,
      contentLocale,
      loading,
      signInWithToken,
      signOut,
    }),
    [
      user,
      organisation,
      resolved,
      setLocale,
      locales,
      interfaceLocales,
      contentLocale,
      loading,
      signInWithToken,
      signOut,
    ],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside a SessionProvider');
  return value;
}

function readStoredLocale(): string | null {
  try {
    return localStorage.getItem(LOCALE_KEY);
  } catch {
    return null;
  }
}
