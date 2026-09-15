import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import type { UserSummary } from '@tp/shared/forms';
import { ApiError, client } from '../lib/api.js';
import { useT } from '../lib/i18n.js';
import { Icon } from '../components/Icon.js';
import { Loading } from '../components/Loading.js';
import { Reveal } from '../components/Signed.js';
import { useConfirm } from '../components/Confirm.js';

/**
 * Everybody in the organisation, for an administrator doing support work.
 *
 * The counts are the reason this is a list of cards rather than a directory: "who has forms and
 * who has things in their bin" is what an administrator is here to find out, and a list of names
 * and addresses answers that no better than the staff handbook would.
 *
 * ## The writes, and the one refusal worth explaining
 *
 * Adding somebody, disabling them and changing their role are the whole of it — ADR 0002 records
 * why there is no invitation step (a magic link already is one) and why an email cannot be edited
 * here (the address is the login identity).
 *
 * The refusal that needs its own sentence is the last administrator. The server will not let the
 * final enabled administrator be demoted or disabled, because doing so locks the organisation out
 * of its own account with no way back that does not involve a database. A generic "that did not
 * work" would send somebody looking for a bug; `users.errorLastAdmin` names the next step, and the
 * next step is one they can take themselves.
 */
export function Users() {
  const t = useT();
  const confirm = useConfirm();
  const [users, setUsers] = useState<UserSummary[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<UserSummary['role']>('operator');
  const [error, setError] = useState<string | null>(null);
  /** Guards the row being written to, so a double click cannot send the change twice. */
  const [busy, setBusy] = useState<string | null>(null);

  function load() {
    return client
      .listUsers()
      .then((result) => setUsers(result.users))
      .catch(() => setUsers([]));
  }

  useEffect(() => {
    void load();
  }, []);

  /**
   * Turns a failure into something the reader can act on.
   *
   * The server already sends a usable sentence, but the screen is translated and the server is
   * not — so the code is what crosses the boundary, and the catalogue supplies the words.
   */
  function explain(cause: unknown): string {
    if (cause instanceof ApiError) {
      if (cause.code === 'email-taken') return t('users.errorEmailTaken');
      if (cause.code === 'last-admin') return t('users.errorLastAdmin');
    }
    return t('users.errorFailed');
  }

  async function add(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await client.createUser({ name: name.trim(), email: email.trim(), role });
      setName('');
      setEmail('');
      setRole('operator');
      setAdding(false);
      await load();
    } catch (cause) {
      setError(explain(cause));
    }
  }

  async function change(
    person: UserSummary,
    changes: { role?: UserSummary['role']; disabled?: boolean },
  ) {
    setError(null);
    setBusy(person.id);
    try {
      await client.updateUser(person.id, changes);
      await load();
    } catch (cause) {
      setError(explain(cause));
    } finally {
      setBusy(null);
    }
  }

  /**
   * Rule 7: disabling somebody is confirmed first.
   *
   * Re-enabling is not — it takes nothing away, and a confirmation on every harmless action is how
   * people learn to click through the ones that matter.
   */
  async function toggleDisabled(person: UserSummary) {
    if (person.disabled) return change(person, { disabled: false });
    if (!(await confirm(t('users.confirmDisable', { name: person.name }), { danger: true })))
      return;
    return change(person, { disabled: true });
  }

  async function toggleRole(person: UserSummary) {
    const next = person.role === 'admin' ? 'operator' : 'admin';
    if (!(await confirm(t('users.confirmRole', { name: person.name }), { danger: false }))) return;
    return change(person, { role: next });
  }

  return (
    <section className="stack">
      <header className="stack stack--tight">
        <h1>{t('users.title')}</h1>
        <p className="muted small">{t('users.intro')}</p>
      </header>

      <div className="row card__actions">
        <button type="button" className="button" onClick={() => setAdding((open) => !open)}>
          <Icon name="plus" className="icon--lead" />
          {t('users.add')}
        </button>
      </div>

      {adding && (
        <form className="card stack" onSubmit={(event) => void add(event)}>
          <label className="field">
            <span>{t('users.addName')}</span>
            <input value={name} onChange={(event) => setName(event.target.value)} required />
          </label>
          <label className="field">
            <span>{t('users.addEmail')}</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              /* The address is the identity, so the phone should not capitalise the first letter. */
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
          </label>
          <label className="field">
            <span>{t('users.addRole')}</span>
            <select
              value={role}
              onChange={(event) => setRole(event.target.value as UserSummary['role'])}
            >
              {(['operator', 'admin'] as const).map((option) => (
                <option key={option} value={option}>
                  {t(`users.role.${option}`)}
                </option>
              ))}
            </select>
          </label>
          <p className="small muted">{t('users.addHint')}</p>
          <div className="row card__actions">
            <button type="submit" className="button">
              {t('users.addSubmit')}
            </button>
            <button type="button" className="button button--quiet" onClick={() => setAdding(false)}>
              {t('users.addCancel')}
            </button>
          </div>
        </form>
      )}

      {/* `role="alert"` so the refusal is announced, not only drawn. */}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {users === null && <Loading />}

      {users?.map((person) => (
        <Reveal key={person.id}>
          <article className="card stack">
            <div className="row row--between">
              <h2>{person.name}</h2>
              <span className="row">
                {person.disabled && (
                  <span className="badge badge--quiet">{t('users.disabled')}</span>
                )}
                <span className="badge">{t(`users.role.${person.role}`)}</span>
              </span>
            </div>
            <p className="small muted">{person.email}</p>
            <p className="small row form-meta">
              <span>
                <Icon name="forms" className="icon--lead" />
                {t('users.forms', { count: person.formCount })}
              </span>
              <span>
                <Icon name="trash" className="icon--lead" />
                {t('users.inBin', { count: person.trashCount })}
              </span>
            </p>
            <div className="row card__actions">
              <Link className="button button--quiet" to={`/users/${person.id}`}>
                <Icon name="external" className="icon--lead" />
                {t('users.open')}
              </Link>
              <button
                type="button"
                className="button button--quiet"
                disabled={busy === person.id}
                onClick={() => void toggleRole(person)}
              >
                {person.role === 'admin' ? t('users.makeMember') : t('users.makeAdmin')}
              </button>
              <button
                type="button"
                className="button button--quiet"
                disabled={busy === person.id}
                onClick={() => void toggleDisabled(person)}
              >
                {person.disabled ? t('users.enable') : t('users.disable')}
              </button>
            </div>
          </article>
        </Reveal>
      ))}
    </section>
  );
}
