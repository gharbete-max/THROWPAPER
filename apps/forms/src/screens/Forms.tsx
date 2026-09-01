import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { pickText } from '@tp/i18n';
import type { FormResponse, FormTemplate } from '@tp/shared/forms';
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
  const [templates, setTemplates] = useState<FormTemplate[]>([]);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const isAdmin = user?.role === 'admin';

  const load = useCallback(() => {
    client
      .listForms()
      .then((result) => setForms(result.forms))
      .catch(() => setForms([]));
  }, []);

  useEffect(load, [load]);

  // Fetched once and kept: the catalogue ships with the product and does not change under us.
  useEffect(() => {
    client
      .formTemplates()
      .then((result) => setTemplates(result.templates))
      .catch(() => setTemplates([]));
  }, []);

  async function create(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      // The title starts in the org's default locale; the rest is filled in on the translation tab.
      await client.createForm({
        slug,
        title: { [locales.default]: title },
        ...(templateId ? { templateId } : {}),
      });
      setSlug('');
      setTitle('');
      setTemplateId(null);
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
          <div className="stack">
            <strong className="small">{t('templates.heading')}</strong>
            <p className="small muted">{t('templates.intro')}</p>

            <div className="templates">
              <TemplateCard
                selected={templateId === null}
                name={t('templates.blank')}
                description={t('templates.blankHint')}
                onSelect={() => setTemplateId(null)}
              />
              {templates.map((template) => (
                <TemplateCard
                  key={template.id}
                  selected={templateId === template.id}
                  name={pickText(locales, template.name, locale).value}
                  description={pickText(locales, template.description, locale).value}
                  fieldCount={template.definition.fields.length}
                  onSelect={() => {
                    setTemplateId(template.id);
                    // A title saves a step; it is editable like anything else.
                    if (!title) setTitle(pickText(locales, template.name, locale).value);
                  }}
                />
              ))}
            </div>
          </div>

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

/**
 * One template in the gallery.
 *
 * A radio, not a clickable div: choosing a starting point is a choice among alternatives, and
 * making it a real radio group means the arrow keys work and a screen reader says how many there
 * are and which is selected.
 */
function TemplateCard({
  selected,
  name,
  description,
  fieldCount,
  onSelect,
}: {
  selected: boolean;
  name: string;
  description: string;
  fieldCount?: number;
  onSelect: () => void;
}) {
  const t = useT();
  return (
    <label className="template">
      <input type="radio" name="template" checked={selected} onChange={onSelect} />
      <span className="template__body">
        <strong>{name}</strong>
        <span className="small muted">{description}</span>
        {fieldCount !== undefined && (
          <span className="small muted">
            {fieldCount} {t('templates.fields')}
          </span>
        )}
      </span>
    </label>
  );
}
