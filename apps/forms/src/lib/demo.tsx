import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { client } from './api.js';
import { useT } from './i18n.js';

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
}

const DemoContext = createContext<DemoValue>({ isDemo: false, users: [], formSlug: null });

export function DemoProvider({ children }: { children: ReactNode }) {
  const [value, setValue] = useState<DemoValue>({ isDemo: false, users: [], formSlug: null });

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

  return <DemoContext.Provider value={value}>{children}</DemoContext.Provider>;
}

export function useDemo(): DemoValue {
  return useContext(DemoContext);
}

export function DemoBanner() {
  const t = useT();
  const { isDemo } = useDemo();
  const [resetting, setResetting] = useState(false);

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
