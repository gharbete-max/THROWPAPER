import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { pickText } from '@tp/i18n';
import type { FormResponse } from '@tp/shared/forms';
import { ApiError, client } from '../lib/api.js';
import { useSession } from '../lib/session.js';
import { useT } from '../lib/i18n.js';

export function Forms() {
  const t = useT();
  const { locale, locales, user } = useSession();
  const [forms, setForms] = useState<FormResponse[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [slug, setSlug] = useState('');
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const isAdmin = user?.role === 'admin';

  const load = useCallback(() => {
    client
      .listForms()
      .then((result) => setForms(result.forms))
      .catch(() => setForms([]));
  }, []);

  useEffect(load, [load]);

  async function create(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      // The title starts in the org's default locale; the rest is filled in on the translation tab.
      await client.createForm({ slug, title: { [locales.default]: title } });
      setSlug('');
      setTitle('');
      setCreating(false);
      load();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : String(cause));
    }
  }

  return (
    <section className="stack">
      <header className="row row--between">
        <h1>{t('forms.title')}</h1>
        {isAdmin && (
          <button className="button" onClick={() => setCreating((open) => !open)}>
            {t('forms.new')}
          </button>
        )}
      </header>

      {creating && (
        <form className="card stack" onSubmit={create}>
          <label className="field">
            <span>{t('forms.formTitle')}</span>
            <input required value={title} onChange={(event) => setTitle(event.target.value)} />
          </label>
          <label className="field">
            <span>{t('forms.slug')}</span>
            <input
              required
              value={slug}
              onChange={(event) => setSlug(event.target.value)}
              pattern="[a-z0-9][a-z0-9\-]*"
            />
            <span className="small muted">{t('forms.slugHint')}</span>
          </label>
          {error && <p className="status-down small">{error}</p>}
          <button className="button" type="submit">
            {t('forms.create')}
          </button>
        </form>
      )}

      {forms === null && <p className="muted">{t('app.loading')}</p>}
      {forms?.length === 0 && <p className="muted">{t('forms.empty')}</p>}

      {forms?.map((form) => {
        const name = pickText(locales, form.title, locale);
        const incomplete = form.completeness.filter((entry) => !entry.complete);
        return (
          <article className="card stack" key={form.id}>
            <div className="row row--between">
              <h2>{name.value || form.slug}</h2>
              <span className="badge">{t(`forms.status.${form.status}`)}</span>
            </div>
            <p className="small muted">
              /f/{form.slug} ·{' '}
              {form.publishedVersion
                ? t('forms.version', { n: form.publishedVersion })
                : t('forms.unpublished')}
            </p>
            {incomplete.length > 0 && (
              <p className="small status-warning">
                {incomplete.map((entry) => entry.locale).join(', ')}
              </p>
            )}
            {isAdmin && (
              <div className="row">
                <Link className="button button--quiet" to={`/forms/${form.id}`}>
                  {t('event.editTitle')}
                </Link>
              </div>
            )}
          </article>
        );
      })}
    </section>
  );
}
