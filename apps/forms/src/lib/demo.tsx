import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { createTranslator, resolveLocale } from '@tp/i18n';
import { client } from './api.js';
import { messages } from './messages.js';
import { useSession } from './session.js';

/**
 * Whether this server is a demo, and the banner that says so.
 *
 * The app asks the API rather than reading a build-time flag: the same bundle is served by a demo
 * and by a real deployment, and only the server knows which it is. A demo that does not announce
 * itself is how somebody ends up believing their registrations were saved.
 */
interface DemoValue {
  isDemo: boolean;
  users: Array<{ email: string; role: string }>;
  formSlug: string | null;
  /**
   * The locale of whatever is on screen, when that is not the session's.
   *
   * The public form carries its own language — a visitor switching to English must not flip a
   * signed-in operator's whole admin UI. But the banner is rendered *above* the router, so it
   * cannot read that state through context in the normal direction. The screen announces upward
   * instead, and `null` means "the session's locale is the right one".
   */
  announcedLocale: string | null;
}

interface DemoInternal extends DemoValue {
  announce: (locale: string | null) => void;
}

const DemoContext = createContext<DemoInternal>({
  isDemo: false,
  users: [],
  formSlug: null,
  announcedLocale: null,
  announce: () => {},
});

export function DemoProvider({ children }: { children: ReactNode }) {
  const [value, setValue] = useState<Omit<DemoValue, 'announcedLocale'>>({
    isDemo: false,
    users: [],
    formSlug: null,
  });
  const [announcedLocale, setAnnouncedLocale] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    client
      .health()
      .then(async (health) => {
        if (cancelled || health.mode !== 'demo') return;
        const info = await client.demoInfo().catch(() => null);
        if (cancelled) return;
        setValue({
          isDemo: true,
          users: info?.users ?? [],
          formSlug: info?.formSlug ?? null,
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const context = useMemo<DemoInternal>(
    () => ({ ...value, announcedLocale, announce: setAnnouncedLocale }),
    [value, announcedLocale],
  );

  return <DemoContext.Provider value={context}>{children}</DemoContext.Provider>;
}

export function useDemo(): DemoValue {
  return useContext(DemoContext);
}

/**
 * Tells the banner which language the screen is being read in, for as long as it is mounted.
 *
 * Only screens that do not follow the session's locale need this; everything else can ignore it.
 */
export function useAnnounceLocale(locale: string): void {
  const { announce } = useContext(DemoContext);
  useEffect(() => {
    announce(locale);
    return () => announce(null);
  }, [announce, locale]);
}

export function DemoBanner() {
  const { locales, locale } = useSession();
  const { isDemo, announcedLocale } = useDemo();
  const [resetting, setResetting] = useState(false);

  // A Swedish banner over an English form is the one page the public sees getting it wrong.
  const t = useMemo(
    () => createTranslator(locales, messages, resolveLocale(locales, announcedLocale ?? locale)),
    [locales, announcedLocale, locale],
  );

  if (!isDemo) return null;

  return (
    <div className="demo-banner" role="status">
      <span>{t('demo.banner')}</span>
      <button
        type="button"
        className="demo-banner__action"
        disabled={resetting}
        onClick={() => {
          setResetting(true);
          client
            .demoReset()
            .then(() => window.location.reload())
            .catch(() => setResetting(false));
        }}
      >
        {t('demo.reset')}
      </button>
    </div>
  );
}
