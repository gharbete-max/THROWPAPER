import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SuppressionList } from '@tp/shared/api';
import { client } from '../lib/api.js';
import { formatDateTime, useT } from '../lib/i18n.js';
import { useSession } from '../lib/session.js';
import { useToast } from '../lib/toast.js';
import { sortedSuppressions, validAddress } from '../lib/suppressions.js';
import { useConfirm } from '../components/Confirm.js';
import { Loading } from '../components/Loading.js';

/**
 * The organisation's do-not-email list: who a campaign leaves out. It stops campaigns only (an
 * email to a list), never a one-off document or a signing invitation, and says so. Adding an
 * address is checked first; removing one asks first (rule 7).
 */
export function Suppressions({ onClose }: { onClose: () => void }) {
  const t = useT();
  const toast = useToast();
  const confirm = useConfirm();
  const { locale } = useSession();
  const [items, setItems] = useState<SuppressionList['items'] | null>(null);
  const [address, setAddress] = useState('');
  const [invalid, setInvalid] = useState(false);

  const load = useCallback(async () => {
    try {
      setItems((await client.suppressions()).items);
    } catch {
      toast.show(t('suppress.failed'), 'error');
    }
  }, [t, toast]);
  useEffect(() => void load(), [load]);

  const rows = useMemo(() => sortedSuppressions(items ?? [], locale), [items, locale]);

  async function add() {
    const email = validAddress(address);
    setInvalid(email === null);
    if (!email) return;
    try {
      await client.addSuppression(email);
      setAddress('');
      await load();
    } catch {
      toast.show(t('suppress.failed'), 'error');
    }
  }

  async function remove(email: string) {
    const yes = await confirm(t('suppress.removeConfirm', { email }), {
      confirmLabel: t('suppress.remove', { email }),
    });
    if (!yes) return;
    try {
      await client.removeSuppression(email);
      await load();
    } catch {
      toast.show(t('suppress.failed'), 'error');
    }
  }

  return (
    <div className="stack" data-testid="suppressions">
      <h2>{t('suppress.heading')}</h2>
      <p className="small">{t('suppress.scope')}</p>
      <form
        className="row"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void add();
        }}
      >
        <label className="field">
          <span>{t('suppress.add.label')}</span>
          <input
            type="email"
            value={address}
            aria-invalid={invalid}
            onChange={(event) => setAddress(event.target.value)}
          />
        </label>
        <button type="submit" className="button">
          {t('suppress.add')}
        </button>
      </form>
      {invalid && (
        <p role="alert" className="status-down small">
          {t('suppress.invalid')}
        </p>
      )}
      {items === null ? (
        <Loading />
      ) : rows.length === 0 ? (
        <p className="muted small">{t('suppress.empty')}</p>
      ) : (
        <div className="table-scroll">
          <table className="grid">
            <thead>
              <tr>
                <th>{t('suppress.col.email')}</th>
                <th>{t('suppress.col.date')}</th>
                <th>{t('suppress.col.reason')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.email}>
                  <td>{row.email}</td>
                  <td>{formatDateTime(locale, row.createdAt)}</td>
                  <td>{t(`suppress.reason.${row.reason}`)}</td>
                  <td>
                    <button
                      type="button"
                      className="button button--quiet small"
                      onClick={() => void remove(row.email)}
                    >
                      {t('suppress.remove', { email: row.email })}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="row">
        <button type="button" className="button button--quiet" onClick={onClose}>
          {t('suppress.close')}
        </button>
      </div>
    </div>
  );
}
