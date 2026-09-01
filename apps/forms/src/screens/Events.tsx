import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { pickText } from '@tp/i18n';
import type { api } from '@tp/shared';
import { client } from '../lib/api.js';
import { useSession } from '../lib/session.js';
import { formatDateTime, useT } from '../lib/i18n.js';

export function Events() {
  const t = useT();
  const { locale, locales, user } = useSession();
  const [events, setEvents] = useState<api.EventResponse[] | null>(null);
  const isAdmin = user?.role === 'admin';

  const load = useCallback(() => {
    client
      .listEvents()
      .then((result) => setEvents(result.events))
      .catch(() => setEvents([]));
  }, []);

  useEffect(load, [load]);

  async function archive(event: api.EventResponse) {
    // Rule 7: nothing deletes — or archives — without a confirmation step.
    if (!(await confirm(t('events.archiveConfirm')))) return;
    await client.archiveEvent(event.id);
    load();
  }

  return (
    <section className="stack">
      <header className="row row--between">
        <h1>{t('events.title')}</h1>
        {isAdmin && (
          <Link className="button" to="/events/new">
            {t('events.new')}
          </Link>
        )}
      </header>

      {!isAdmin && <p className="muted small">{t('events.adminOnly')}</p>}

      {events === null && <p className="muted">{t('app.loading')}</p>}
      {events?.length === 0 && <p className="muted">{t('events.empty')}</p>}

      {events?.map((event) => {
        const name = pickText(locales, event.name, locale);
        return (
          <article className="card stack" key={event.id}>
            <div className="row row--between">
              <h2>
                {name.value}
                {name.fallback && <span className="badge badge--warning">{name.locale}</span>}
              </h2>
              <span className="badge">{t(`event.status.${event.status}`)}</span>
            </div>

            <p className="muted">
              {formatDateTime(locale, event.startsAt)} — {formatDateTime(locale, event.endsAt)}
              {event.venueName ? ` · ${event.venueName}` : ''}
            </p>

            <p className="muted small">
              {event.capacity === null
                ? t('events.uncapped')
                : t('events.capacity', { count: event.capacity })}
              {' · '}
              {event.registrationOpen
                ? t('events.registrationOpen')
                : t('events.registrationClosed')}
            </p>

            {event.missingLocales.length > 0 && (
              <p className="small status-warning">
                {t('events.untranslated', { locales: event.missingLocales.join(', ') })}
              </p>
            )}

            <div className="row">
              <Link className="button button--quiet" to={`/events/${event.id}/attendance`}>
                {t('attendance.title')}
              </Link>
              <Link className="button button--quiet" to={`/events/${event.id}/check-in`}>
                {t('nav.checkin')}
              </Link>
            </div>

            {isAdmin && event.status !== 'archived' && (
              <div className="row">
                <Link className="button button--quiet" to={`/events/${event.id}`}>
                  {t('event.editTitle')}
                </Link>
                <button className="button button--quiet" onClick={() => archive(event)}>
                  {t('events.archive')}
                </button>
              </div>
            )}
          </article>
        );
      })}
    </section>
  );
}
