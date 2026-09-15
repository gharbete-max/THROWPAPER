import { useState, type FormEvent } from 'react';
import { client, setSession } from '../lib/api.js';
import { useT } from '../lib/i18n.js';
import { useDemo } from '../lib/demo.js';
import { PoweredBy, Wordmark } from '../components/Logo.js';
import { useBrand } from '../lib/brand.js';

export function Login() {
  const t = useT();
  const { isDemo, users } = useDemo();
  const { tokens } = useBrand();
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [demo, setDemo] = useState<'idle' | 'busy' | 'failed'>('idle');

  async function submit(event: FormEvent) {
    event.preventDefault();
    setState('sending');
    // The API answers identically for known and unknown addresses, so there is nothing to branch
    // on here — showing "sent" regardless is the point.
    await client.requestMagicLink(email).catch(() => undefined);
    setState('sent');
  }

  return (
    <main className="shell shell--narrow system">
      <div>
        {/* A way back to the site: the page that sent you here is one press away. */}
        <a className="login__home" href="/">
          <Wordmark name={t('app.name')} />
        </a>
        {/* "Open the demo" is what the button said; the page should not answer "Sign in". */}
        <h1>{t(isDemo ? 'demo.title' : 'login.title')}</h1>
      </div>

      {isDemo && users.length > 0 && (
        <div className="card stack">
          <p className="small muted">{t('demo.signInHint')}</p>
          <div className="row">
            {users.map((user, index) => (
              <button
                key={user.email}
                type="button"
                // One filled button per screen: the first role is the recommended door in.
                className={index === 0 ? 'button' : 'button button--quiet'}
                disabled={demo === 'busy'}
                onClick={() => {
                  setDemo('busy');
                  client
                    .demoSignIn(user.email)
                    .then((pair) => {
                      setSession(pair);
                      // Full reload so the session provider picks the tokens up cleanly.
                      window.location.assign('/events');
                    })
                    // It swallowed this: press the button, nothing moves, no message, forever.
                    .catch(() => setDemo('failed'));
                }}
              >
                {/*
                  The role is translated before it is interpolated, not passed through raw.
                  `demo.signInAs` is "Anmelden als {role}" in German, so a raw `user.role` produced
                  "Anmelden als admin" — a translated sentence with an English word dropped into
                  the middle of it. `users.role.*` already carries "Administrator" and "Mitglied".
                */}
                {t('demo.signInAs', { role: t(`users.role.${user.role}`) })}
              </button>
            ))}
          </div>
          {demo === 'failed' && (
            <p className="status-down" role="alert">
              {t('demo.signInFailed')}
            </p>
          )}
        </div>
      )}

      {state === 'sent' ? (
        <div className="card">
          <p>{t('login.sent')}</p>
          {/* A note about the api-forms console has no business on a production screen. */}
          {import.meta.env.DEV && <p className="muted small">{t('login.devHint')}</p>}
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
      <PoweredBy tokens={tokens} />
    </main>
  );
}
