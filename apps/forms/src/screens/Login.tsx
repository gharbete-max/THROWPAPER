import { useState, type FormEvent } from 'react';
import { client } from '../lib/api.js';
import { useT } from '../lib/i18n.js';

export function Login() {
  const t = useT();
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
      <h1>{t('login.title')}</h1>

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
