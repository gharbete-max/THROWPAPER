import { useState, type FormEvent } from 'react';
import { localeLabel } from '@tp/i18n';
import type { forms as formSchemas } from '@tp/shared';
import { client } from '../lib/api.js';
import { useSession } from '../lib/session.js';
import { useT } from '../lib/i18n.js';

type Declaration = formSchemas.SigningDeclarationList['declarations'][number];

/**
 * The declarations this organisation's signers approve (CONTRACT §5.5). The words are typed here
 * by an admin and stored at Sign exactly as typed — Loppa never writes, suggests or fills them in
 * (CLAUDE.md rule 8). Saving is a new version; an envelope already sent keeps the words it had.
 */
export function SigningDeclarations({
  declarations,
  onSaved,
}: {
  declarations: Declaration[];
  onSaved: (saved: Declaration) => void;
}) {
  const t = useT();
  const { user, locale, locales } = useSession();
  const languages = locales.supported.length ? locales.supported : [locale];
  const admin = user?.role === 'admin';
  const [editing, setEditing] = useState<{ key: string; texts: Record<string, string> } | null>(
    null,
  );
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  const key = editing?.key.trim() ?? '';
  const texts = Object.fromEntries(
    Object.entries(editing?.texts ?? {})
      .map(([code, text]) => [code, text.trim()] as const)
      .filter(([, text]) => text !== ''),
  );
  const validKey = /^[a-z0-9][a-z0-9._-]{0,63}$/.test(key);
  const ready = validKey && Object.keys(texts).length > 0;

  function edit(from: Declaration | null) {
    // A shared placeholder is never a starting point: its bracketed text is not anyone's words.
    const own = from && !from.shared ? from : null;
    setEditing({ key: from?.key ?? '', texts: own ? { ...own.texts } : {} });
    setConfirming(false);
    setFailed(false);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!ready) return;
    // Nothing is stored before a second, deliberate press (rule 7).
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setSaving(true);
    setFailed(false);
    try {
      onSaved(await client.writeSigningDeclaration({ key, texts }));
      setEditing(null);
      setConfirming(false);
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="card stack" aria-label={t('signing.declarations')}>
      <h2>{t('signing.declarations')}</h2>
      <p className="small muted">{t('signing.declarationsHint')}</p>
      <ul className="stack stack--tight">
        {declarations.map((declaration) => (
          <li key={`${declaration.shared ? 'shared' : 'own'}:${declaration.key}`} className="row">
            <strong>{declaration.key}</strong>
            <span className="small muted">
              {t('signing.declarationVersion', { version: declaration.version })}
            </span>
            {declaration.shared ? (
              <span className="badge">{t('signing.declarationTestOnly')}</span>
            ) : (
              <span className="small muted">
                {Object.keys(declaration.texts)
                  .map((code) => localeLabel(code))
                  .join(', ')}
              </span>
            )}
            {admin && !editing && (
              <button
                type="button"
                className="button button--quiet small"
                onClick={() => edit(declaration)}
              >
                {declaration.shared
                  ? t('signing.declarationWriteOwn')
                  : t('signing.declarationNewVersion')}
              </button>
            )}
          </li>
        ))}
      </ul>
      {admin && !editing && (
        <div>
          <button type="button" className="button button--quiet" onClick={() => edit(null)}>
            {t('signing.declarationNew')}
          </button>
        </div>
      )}
      {!admin && <p className="small muted">{t('signing.declarationAdminOnly')}</p>}

      {editing && (
        <form className="stack" onSubmit={save} aria-label={t('signing.declarationEditor')}>
          <label className="stack stack--tight">
            <span>{t('signing.declarationKeyLabel')}</span>
            <input
              className="input"
              value={editing.key}
              maxLength={64}
              onChange={(event) => {
                setEditing({ ...editing, key: event.target.value });
                setConfirming(false);
              }}
            />
            <span className="small muted">{t('signing.declarationKeyHint')}</span>
          </label>
          {languages.map((code) => (
            <label key={code} className="stack stack--tight">
              <span>{localeLabel(code)}</span>
              <textarea
                rows={5}
                maxLength={5000}
                value={editing.texts[code] ?? ''}
                onChange={(event) => {
                  setEditing({
                    ...editing,
                    texts: { ...editing.texts, [code]: event.target.value },
                  });
                  setConfirming(false);
                }}
              />
            </label>
          ))}
          <p className="small muted">{t('signing.declarationOwnWords')}</p>
          {confirming && (
            <p role="alert">
              <strong>{t('signing.declarationConfirm')}</strong>
            </p>
          )}
          {failed && (
            <p className="error" role="alert">
              {t('signing.declarationFailed')}
            </p>
          )}
          <div className="row">
            <button type="submit" className="button" disabled={!ready || saving}>
              {confirming ? t('signing.declarationSaveConfirm') : t('signing.declarationSave')}
            </button>
            <button
              type="button"
              className="button button--quiet"
              onClick={() => {
                setEditing(null);
                setConfirming(false);
              }}
            >
              {t('signing.cancel')}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
