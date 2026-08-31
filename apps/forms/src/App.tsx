import { useEffect, useState } from 'react';
import { cn } from '@tp/ui';
import { resolveLocale, type LocaleConfig } from '@tp/i18n';

const localeConfig: LocaleConfig = { supported: ['sv-SE', 'en-GB'], default: 'sv-SE' };

interface Health {
  status: string;
  service: string;
  contractVersion: number;
  database: 'up' | 'down';
}

export function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);
  const locale = resolveLocale(localeConfig, navigator.language);

  useEffect(() => {
    fetch('/api/health')
      .then((response) => response.json() as Promise<Health>)
      .then(setHealth)
      .catch((cause: unknown) => setError(String(cause)));
  }, []);

  return (
    <main className="shell">
      <h1>Formwork</h1>
      <p className="muted">
        Phase 0 skeleton. Next: <code>docs/START-HERE.md</code> phase 1 — tokens across web, PDF and
        email.
      </p>

      <section className="card">
        <strong>Backend</strong>
        <p>
          {error ? (
            <span className="status-down">api-forms unreachable — is it running on :4001?</span>
          ) : health ? (
            <span className={cn(health.database === 'up' ? 'status-up' : 'status-down')}>
              {health.service} · {health.status} · database {health.database} · contract v
              {health.contractVersion}
            </span>
          ) : (
            <span className="muted">checking…</span>
          )}
        </p>
      </section>

      <section className="card">
        <strong>Locale</strong>
        <p className="muted">
          Browser asked for {navigator.language}; resolved to {locale}.
        </p>
      </section>
    </main>
  );
}
