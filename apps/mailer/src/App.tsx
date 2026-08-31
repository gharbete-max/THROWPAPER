import { useEffect, useState } from 'react';
import { cn } from '@tp/ui';

interface Health {
  status: string;
  service: string;
  contractVersion: number;
}

export function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/health')
      .then((response) => response.json() as Promise<Health>)
      .then(setHealth)
      .catch((cause: unknown) => setError(String(cause)));
  }, []);

  return (
    <main className="shell">
      <h1>Sendwork</h1>
      <p className="muted">
        Scaffold only. v0.1 ships a thin transactional sending path inside Formwork; Sendwork
        becomes a real product later — <code>docs/START-HERE.md</code> §About the parallel tracks.
      </p>

      <section className="card">
        <strong>Backend</strong>
        <p>
          {error ? (
            <span className="status-down">api-mailer unreachable — is it running on :4002?</span>
          ) : health ? (
            <span className={cn('status-up')}>
              {health.service} · {health.status} · contract v{health.contractVersion}
            </span>
          ) : (
            <span className="muted">checking…</span>
          )}
        </p>
      </section>
    </main>
  );
}
