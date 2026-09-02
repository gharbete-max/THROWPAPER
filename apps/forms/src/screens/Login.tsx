import { useState, type FormEvent } from 'react';
import { client, setSession } from '../lib/api.js';
import { useT } from '../lib/i18n.js';
import { useDemo } from '../lib/demo.js';
import { Wordmark } from '../components/Logo.js';

export function Login() {
  const t = useT();
  const { isDemo, users } = useDemo();
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');

  async function submit(event: FormEvent) {
    event.preventDefault();
    setState('sending');
    // The API answers identically for known and unknown addresses, so there is nothing to branch
    // on here — showing "sent" regardless is the point.
    await client.requestMagicLink(email).catch(() => undefined);
    setState('sent');
  }

  return (
    <main className="shell shell--narrow">
      <Wordmark name={t('app.name')} />
      <h1>{t('login.title')}</h1>

      {isDemo && users.length > 0 && (
        <div className="card stack">
          <p className="small muted">{t('demo.signInHint')}</p>
          <div className="row">
            {users.map((user) => (
              <button
                key={user.email}
                type="button"
                className="button"
                onClick={() => {
                  client
                    .demoSignIn(user.email)
                    .then((pair) => {
                      setSession(pair);
                      // Full reload so the session provider picks the tokens up cleanly.
                      window.location.assign('/events');
                    })
                    .catch(() => undefined);
                }}
              >
                {t('demo.signInAs', { role: user.role })}
              </button>
            ))}
          </div>
        </div>
      )}

      {state === 'sent' ? (
        <div className="card">
          <p>{t('login.sent')}</p>
          <p className="muted small">{t('login.devHint')}</p>
        </div>
      ) : (
        <form className="card stack" onSubmit={submit}>
          <label className="field">
            <span>{t('login.email')}</span>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <button className="button" type="submit" disabled={state === 'sending'}>
            {state === 'sending' ? t('login.sending') : t('login.submit')}
          </button>
        </form>
      )}
    </main>
  );
}
