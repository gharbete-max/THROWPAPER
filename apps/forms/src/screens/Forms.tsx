import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { pickText } from '@tp/i18n';
import type { FormResponse, FormScope, FormTemplate } from '@tp/shared/forms';
import { ApiError, client } from '../lib/api.js';
import { useSession } from '../lib/session.js';
import { useT } from '../lib/i18n.js';
import { useConfirm } from '../components/Confirm.js';
import { Loading } from '../components/Loading.js';
import { Reveal } from '../components/Signed.js';
import { FormCard } from '../components/FormCard.js';
import { ScopeTabs } from '../components/ScopeTabs.js';
import { ShareDialog } from '../components/ShareDialog.js';

/**
 * A person's workspace.
 *
 * Four piles rather than one list, which is where every form builder on the market has landed:
 * what you made, what somebody handed you, and what you threw away are different questions, and a
 * single list answers none of them once there are more than a dozen forms in it.
 *
 * An administrator gets a fifth tab for the whole organisation. It is a separate pile rather than
 * a widened default on purpose — an administrator's own forms should still be findable without
 * scrolling past everybody else's.
 */
export function Forms() {
  const t = useT();
  const confirm = useConfirm();
  const { locale, locales, user } = useSession();
  const [scope, setScope] = useState<FormScope>('mine');
  const [forms, setForms] = useState<FormResponse[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [slug, setSlug] = useState('');
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [templates, setTemplates] = useState<FormTemplate[]>([]);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [sharing, setSharing] = useState<FormResponse | null>(null);

  const scopes: FormScope[] =
    user?.role === 'admin'
      ? ['mine', 'shared', 'trash', 'all']
      : ['mine', 'shared', 'active', 'trash'];

  const load = useCallback(() => {
    setForms(null);
    client
      .listForms(scope)
      .then((result) => setForms(result.forms))
      .catch(() => setForms([]));
  }, [scope]);

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
      // Straight to your own pile, which is where the new form went.
      if (scope === 'mine') load();
      else setScope('mine');
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : String(cause));
    }
  }

  async function trash(form: FormResponse) {
    const name = pickText(locales, form.title, locale).value || form.slug;
    if (!(await confirm(t('forms.confirmTrash', { title: name })))) return;
    await client.trashForm(form.id);
    load();
  }

  async function restore(form: FormResponse) {
    await client.restoreForm(form.id);
    load();
  }

  /**
   * The one irreversible action in the app, so the confirmation says the number out loud.
   *
   * "Delete this form?" and "delete this form and the four hundred and twelve answers people gave
   * it?" are different questions, and only the second one is the truth.
   */
  async function destroy(form: FormResponse) {
    const name = pickText(locales, form.title, locale).value || form.slug;
    const sure = await confirm(
      t('forms.confirmDelete', { title: name, count: form.submissionCount }),
      { confirmLabel: t('forms.deleteForever'), danger: true },
    );
    if (!sure) return;
    await client.deleteForm(form.id);
    load();
  }

  const empty =
    scope === 'mine'
      ? t('scope.emptyMine')
      : scope === 'shared'
        ? t('scope.emptyShared')
        : scope === 'trash'
          ? t('scope.emptyTrash')
          : t('forms.empty');

  return (
    <section className="stack">
      <header className="row row--between">
        <h1>{t('forms.title')}</h1>
        <button className="button" onClick={() => setCreating((open) => !open)}>
          {t('forms.new')}
        </button>
      </header>

      <ScopeTabs scopes={scopes} current={scope} onChange={setScope} label={t('forms.title')} />

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

      {forms === null && <Loading />}
      {forms?.length === 0 && <p className="muted">{empty}</p>}

      {forms?.map((form) => (
        <Reveal key={form.id}>
          <FormCard
            form={form}
            locale={locale}
            locales={locales}
            currentUserId={user?.id}
            onTrash={() => void trash(form)}
            onRestore={() => void restore(form)}
            onDelete={() => void destroy(form)}
            onShare={() => setSharing(form)}
          />
        </Reveal>
      ))}

      {sharing && <ShareDialog form={sharing} onClose={() => setSharing(null)} onChanged={load} />}
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
