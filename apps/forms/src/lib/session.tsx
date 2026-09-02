import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { api } from '@tp/shared';
import { DEFAULT_FALLBACKS, resolveLocale, type LocaleConfig } from '@tp/i18n';
import { client, restoreSession, setSession } from './api.js';

interface SessionValue {
  user: api.SessionUser | null;
  organisation: api.OrganisationSummary | null;
  /** Locale the UI is rendering in. Persisted per browser, seeded from the browser language. */
  locale: string;
  setLocale: (locale: string) => void;
  locales: LocaleConfig;
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

  // Never render in a locale the organisation does not publish.
  const resolved = resolveLocale(locales, locale);

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
      loading,
      signInWithToken,
      signOut,
    }),
    [user, organisation, resolved, setLocale, locales, loading, signInWithToken, signOut],
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
