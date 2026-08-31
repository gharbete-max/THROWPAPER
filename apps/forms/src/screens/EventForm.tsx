import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import type { api } from '@tp/shared';
import { client } from '../lib/api.js';
import { useSession } from '../lib/session.js';
import { fromLocalInput, toLocalInput, useT } from '../lib/i18n.js';

interface Draft {
  name: Record<string, string>;
  description: Record<string, string>;
  startsAt: string;
  endsAt: string;
  venueName: string;
  venueAddress: string;
  capacity: string;
  registrationClosesAt: string;
  status: 'draft' | 'open' | 'closed';
}

const emptyDraft: Draft = {
  name: {},
  description: {},
  startsAt: '',
  endsAt: '',
  venueName: '',
  venueAddress: '',
  capacity: '',
  registrationClosesAt: '',
  status: 'draft',
};

export function EventForm() {
  const t = useT();
  const navigate = useNavigate();
  const { id } = useParams();
  const { locales } = useSession();
  const editing = Boolean(id);

  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    client
      .listEvents()
      .then(({ events }) => events.find((event) => event.id === id))
      .then((event) => {
        if (event) setDraft(toDraft(event));
      })
      .catch(() => setError('load-failed'));
  }, [id]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const payload = toPayload(draft);
      if (id) await client.updateEvent(id, payload);
      else await client.createEvent(payload as api.EventInput);
      navigate('/events');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  }

  function setText(field: 'name' | 'description', locale: string, value: string) {
    setDraft((current) => ({ ...current, [field]: { ...current[field], [locale]: value } }));
  }

  return (
    <form className="stack" onSubmit={submit}>
      <h1>{editing ? t('event.editTitle') : t('event.createTitle')}</h1>

      {/*
        One field per locale rather than a single box: the translation tab in phase 3 is the
        richer version of this, and the storage shape is already right for it.
      */}
      {(['name', 'description'] as const).map((field) => (
        <fieldset className="card stack" key={field}>
          <legend>{t(`event.${field}`)}</legend>
          {locales.supported.map((locale) => (
            <label className="field" key={locale}>
              <span>{locale}</span>
              {field === 'name' ? (
                <input
                  value={draft.name[locale] ?? ''}
                  onChange={(event) => setText('name', locale, event.target.value)}
                  required={locale === locales.default}
                />
              ) : (
                <textarea
                  rows={3}
                  value={draft.description[locale] ?? ''}
                  onChange={(event) => setText('description', locale, event.target.value)}
                />
              )}
            </label>
          ))}
        </fieldset>
      ))}

      <fieldset className="card stack">
        <legend>{t('event.status')}</legend>
        <label className="field">
          <span>{t('event.startsAt')}</span>
          <input
            type="datetime-local"
            required
            value={draft.startsAt}
            onChange={(event) => setDraft({ ...draft, startsAt: event.target.value })}
          />
        </label>
        <label className="field">
          <span>{t('event.endsAt')}</span>
          <input
            type="datetime-local"
            required
            value={draft.endsAt}
            onChange={(event) => setDraft({ ...draft, endsAt: event.target.value })}
          />
        </label>
        <label className="field">
          <span>{t('event.registrationClosesAt')}</span>
          <input
            type="datetime-local"
            value={draft.registrationClosesAt}
            onChange={(event) => setDraft({ ...draft, registrationClosesAt: event.target.value })}
          />
        </label>
        <label className="field">
          <span>{t('event.venueName')}</span>
          <input
            value={draft.venueName}
            onChange={(event) => setDraft({ ...draft, venueName: event.target.value })}
          />
        </label>
        <label className="field">
          <span>{t('event.venueAddress')}</span>
          <input
            value={draft.venueAddress}
            onChange={(event) => setDraft({ ...draft, venueAddress: event.target.value })}
          />
        </label>
        <label className="field">
          <span>{t('event.capacity')}</span>
          <input
            type="number"
            min={1}
            value={draft.capacity}
            onChange={(event) => setDraft({ ...draft, capacity: event.target.value })}
          />
        </label>
        <label className="field">
          <span>{t('event.status')}</span>
          <select
            value={draft.status}
            onChange={(event) =>
              setDraft({ ...draft, status: event.target.value as Draft['status'] })
            }
          >
            {(['draft', 'open', 'closed'] as const).map((status) => (
              <option key={status} value={status}>
                {t(`event.status.${status}`)}
              </option>
            ))}
          </select>
        </label>
      </fieldset>

      {error && <p className="status-down">{error}</p>}

      <div className="row">
        <button className="button" type="submit" disabled={saving}>
          {saving ? t('event.saving') : t('event.save')}
        </button>
        <button className="button button--quiet" type="button" onClick={() => navigate('/events')}>
          {t('event.cancel')}
        </button>
      </div>
    </form>
  );
}

function toDraft(event: api.EventResponse): Draft {
  return {
    name: { ...event.name },
    description: { ...event.description },
    startsAt: toLocalInput(event.startsAt),
    endsAt: toLocalInput(event.endsAt),
    venueName: event.venueName ?? '',
    venueAddress: event.venueAddress ?? '',
    capacity: event.capacity === null ? '' : String(event.capacity),
    registrationClosesAt: toLocalInput(event.registrationClosesAt),
    status: event.status === 'archived' ? 'closed' : event.status,
  };
}

function toPayload(draft: Draft): api.EventPatch {
  return {
    name: stripEmpty(draft.name),
    description: stripEmpty(draft.description),
    startsAt: fromLocalInput(draft.startsAt) ?? undefined,
    endsAt: fromLocalInput(draft.endsAt) ?? undefined,
    venueName: draft.venueName || undefined,
    venueAddress: draft.venueAddress || undefined,
    capacity: draft.capacity ? Number(draft.capacity) : null,
    registrationClosesAt: fromLocalInput(draft.registrationClosesAt),
    status: draft.status,
  };
}

/** An empty box means "not translated yet", not an empty translation. */
function stripEmpty(text: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(text).filter(([, value]) => value.trim()));
}
