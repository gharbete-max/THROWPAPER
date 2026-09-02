import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { api } from '@tp/shared';
import { DEFAULT_FALLBACKS, resolveLocale, type LocaleConfig } from '@tp/i18n';
import { TRANSLATED_LOCALES } from './messages/index.js';
import { client, restoreSession, setSession } from './api.js';

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
  loading: boolean;
  signInWithToken: (token: string) => Promise<void>;
  signOut: () => Promise<void>;
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
