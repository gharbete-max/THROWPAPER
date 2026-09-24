import { useEffect, useState } from 'react';
import type { Translator } from '@tp/i18n';
import { tokenFromPath } from './api.js';
import { SignPage } from './SignPage.js';

interface Health {
  status: string;
  service: string;
  contractVersion: number;
}

/** A signing link opens the signing page; anything else is the product's front door. */
export function App({ t }: { t: Translator }) {
  const token = tokenFromPath(window.location.pathname);
  if (token) return <SignPage token={token} fallback={t} />;
  return <Home t={t} />;
}

function Home({ t }: { t: Translator }) {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch('/api/health')
      .then((response) => response.json() as Promise<Health>)
      .then(setHealth)
      .catch(() => setError(true));
  }, []);

  return (
    <main className="shell">
      <h1>{t('title')}</h1>
      <p className="muted">{t('scaffold')}</p>
      <section className="card">
        <strong>{t('backend')}</strong>
        <p>
          {error ? (
            <span className="status-down">{t('unreachable')}</span>
          ) : health ? (
            <span className="status-up">
              {health.service} · {health.status} · contract v{health.contractVersion}
            </span>
          ) : (
            <span className="muted">{t('checking')}</span>
          )}
        </p>
      </section>
    </main>
  );
}
