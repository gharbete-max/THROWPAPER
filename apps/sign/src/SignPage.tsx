import { useEffect, useState } from 'react';
import type { Translator } from '@tp/i18n';
import {
  decline,
  documentHref,
  openLink,
  signWith,
  type SignBody,
  type SignerView,
} from './api.js';
import { DrawPad, PAD } from './DrawPad.js';
import { translatorFor } from './messages.js';

type Method = 'typed' | 'drawn';

/**
 * The page a signer opens from their link (P1c-4a). One link, one party, one document.
 *
 * It shows what is being signed and exactly what the signer approves — the declaration, a
 * person's text in the signer's language (ADR 0012) — and takes a typed name or a drawn mark.
 * Declining is final for everybody, so it asks first (rule 7).
 */
export function SignPage({ token, fallback }: { token: string; fallback: Translator }) {
  const [view, setView] = useState<SignerView | null>(null);
  const [missing, setMissing] = useState(false);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [method, setMethod] = useState<Method>('typed');
  const [typedName, setTypedName] = useState('');
  const [paths, setPaths] = useState<string[]>([]);
  const [confirmingDecline, setConfirmingDecline] = useState(false);

  useEffect(() => {
    openLink(token)
      .then((result) => (result.ok ? setView(result.view) : setMissing(true)))
      .catch(() => setFailed(true));
  }, [token]);

  // The signer's own language once the link has said who they are.
  const { lang, t } = view ? translatorFor([view.party.locale]) : { lang: '', t: fallback };
  useEffect(() => {
    if (lang) document.documentElement.lang = lang;
  }, [lang]);

  if (missing) return <Shell t={t} message={t('sign.notFound')} />;
  if (!view) return <Shell t={t} message={failed ? t('sign.error') : t('sign.loading')} />;

  async function act(run: () => Promise<Awaited<ReturnType<typeof openLink>>>) {
    setBusy(true);
    setFailed(false);
    try {
      const result = await run();
      if (result.ok) setView(result.view);
      else setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
      setConfirmingDecline(false);
    }
  }

  const body: SignBody | null =
    method === 'typed'
      ? typedName.trim()
        ? { typedName: typedName.trim() }
        : null
      : paths.length
        ? { drawn: { v: 1, kind: 'drawn', width: PAD.width, height: PAD.height, paths } }
        : null;

  const outcome =
    view.status !== 'sent'
      ? t(`sign.envelope.${view.status}`)
      : view.party.status === 'signed'
        ? t('sign.party.signed')
        : view.party.status === 'declined'
          ? t('sign.party.declined')
          : null;

  return (
    <main className="shell stack">
      <header className="stack--tight">
        <h1>{view.documentName}</h1>
        <p className="muted">
          {t('sign.for', { name: view.party.name })}
          {view.environment === 'test' && <span className="badge">{t('sign.testMode')}</span>}
        </p>
        <p>
          <a href={documentHref(token)} target="_blank" rel="noreferrer noopener">
            {t('sign.open')}
          </a>
        </p>
      </header>

      <section className="card stack--tight">
        <h2>{t('sign.declaration')}</h2>
        <p className="declaration" data-testid="declaration">
          {view.declaration.text}
        </p>
      </section>

      {outcome && (
        <p className="notice" role="status" data-testid="outcome">
          {outcome}
        </p>
      )}

      {!outcome && !view.maySign && <p className="notice">{t('sign.notYourTurn')}</p>}

      {!outcome && view.maySign && (
        <section className="card stack">
          <h2>{t('sign.signature')}</h2>
          <div className="row" role="tablist">
            {(['typed', 'drawn'] as const).map((choice) => (
              <button
                key={choice}
                type="button"
                role="tab"
                aria-selected={method === choice}
                className={method === choice ? 'button button--chosen' : 'button button--quiet'}
                onClick={() => setMethod(choice)}
              >
                {t(`sign.method.${choice}`)}
              </button>
            ))}
          </div>

          {method === 'typed' ? (
            <label className="stack--tight">
              <span>{t('sign.typedLabel')}</span>
              <input
                className="input"
                value={typedName}
                maxLength={200}
                autoComplete="name"
                onChange={(event) => setTypedName(event.target.value)}
              />
            </label>
          ) : (
            <DrawPad paths={paths} onChange={setPaths} t={t} />
          )}

          <div className="row row--between">
            <button
              type="button"
              className="button"
              disabled={!body || busy}
              onClick={() => body && act(() => signWith(token, body))}
            >
              {busy ? t('sign.submitting') : t('sign.submit')}
            </button>
            {!confirmingDecline && (
              <button
                type="button"
                className="button button--quiet"
                disabled={busy}
                onClick={() => setConfirmingDecline(true)}
              >
                {t('sign.decline')}
              </button>
            )}
          </div>

          {confirmingDecline && (
            <div className="confirm stack--tight" role="alertdialog" aria-live="assertive">
              <p>{t('sign.declineConfirm')}</p>
              <div className="row">
                <button
                  type="button"
                  className="button button--danger"
                  disabled={busy}
                  onClick={() => act(() => decline(token))}
                >
                  {t('sign.declineYes')}
                </button>
                <button
                  type="button"
                  className="button button--quiet"
                  onClick={() => setConfirmingDecline(false)}
                >
                  {t('sign.cancel')}
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {failed && (
        <p className="error" role="alert">
          {t('sign.error')}
        </p>
      )}
    </main>
  );
}

function Shell({ t, message }: { t: Translator; message: string }) {
  return (
    <main className="shell">
      <h1>{t('title')}</h1>
      <p className="muted" role="status">
        {message}
      </p>
    </main>
  );
}
