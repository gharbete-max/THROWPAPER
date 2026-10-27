import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { pickText } from '@tp/i18n';
import type { api } from '@tp/shared';
import { client } from '../../lib/api.js';
import { useSession } from '../../lib/session.js';
import { useT } from '../../lib/i18n.js';
import { useConfirm } from '../../components/Confirm.js';
import { EmptyState } from '../../components/EmptyState.js';
import { LoadFailed } from '../../components/LoadFailed.js';
import { Loading } from '../../components/Loading.js';

interface Draft {
  id?: string;
  name: string;
  email: string;
  phone: string;
  note: string;
  eventIds: string[];
}
const blank: Draft = { name: '', email: '', phone: '', note: '', eventIds: [] };

/**
 * People kept by hand, registered for events by ticking them. No public form is involved: the
 * person at the keyboard is the one who registers everybody.
 */
export function People() {
  const t = useT();
  const confirm = useConfirm();
  const { locale, locales } = useSession();
  const [people, setPeople] = useState<api.PersonResponse[] | null>(null);
  const [events, setEvents] = useState<api.EventResponse[]>([]);
  const [failed, setFailed] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);

  const load = useCallback(() => {
    setFailed(false);
    Promise.all([client.listPeople(), client.listEvents()])
      .then(([p, e]) => {
        setPeople(p.people);
        setEvents(e.events);
      })
      .catch(() => setFailed(true));
  }, []);
  useEffect(load, [load]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;
    await client.savePerson(
      {
        name: draft.name,
        email: draft.email || null,
        phone: draft.phone || null,
        note: draft.note || null,
        eventIds: draft.eventIds,
      },
      draft.id,
    );
    setDraft(null);
    load();
  }

  async function remove(person: api.PersonResponse) {
    if (!(await confirm(t('people.deleteConfirm'), { danger: true }))) return;
    await client.deletePerson(person.id);
    setDraft(null);
    load();
  }

  const eventName = (id: string) => {
    const found = events.find((e) => e.id === id);
    return found ? pickText(locales, found.name, locale).value : '';
  };
  const set = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d));

  return (
    <section className="stack">
      <header className="row row--between">
        <h1>{t('people.title')}</h1>
        <button className="button" onClick={() => setDraft(blank)}>
          {t('people.add')}
        </button>
      </header>

      {draft && (
        <form className="card stack" onSubmit={(event) => void save(event)}>
          <label className="field">
            <span>{t('people.name')}</span>
            <input
              required
              autoFocus
              value={draft.name}
              onChange={(e) => set({ name: e.target.value })}
            />
          </label>
          <div className="row">
            <label className="field">
              <span>{t('login.email')}</span>
              <input
                type="email"
                value={draft.email}
                onChange={(e) => set({ email: e.target.value })}
              />
            </label>
            <label className="field">
              <span>{t('people.phone')}</span>
              <input
                type="tel"
                value={draft.phone}
                onChange={(e) => set({ phone: e.target.value })}
              />
            </label>
          </div>
          <label className="field">
            <span>{t('people.note')}</span>
            <textarea rows={2} value={draft.note} onChange={(e) => set({ note: e.target.value })} />
          </label>
          <fieldset className="field">
            <legend>{t('people.events')}</legend>
            {events.length === 0 && <p className="muted small">{t('people.noEvents')}</p>}
            {events.map((e) => (
              <label key={e.id} className="row">
                <input
                  type="checkbox"
                  checked={draft.eventIds.includes(e.id)}
                  onChange={(ev) =>
                    set({
                      eventIds: ev.target.checked
                        ? [...draft.eventIds, e.id]
                        : draft.eventIds.filter((id) => id !== e.id),
                    })
                  }
                />
                {pickText(locales, e.name, locale).value}
              </label>
            ))}
          </fieldset>
          <div className="row">
            <button className="button" type="submit">
              {t('event.save')}
            </button>
            <button className="button button--quiet" type="button" onClick={() => setDraft(null)}>
              {t('event.cancel')}
            </button>
          </div>
        </form>
      )}

      {failed && <LoadFailed onRetry={load} />}
      {!failed && people === null && <Loading />}
      {people?.length === 0 && !draft && <EmptyState icon="people" title={t('people.empty')} />}
      {people && people.length > 0 && (
        <ul className="stack">
          {people.map((person) => (
            <li key={person.id} className="card row row--between">
              <button
                className="button button--quiet"
                onClick={() =>
                  setDraft({
                    id: person.id,
                    name: person.name,
                    email: person.email ?? '',
                    phone: person.phone ?? '',
                    note: person.note ?? '',
                    eventIds: person.eventIds,
                  })
                }
              >
                <strong>{person.name}</strong>
                <span className="muted small">
                  {' '}
                  {[person.email, person.phone].filter(Boolean).join(' · ')}
                </span>
              </button>
              <span className="row">
                {person.eventIds
                  .map(eventName)
                  .filter(Boolean)
                  .map((name) => (
                    <span key={name} className="badge">
                      {name}
                    </span>
                  ))}
              </span>
              <button className="button button--quiet small" onClick={() => void remove(person)}>
                {t('people.delete')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
