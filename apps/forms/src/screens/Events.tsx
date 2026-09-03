import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { pickText } from '@tp/i18n';
import type { api } from '@tp/shared';
import { client } from '../lib/api.js';
import { useSession } from '../lib/session.js';
import { formatDateTime, useT } from '../lib/i18n.js';
import { Icon } from '../components/Icon.js';
import { useConfirm } from '../components/Confirm.js';
import { EmptyState } from '../components/EmptyState.js';
import { Meter } from '../components/Meter.js';
import { Loading } from '../components/Loading.js';
import { Reveal } from '../components/Signed.js';

export function Events() {
  const t = useT();
  const { locale, locales, user } = useSession();
  const confirm = useConfirm();
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
    // Rule 7: nothing deletes — or archives — without a confirmation step. The hook, not the
    // global: bare `confirm(...)` is `window.confirm`, which returns false and shows nothing in
    // an embedded browser, so this button was dead everywhere the app is not a normal tab.
    if (!(await confirm(t('events.archiveConfirm'), { danger: true }))) return;
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

      {events === null && <Loading />}
      {events?.length === 0 && (
        <EmptyState
          icon="events"
          title={t('events.empty')}
          /* Only an admin can make one, so only an admin is offered the way to. */
          action={
            isAdmin ? (
              <Link className="button" to="/events/new">
                {t('events.new')}
              </Link>
            ) : undefined
          }
        />
      )}

      {events?.map((event) => {
        const name = pickText(locales, event.name, locale);
        return (
          <Reveal key={event.id}>
            <article className="card stack">
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

              {/**
               * Registrations first, capacity second.
               *
               * The list used to say "250 places · Registration open" — the two facts an organiser
               * already knows, because they set them. How many people have actually signed up is
               * the reason to open the screen, and the API has been returning it all along.
               */}
              <p className="small">
                <Icon name="people" className="icon--lead" />
                <strong>
                  {event.capacity === null
                    ? t('events.registered', { count: event.registeredCount })
                    : t('events.registeredOf', {
                        count: event.registeredCount,
                        capacity: event.capacity,
                      })}
                </strong>
                <span className="muted">
                  {' · '}
                  {event.registrationOpen
                    ? t('events.registrationOpen')
                    : t('events.registrationClosed')}
                </span>
              </p>

              {event.capacity !== null && (
                <Meter
                  value={event.registeredCount}
                  max={event.capacity}
                  label={t('events.capacity', { count: event.capacity })}
                />
              )}

              {event.missingLocales.length > 0 && (
                <p className="small status-warning">
                  {t('events.untranslated', { locales: event.missingLocales.join(', ') })}
                </p>
              )}

              {/* One row, not two: splitting four buttons across two lines by who may press them
                made the card look like it had two unrelated toolbars. */}
              <div className="row card__actions">
                <Link className="button button--quiet" to={`/events/${event.id}/attendance`}>
                  <Icon name="people" className="icon--lead" />
                  {t('attendance.title')}
                </Link>
                <Link className="button button--quiet" to={`/events/${event.id}/check-in`}>
                  <Icon name="checkin" className="icon--lead" />
                  {t('nav.checkin')}
                </Link>
                {isAdmin && event.status !== 'archived' && (
                  <>
                    <Link className="button button--quiet" to={`/events/${event.id}`}>
                      <Icon name="edit" className="icon--lead" />
                      {t('event.editTitle')}
                    </Link>
                    <button className="button button--quiet" onClick={() => archive(event)}>
                      <Icon name="archive" className="icon--lead" />
                      {t('events.archive')}
                    </button>
                  </>
                )}
              </div>
            </article>
          </Reveal>
        );
      })}
    </section>
  );
}
