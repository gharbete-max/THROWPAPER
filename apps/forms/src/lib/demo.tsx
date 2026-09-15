import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { resolveLocale } from '@tp/i18n';
import { client } from './api.js';
import { useTranslator } from './i18n.js';
import { useSession } from './session.js';
import { syncDocumentLanguage } from './theme.js';

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
 * Tells the banner **and the document** which language the screen is being read in.
 *
 * Only screens that do not follow the session's locale need this; everything else can ignore it.
 *
 * ## Why `<html lang>` belongs here and not in the screen
 *
 * `SessionProvider` sets the document language from the *interface* locale, which is right for
 * every screen that follows it and wrong for the one that does not. A public form carries its own
 * locale by design — the respondent's language has nothing to do with whoever built the form — so
 * the two disagree, and nothing was reconciling them: an English form was served with
 * `lang="ru-RU"` because a previous session on that browser had left Russian in `localStorage`.
 * A screen reader then pronounces English words with Russian phonetics, which is closer to
 * unusable than to wrong.
 *
 * That is the same defect this hook already exists to fix for the banner, one layer down, so it
 * is fixed in the same place rather than in a second `syncDocumentLanguage` call inside
 * `PublicForm` that would race the session's effect and win or lose by mount order.
 *
 * The previous value is captured and restored on unmount. The session's effect keys on its own
 * `resolved`, which has not changed while somebody was filling in a form, so it will not fire
 * again to correct the attribute — leaving the form would otherwise strand the whole app in the
 * respondent's language.
 */
export function useAnnounceLocale(locale: string): void {
  const { announce } = useContext(DemoContext);
  useEffect(() => {
    announce(locale);

    const previous = document.documentElement.lang;
    syncDocumentLanguage(locale);

    return () => {
      announce(null);
      syncDocumentLanguage(previous);
    };
  }, [announce, locale]);
}

export function DemoBanner() {
  const { interfaceLocales, locale } = useSession();
  const { isDemo, announcedLocale } = useDemo();
  const [resetting, setResetting] = useState(false);

  /**
   * A Swedish banner over an English form is the one page the public sees getting it wrong — and
   * a Swedish banner over a Japanese interface is the same mistake indoors.
   *
   * Resolved against the **interface** languages rather than the organisation's content ones.
   * Against the organisation's, choosing Japanese in the top bar left this banner in Swedish,
   * because a demo organisation publishing forms in two languages says nothing about which
   * language the person reading the screen asked for.
   *
   * `announcedLocale` still wins where a public form has set one: there the banner sits above
   * somebody else's document and should match it.
   */
  const t = useTranslator(
    interfaceLocales,
    resolveLocale(interfaceLocales, announcedLocale ?? locale),
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
