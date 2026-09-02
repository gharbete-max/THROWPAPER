import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import type { UserSummary } from '@tp/shared/forms';
import { client } from '../lib/api.js';
import { useT } from '../lib/i18n.js';
import { Icon } from '../components/Icon.js';
import { Loading } from '../components/Loading.js';
import { Reveal } from '../components/Signed.js';

/**
 * Everybody in the organisation, for an administrator doing support work.
 *
 * The counts are the reason this is a list of cards rather than a directory: "who has forms and
 * who has things in their bin" is what an administrator is here to find out, and a list of names
 * and addresses answers that no better than the staff handbook would.
 */
export function Users() {
  const t = useT();
  const [users, setUsers] = useState<UserSummary[] | null>(null);

  useEffect(() => {
    client
      .listUsers()
      .then((result) => setUsers(result.users))
      .catch(() => setUsers([]));
  }, []);

  return (
    <section className="stack">
      <header className="stack stack--tight">
        <h1>{t('users.title')}</h1>
        <p className="muted small">{t('users.intro')}</p>
      </header>

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
            </div>
          </article>
        </Reveal>
      ))}
    </section>
  );
}
