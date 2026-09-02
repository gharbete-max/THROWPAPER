import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { pickText } from '@tp/i18n';
import type { FormResponse, FormTemplate } from '@tp/shared/forms';
import { ApiError, client } from '../lib/api.js';
import { useSession } from '../lib/session.js';
import { useT } from '../lib/i18n.js';
import { Icon } from '../components/Icon.js';
import { CopyLink } from '../components/CopyLink.js';

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
        // Only a published form has a page to open; linking to a draft sends people to a 404.
        const publicPath = `/f/${form.slug}`;
        const live = form.status === 'published';
        return (
          <article className="card stack" key={form.id}>
            <div className="row row--between">
              <h2>{name.value || form.slug}</h2>
              <span className="badge">{t(`forms.status.${form.status}`)}</span>
            </div>

            {/**
             * Responses first. A list of forms with no counts on it answers "what have I built",
             * which nobody is asking; the question is "is anybody filling these in".
             */}
            <p className="small">
              <Icon name="inbox" className="icon--lead" />
              <strong>{t('forms.responses', { count: form.submissionCount })}</strong>
              <span className="muted">
                {' · '}
                {form.publishedVersion
                  ? t('forms.version', { n: form.publishedVersion })
                  : t('forms.unpublished')}
              </span>
            </p>

            {/**
             * The address was printed as plain text, so the one thing an author most wants to do
             * with it — look at their own form, or send the link to somebody — was retyping.
             */}
            <p className="small row form-link-row">
              {live ? (
                <a
                  className="form-link"
                  href={publicPath}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Icon name="external" className="icon--lead" />
                  {publicPath}
                </a>
              ) : (
                <span className="muted">
                  <Icon name="link" className="icon--lead" />
                  {publicPath}
                </span>
              )}
              <CopyLink path={publicPath} />
            </p>

            {incomplete.length > 0 && (
              <p className="small status-warning">
                <Icon name="globe" className="icon--lead" />
                {/* The bare locale codes used to sit here on their own, orange and unexplained. */}
                {t('forms.untranslated', {
                  locales: incomplete.map((entry) => entry.locale).join(', '),
                })}
              </p>
            )}

            <div className="row card__actions">
              <Link className="button button--quiet" to={`/forms/${form.id}/submissions`}>
                <Icon name="inbox" className="icon--lead" />
                {t('forms.viewResponses')}
              </Link>
              {isAdmin && (
                <Link className="button button--quiet" to={`/forms/${form.id}`}>
                  <Icon name="edit" className="icon--lead" />
                  {t('forms.edit')}
                </Link>
              )}
            </div>
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
