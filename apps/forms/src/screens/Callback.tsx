import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useSession } from '../lib/session.js';
import { useT } from '../lib/i18n.js';

/** Where the magic link lands. The token is single use, so this must not run twice. */
export function Callback() {
  const t = useT();
  const [params] = useSearchParams();
  const { signInWithToken } = useSession();
  const navigate = useNavigate();
  const [failed, setFailed] = useState(false);
  const attempted = useRef(false);

  useEffect(() => {
    const token = params.get('token');
    if (!token || attempted.current) return;
    attempted.current = true;
    signInWithToken(token)
      /*
       * Signing in is not arriving.
       *
       * `/auth/callback` is matched before `/*`, so this screen keeps rendering after the exchange
       * succeeds — the session was real, the refresh token was stored, and the person sat looking
       * at "signing in…" until they gave up. Every other test plants a refresh token and skips
       * this screen, which is why nothing caught it; the simulated user walks in through the front
       * door and found it.
       *
       * `replace`, because the token is single use: a back button that returns here would spend a
       * link that has already been spent and answer "this link is no longer valid".
       */
      .then(() => navigate('/', { replace: true }))
      .catch(() => setFailed(true));
  }, [params, signInWithToken, navigate]);

  return (
    <main className="shell shell--narrow system">
      <div className="card">
        {failed ? (
          <>
            <p>{t('callback.failed')}</p>
            <Link className="button" to="/login">
              {t('callback.retry')}
            </Link>
          </>
        ) : (
          <p className="muted">{t('callback.working')}</p>
        )}
      </div>
    </main>
  );
}
