import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { FormResponse, FormShareResponse, FormShareRole } from '@tp/shared/forms';
import { ApiError, client } from '../lib/api.js';
import { useT } from '../lib/i18n.js';
import { Icon } from './Icon.js';

/**
 * Who else can see this form.
 *
 * A real `<dialog>` shown with `showModal`, for the same reason `Confirm` is: focus is trapped,
 * Escape closes it, and the rest of the page is inert without any of that being reimplemented.
 *
 * Sharing is by email address rather than by picking from a list of colleagues. A picker would
 * mean shipping the organisation's directory to everybody in order to support an action that
 * needs one row of it, and the person sharing already knows the address they want.
 */
export function ShareDialog({
  form,
  onClose,
  onChanged,
}: {
  form: FormResponse;
  onClose: () => void;
  /** So the card behind the dialog can update its "shared with N" without a full reload. */
  onChanged: () => void;
}) {
  const t = useT();
  const dialog = useRef<HTMLDialogElement>(null);
  const [shares, setShares] = useState<FormShareResponse[] | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<FormShareRole>('viewer');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  useEffect(() => {
    client
      .listShares(form.id)
      .then((result) => setShares(result.shares))
      .catch(() => setShares([]));
  }, [form.id]);

  async function add(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await client.shareForm(form.id, email, role);
      setShares(result.shares);
      setEmail('');
      onChanged();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function remove(userId: string) {
    await client.unshareForm(form.id, userId);
    setShares((current) => (current ?? []).filter((share) => share.userId !== userId));
    onChanged();
  }

  return (
    <dialog className="dialog" ref={dialog} onClose={onClose} onCancel={onClose}>
      <div className="stack">
        <div className="row row--between">
          <h2>{t('share.title')}</h2>
          <button
            className="button button--quiet small"
            onClick={() => dialog.current?.close()}
            aria-label={t('event.cancel')}
          >
            <Icon name="close" />
          </button>
        </div>

        <form className="stack" onSubmit={add}>
          <label className="field">
            <span>{t('share.email')}</span>
            <input
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            <span className="small muted">{t('share.emailHint')}</span>
          </label>
          <label className="field">
            <span>{t('share.role')}</span>
            <select value={role} onChange={(event) => setRole(event.target.value as FormShareRole)}>
              <option value="viewer">{t('forms.access.viewer')}</option>
              <option value="editor">{t('forms.access.editor')}</option>
            </select>
          </label>
          {error && <p className="status-down small">{error}</p>}
          <button className="button" type="submit" disabled={busy}>
            {t('share.add')}
          </button>
        </form>

        {shares?.length === 0 && <p className="muted small">{t('share.none')}</p>}
        {shares && shares.length > 0 && (
          <ul className="share-list">
            {shares.map((share) => (
              <li key={share.userId} className="row row--between share-list__item">
                <span className="stack stack--tight">
                  <strong className="small">{share.name}</strong>
                  <span className="small muted">{share.email}</span>
                </span>
                <span className="row">
                  <span className="badge badge--quiet">{t(`forms.access.${share.role}`)}</span>
                  <button
                    className="button button--quiet small"
                    onClick={() => void remove(share.userId)}
                  >
                    {t('share.remove')}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </dialog>
  );
}
