import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useSession } from '../lib/session.js';
import { useT } from '../lib/i18n.js';

/** Where the magic link lands. The token is single use, so this must not run twice. */
export function Callback() {
  const t = useT();
  const [params] = useSearchParams();
  const { signInWithToken } = useSession();
  const [failed, setFailed] = useState(false);
  const attempted = useRef(false);

  useEffect(() => {
    const token = params.get('token');
    if (!token || attempted.current) return;
    attempted.current = true;
    signInWithToken(token).catch(() => setFailed(true));
  }, [params, signInWithToken]);

  return (
    <main className="shell shell--narrow">
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
