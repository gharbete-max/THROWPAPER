import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { pickText } from '@tp/i18n';
import { type FormResponse, type FormScope, type FormTemplate } from '@tp/shared/forms';
import { ApiError, client } from '../../lib/api.js';
import { useSession } from '../../lib/session.js';
import { useT } from '../../lib/i18n.js';
import { useConfirm } from '../../components/Confirm.js';
import { Loading } from '../../components/Loading.js';
import { Reveal } from '../../components/Signed.js';
import { FormCard } from '../../components/FormCard.js';
import { EmptyState } from '../../components/EmptyState.js';
import { LoadFailed } from '../../components/LoadFailed.js';
import { ScopeTabs } from '../../components/ScopeTabs.js';
import { ShareDialog } from '../../components/ShareDialog.js';
import { Banner } from '../../components/Banner.js';
import { abandonedDrafts } from '../../lib/abandoned-drafts.js';

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
  const { locale, locales, interfaceLocales, user } = useSession();
  const [scope, setScope] = useState<FormScope>('mine');
  const [forms, setForms] = useState<FormResponse[] | null>(null);
  /**
   * How a new form is being started.
   *
   * `null` is closed. `'doors'` is the default — start from questions, or from paper
   * (`docs/plan/PREDICTIVE-BUILDER.md`, "The two doors"). `'manual'` is the way out, "Build it
   * myself": the template gallery and a link address of your own. All of them end in the same
   * editor with the same draft.
   */
  const navigate = useNavigate();
  /*
   * `?new` arrives with the doors open: the room's Scan part lands on the paper door (ADR 0022).
   * `?new=questions` and `?new=paper` open them with that door under focus, and `?new=manual`
   * opens "Build it myself". Opening a page never creates a form: that waits for a press.
   */
  const [params] = useSearchParams();
  const door = params.get('new');
  const creating = door === 'manual' ? 'manual' : null;
  // New form is a page of its own (`/forms/new`); an old `?new=…` address lands there.
  useEffect(() => {
    if (params.has('new') && door !== 'manual') {
      navigate(`/forms/new${door ? `?door=${door}` : ''}`, { replace: true });
    }
  }, [params, door, navigate]);
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

  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    setForms(null);
    setFailed(false);
    client
      .listForms(scope)
      .then((result) => setForms(result.forms))
      // Not `[]`: "no forms yet" after a failed request invites making one twice.
      .catch(() => setFailed(true));
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
      const created = await client.createForm({
        slug,
        title: { [locales.default]: title },
        ...(templateId ? { templateId } : {}),
      });
      // Straight into the editor, as the other doors go: a form made by hand is for editing.
      navigate(`/forms/${created.id}`);
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

  /** Starts that went nowhere, moved to the bin together after one question (reversible). */
  async function clearAbandoned(list: readonly FormResponse[]) {
    if (
      !(await confirm(t('forms.confirmAbandoned', { count: list.length }), {
        confirmLabel: t('forms.trash'),
      }))
    ) {
      return;
    }
    for (const form of list) await client.trashForm(form.id);
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
        <span className="row">
          {/* What the guided builder has been taught here: an administrator's to look after. */}
          {user?.role === 'admin' && (
            <Link className="button button--bare small" to="/forms/phrases">
              {t('phrases.title')}
            </Link>
          )}
          <Link className="button button--quiet" to="/forms/pdf">
            {t('fill.pdfHeading')}
          </Link>
          <button className="button" onClick={() => navigate('/forms/new')}>
            {t('forms.new')}
          </button>
        </span>
      </header>

      <ScopeTabs scopes={scopes} current={scope} onChange={setScope} label={t('forms.title')} />

      {creating === 'manual' && (
        <form className="card stack" onSubmit={create}>
          <div className="stack">
            <Banner name="foil" className="banner--thin" />
            <strong className="small">{t('templates.heading')}</strong>
            <p className="small muted">{t('templates.intro')}</p>

            <div className="templates">
              <TemplateCard
                kind="blank"
                selected={templateId === null}
                name={t('templates.blank')}
                description={t('templates.blankHint')}
                onSelect={() => setTemplateId(null)}
              />
              {/*
                Resolved against `interfaceLocales`, not `locales`.

                A template's name is **ours**, shipped in all twelve languages — not the
                customer's content. Resolving it against the organisation's publish languages
                meant an operator reading the app in Japanese, in an organisation that publishes
                in Swedish and English, got a gallery of Swedish template names under Japanese
                headings. The Japanese names existed the whole time; nothing was asking for them.

                Everything else on this screen keeps `locales`, because form titles and event
                names really are the organisation's content and really are limited to the
                languages it publishes in.
              */}
              {templates.map((template) => (
                <TemplateCard
                  key={template.id}
                  kind={template.id}
                  selected={templateId === template.id}
                  name={pickText(interfaceLocales, template.name, locale).value}
                  description={pickText(interfaceLocales, template.description, locale).value}
                  fieldCount={template.definition.fields.length}
                  onSelect={() => {
                    setTemplateId(template.id);
                    /*
                     * A title saves a step; it is editable like anything else.
                     *
                     * Seeded in the language of the card that was just clicked, rather than the
                     * organisation's default: clicking a card and getting a title box in a third
                     * language is the kind of surprise that makes people distrust the whole
                     * screen. They can edit it, and usually will.
                     */
                    if (!title) setTitle(pickText(interfaceLocales, template.name, locale).value);
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

      {scope === 'mine' &&
        forms &&
        user &&
        abandonedDrafts(forms, user.id, Date.now()).length > 0 && (
          <p className="row small muted" role="status">
            {t('forms.abandoned', { count: abandonedDrafts(forms, user.id, Date.now()).length })}
            <button
              type="button"
              className="button button--bare small"
              onClick={() => void clearAbandoned(abandonedDrafts(forms, user.id, Date.now()))}
            >
              {t('forms.trash')}
            </button>
          </p>
        )}

      {failed && <LoadFailed onRetry={load} />}
      {!failed && forms === null && <Loading />}
      {forms?.length === 0 && (
        <EmptyState
          icon={scope === 'trash' ? 'trash' : 'forms'}
          {...(scope === 'mine' ? { media: 'forms' as const } : {})}
          title={empty}
          /*
           * The bin offers nothing: "create a form" is not what somebody looking at an empty bin
           * came to do, and an action that ignores where you are is worse than none.
           */
          action={
            scope === 'trash' ? undefined : (
              <button className="button" onClick={() => navigate('/forms/new')}>
                {t('forms.new')}
              </button>
            )
          }
        />
      )}

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
  kind,
  selected,
  name,
  description,
  fieldCount,
  onSelect,
}: {
  /** The template's id, or "blank": picks the drawing on the card. */
  kind: string;
  selected: boolean;
  name: string;
  description: string;
  fieldCount?: number;
  onSelect: () => void;
}) {
  const t = useT();
  return (
    <label className="template">
      <TemplateCover kind={kind} />
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

/**
 * A card's cover: a small drawing of the form, made from the tokens, not a picture. The shapes say
 * what the form asks (a few fields, a choice, a rating, a long answer) so the gallery can be
 * scanned without reading; the name and description beside it still say it in words.
 */
/** The templates with a drawing of their own; every other one gets the plain three-field page. */
const KNOWN_COVERS = new Set([
  'blank',
  'event-registration',
  'rsvp',
  'contact-enquiry',
  'customer-feedback',
]);

function TemplateCover({ kind }: { kind: string }) {
  const field = (y: number, w = 96) => (
    <rect key={y} className="tc__field" x="12" y={y} width={w} height="9" rx="2" />
  );
  const dots = (y: number, count: number) =>
    Array.from({ length: count }, (_, i) => (
      <circle
        key={i}
        className={i === 0 ? 'tc__dot tc__dot--on' : 'tc__dot'}
        cx={18 + i * 16}
        cy={y}
        r="5"
      />
    ));
  return (
    <svg className="template__cover" viewBox="0 0 120 64" aria-hidden="true" focusable="false">
      <rect className="tc__page" x="1" y="1" width="118" height="62" rx="4" />
      {kind !== 'blank' && <rect className="tc__head" x="12" y="8" width="44" height="6" rx="2" />}
      {(kind === 'event-registration' || !KNOWN_COVERS.has(kind)) && [
        field(20),
        field(33),
        field(46, 60),
      ]}
      {kind === 'rsvp' && [...dots(25, 2), field(38, 64), field(50, 40)]}
      {kind === 'contact-enquiry' && [
        field(20),
        field(33),
        <rect key="m" className="tc__field" x="12" y="46" width="96" height="12" rx="2" />,
      ]}
      {kind === 'customer-feedback' && [
        ...dots(26, 5),
        <rect key="m" className="tc__field" x="12" y="38" width="96" height="20" rx="2" />,
      ]}
      {kind === 'blank' && <rect className="tc__cursor" x="12" y="12" width="2" height="12" />}
    </svg>
  );
}
