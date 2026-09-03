import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { translatableTexts } from '@tp/shared/forms';
import type {
  Field,
  FieldType,
  FormDefinition,
  FormResponse,
  FormVersionSummary,
} from '@tp/shared/forms';
import { ApiError, client } from '../../lib/api.js';
import { useT } from '../../lib/i18n.js';
import { useSession } from '../../lib/session.js';
import { useConfirm } from '../../components/Confirm.js';
import { FieldCanvas } from './FieldCanvas.js';
import { FieldProperties } from './FieldProperties.js';
import { PALETTE_GROUPS, newField, uniqueKey } from './field-defaults.js';
import { FormPreview } from './FormPreview.js';
import { FormSettingsPanel } from './FormSettingsPanel.js';
import { useHistory } from './use-history.js';
import { Icon } from '../../components/Icon.js';
import { Loading } from '../../components/Loading.js';

type SaveState = 'saved' | 'saving' | 'unsaved';

const AUTOSAVE_DELAY_MS = 800;

const PREVIEW_WIDTH_KEY = 'tp.builder.previewWidth';

/** Neither pane may be squeezed to the point of being useless. */
function clampWidth(width: number): number {
  return Math.min(720, Math.max(260, Math.round(width)));
}

export function FormBuilder() {
  const t = useT();
  const confirm = useConfirm();
  const { locale, locales } = useSession();
  const { id } = useParams();
  const [form, setForm] = useState<FormResponse | null>(null);
  const [definition, setDefinition] = useState<FormDefinition | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [versions, setVersions] = useState<FormVersionSummary[]>([]);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const history = useHistory();

  /**
   * Width of the preview pane, in pixels, remembered between visits.
   *
   * `localStorage` rather than the brand kit: this is how one person likes to work, not something
   * about the organisation, and it should not follow them onto a colleague's screen.
   */
  const [previewWidth, setPreviewWidth] = useState(() => {
    const stored = Number(localStorage.getItem(PREVIEW_WIDTH_KEY));
    return Number.isFinite(stored) && stored > 0 ? clampWidth(stored) : 368;
  });

  useEffect(() => {
    localStorage.setItem(PREVIEW_WIDTH_KEY, String(previewWidth));
  }, [previewWidth]);

  /**
   * Ctrl+Z and Ctrl+Shift+Z, plus Ctrl+Y for the Windows habit.
   *
   * **Not while a text box has focus.** The browser's own undo inside an input is what somebody
   * pressing Ctrl+Z mid-word wants; stealing it to roll back the whole form would be startling and
   * would take a keystroke away that has no other equivalent. So the shortcut applies only when
   * focus is somewhere structural.
   */
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!event.ctrlKey && !event.metaKey) return;
      const key = event.key.toLowerCase();
      if (key !== 'z' && key !== 'y') return;

      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;

      event.preventDefault();
      stepHistory(key === 'y' || event.shiftKey ? 'redo' : 'undo');
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  function startResize(event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = previewWidth;

    const move = (moved: PointerEvent) => {
      // Dragging left grows the preview, which is the direction the divider moves.
      setPreviewWidth(clampWidth(startWidth + (startX - moved.clientX)));
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
  }

  const loadVersions = useCallback(() => {
    if (!id) return;
    client
      .listFormVersions(id)
      .then((result) => setVersions(result.versions))
      .catch(() => setVersions([]));
  }, [id]);

  useEffect(() => {
    if (!id) return;
    client.getForm(id).then((loaded) => {
      setForm(loaded);
      setDefinition(loaded.draftDefinition);
      // Otherwise Ctrl+Z on the second form walks back into the first one's edits.
      history.reset();
    });
    loadVersions();
  }, [id, loadVersions]);

  // Autosave. The timer resets on every edit, so a burst of typing is one request, not thirty.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!id || !definition || saveState !== 'unsaved') return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setSaveState('saving');
      client
        .saveDraft(id, definition)
        .then((saved) => {
          setForm(saved);
          setSaveState('saved');
        })
        .catch((cause: unknown) => {
          setSaveState('unsaved');
          setError(cause instanceof Error ? cause.message : String(cause));
        });
    }, AUTOSAVE_DELAY_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [id, definition, saveState]);

  function edit(next: FormDefinition) {
    if (definition) history.record(definition, next);
    setDefinition(next);
    setSaveState('unsaved');
    setError(null);
  }

  /**
   * Step back, or forward.
   *
   * Goes through `setDefinition` rather than `edit`, or undoing would record itself as another
   * edit and the stack would never empty. The save state is set by hand for the same reason: the
   * form on the server no longer matches, so it is unsaved, and autosave takes it from there.
   */
  function stepHistory(direction: 'undo' | 'redo') {
    if (!definition) return;
    const target = direction === 'undo' ? history.undo(definition) : history.redo(definition);
    if (!target) return;
    setDefinition(target);
    setSaveState('unsaved');
    // A field that no longer exists must not stay selected, or the properties panel edits a ghost.
    if (selectedId && !target.fields.some((field) => field.id === selectedId)) setSelectedId(null);
  }

  /**
   * A new field lands **after the one being worked on**, not at the end of the form.
   *
   * Appending was the old behaviour and it is wrong the moment a form is longer than a screen:
   * adding a question in the middle of a section meant scrolling to the bottom and dragging it
   * back up, every time. With nothing selected, appending is still the right guess.
   */
  function addField(type: FieldType) {
    if (!definition) return;
    const field = newField(
      type,
      definition.fields.map((existing) => existing.key),
      locale,
    );

    const at = definition.fields.findIndex((existing) => existing.id === selectedId);
    const fields = [...definition.fields];
    fields.splice(at === -1 ? fields.length : at + 1, 0, field);

    edit({ ...definition, fields });
    setSelectedId(field.id);
  }

  /**
   * Copy a field, directly below the original.
   *
   * Long forms repeat themselves — five questions with the same five options, a block of contact
   * details asked once per guest — and rebuilding each one by hand is where a form builder starts
   * feeling like data entry.
   *
   * The copy gets a new id and a new key: sharing either would silently merge two questions'
   * answers into one column, which is the kind of defect nobody finds until the export.
   */
  function duplicateField(fieldId: string) {
    if (!definition) return;
    const at = definition.fields.findIndex((field) => field.id === fieldId);
    if (at === -1) return;

    const original = definition.fields[at]!;
    const copy = {
      ...structuredClone(original),
      id: crypto.randomUUID(),
      key: uniqueKey(
        original.key,
        definition.fields.map((field) => field.key),
      ),
    } as Field;

    const fields = [...definition.fields];
    fields.splice(at + 1, 0, copy);
    edit({ ...definition, fields });
    setSelectedId(copy.id);
  }

  /** Reorder without dragging: a touch screen and a keyboard both need this. */
  function moveField(fieldId: string, direction: -1 | 1) {
    if (!definition) return;
    const from = definition.fields.findIndex((field) => field.id === fieldId);
    const to = from + direction;
    if (from === -1 || to < 0 || to >= definition.fields.length) return;

    const fields = [...definition.fields];
    const [moved] = fields.splice(from, 1);
    fields.splice(to, 0, moved!);
    edit({ ...definition, fields });
  }

  function updateField(updated: Field) {
    if (!definition) return;
    edit({
      ...definition,
      fields: definition.fields.map((field) => (field.id === updated.id ? updated : field)),
    });
  }

  /**
   * Rule 7's confirmation for this action lives in `FieldCanvas`: pressing Remove swaps the button
   * for an inline "Yes, remove", rather than opening a modal. Deliberate — a modal for every field
   * you delete while laying out a form is the friction that makes a builder tiring, and the inline
   * one is just as much a deliberate second press.
   *
   * Undo backs it up but does not replace it: undo lives in memory, so deleting a field, letting
   * the 800ms autosave fire and reloading loses it for good — version history only restores what
   * was *published*.
   */
  function removeField(fieldId: string) {
    if (!definition) return;
    edit({ ...definition, fields: definition.fields.filter((field) => field.id !== fieldId) });
    if (selectedId === fieldId) setSelectedId(null);
  }

  async function publish() {
    if (!id) return;
    setPublishing(true);
    setError(null);
    try {
      const published = await client.publishForm(id);
      setForm(published);
      loadVersions();
    } catch (cause) {
      // Missing translations are not an error to swallow: the operator is offered the override
      // that SPEC-shared.md requires to be explicit.
      if (cause instanceof ApiError && cause.code === 'translations-incomplete') {
        const missing = (form?.completeness ?? [])
          .filter((entry) => !entry.complete)
          .map((entry) => entry.locale)
          .join(', ');
        if (
          await confirm(t('builder.overrideBody', { locales: missing }), {
            confirmLabel: t('builder.publish'),
            danger: false,
          })
        ) {
          const published = await client.publishForm(id, true);
          setForm(published);
          loadVersions();
        }
      } else {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    } finally {
      setPublishing(false);
    }
  }

  async function restore(version: number) {
    if (!id) return;
    if (!(await confirm(t('builder.restoreConfirm', { n: version })))) return;
    const restored = await client.restoreFormVersion(id, version);
    setForm(restored);
    setDefinition(restored.draftDefinition);
    setSaveState('saved');
  }

  if (!form || !definition) return <Loading />;

  /**
   * A language is only worth warning about once somebody has started writing in it.
   *
   * The organisation supports two locales, so every form used to be reported as incomplete in the
   * second one whether or not anybody ever intended to publish it there — which made the
   * indicator noise rather than information. Adding a language is now a deliberate act (the plus
   * beside each text), and this is the same decision read back: a locale with no text anywhere is
   * one nobody has asked for, and an untranslated string falls back when the form is rendered.
   */
  const started = new Set<string>([locales.default]);
  for (const text of translatableTexts(definition)) {
    for (const [candidate, value] of Object.entries(text.text)) {
      if (value) started.add(candidate);
    }
  }
  const incomplete = form.completeness.filter(
    (entry) => !entry.complete && started.has(entry.locale),
  );

  return (
    <section className="stack">
      <header className="row row--between">
        <div>
          <h1>{form.title['sv-SE'] ?? form.slug}</h1>
          <p className="small muted">
            /f/{form.slug} ·{' '}
            {form.publishedVersion
              ? t('forms.version', { n: form.publishedVersion })
              : t('forms.unpublished')}
          </p>
        </div>
        <div className="row">
          {/* Icon-only: two buttons that say "Undo" and "Redo" crowd out the one that publishes,
              and the arrows are the most recognisable pair of glyphs in any editor. */}
          <button
            type="button"
            className="button button--quiet button--icon"
            onClick={() => stepHistory('undo')}
            disabled={!history.canUndo}
            title={t('builder.undo')}
            aria-label={t('builder.undo')}
          >
            <Icon name="undo" />
          </button>
          <button
            type="button"
            className="button button--quiet button--icon"
            onClick={() => stepHistory('redo')}
            disabled={!history.canRedo}
            title={t('builder.redo')}
            aria-label={t('builder.redo')}
          >
            <Icon name="redo" />
          </button>

          <span className="small muted">{t(`builder.${saveState}`)}</span>
          <button
            className="button"
            onClick={publish}
            disabled={publishing || saveState !== 'saved'}
          >
            <Icon name="publish" />
            {publishing ? t('builder.publishing') : t('builder.publish')}
          </button>
        </div>
      </header>

      {error && <p className="status-down small">{error}</p>}

      <p className="small">
        {incomplete.length === 0 ? (
          <span className="status-up">{t('builder.translationsComplete')}</span>
        ) : (
          <span className="status-warning">
            {incomplete
              .map((entry) =>
                t('builder.translationsMissing', {
                  locale: entry.locale,
                  n: entry.missing.length,
                }),
              )
              .join(' · ')}
          </span>
        )}
      </p>

      {form.problems.length > 0 && (
        <p className="small status-down">
          {/* Translated by code — `problem.message` is English, for logs and API clients. */}
          {form.problems.map((problem) => t(`problem.${problem.code}`, problem.params)).join('; ')}
        </p>
      )}

      <div
        className="builder"
        style={{ gridTemplateColumns: `minmax(0, 1fr) 6px minmax(0, ${previewWidth}px)` }}
      >
        <div className="stack">
          <div className="card stack builder__tools">
            <strong className="small">{t('builder.palette')}</strong>
            {PALETTE_GROUPS.map((group) => (
              <div className="stack" key={group.id}>
                <span className="small muted">{t(`palette.${group.id}`)}</span>
                <div className="builder__palette">
                  {group.types.map((type) => (
                    <button
                      key={type}
                      type="button"
                      className="button button--quiet small"
                      onClick={() => addField(type)}
                    >
                      <Icon name={type} />
                      {t(`fieldType.${type}`)}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <span className="small muted">{t('builder.addHint')}</span>
          </div>

          <div className="card builder__canvas">
            <FieldCanvas
              fields={definition.fields}
              selectedId={selectedId}
              onSelect={(fieldId) => setSelectedId(fieldId === selectedId ? null : fieldId)}
              onReorder={(fields) => edit({ ...definition, fields })}
              onRemove={removeField}
              onMove={moveField}
              onDuplicate={duplicateField}
              renderEditor={(field) => (
                <FieldProperties field={field} definition={definition} onChange={updateField} />
              )}
            />
          </div>
        </div>

        {/*
          The preview is not a tab any more. It is the right-hand side of the screen, always on,
          because the question a builder answers all day is "what does this look like?" — and an
          answer you have to click for is one you stop asking for.
        */}
        {/*
          The divider is a real control, not decoration: a form with long labels wants a wide
          preview, and a form being reordered wants a wide list. Both are the same person ten
          minutes apart, so the split is theirs to set rather than ours to guess.

          It is a slider for the keyboard as well as a drag handle for the mouse — a resize nobody
          can do without a pointer is a resize half the people cannot do.
        */}
        <div
          className="builder__divider"
          role="separator"
          aria-orientation="vertical"
          aria-label={t('builder.resize')}
          tabIndex={0}
          onPointerDown={startResize}
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft') setPreviewWidth((width) => clampWidth(width + 32));
            if (event.key === 'ArrowRight') setPreviewWidth((width) => clampWidth(width - 32));
          }}
        />

        <aside className="card stack builder__panel">
          <strong className="small row">
            <Icon name="preview" />
            {t('builder.viewPreview')}
          </strong>
          <FormPreview
            definition={definition}
            locale={locale}
            locales={locales}
            selectedId={selectedId}
          />
        </aside>
      </div>

      {/* The table itself moved to `/forms/:id/submissions`. What belongs at the foot of the
          editor is the way there, not forty rows of other people's answers. */}
      {id && form.publishedVersion !== null && (
        <section className="card row row--between">
          <strong className="small">
            <Icon name="inbox" className="icon--lead" />
            {t('forms.responses', { count: form.submissionCount })}
          </strong>
          <Link className="button button--quiet" to={`/forms/${id}/submissions`}>
            {t('forms.viewResponses')}
            <Icon name="arrow-right" className="icon--lead" />
          </Link>
        </section>
      )}

      <FormSettingsPanel definition={definition} onChange={edit} />

      <section className="card stack">
        <strong className="small">{t('builder.history')}</strong>
        {versions.length === 0 && <p className="muted small">{t('forms.unpublished')}</p>}
        {versions.map((version) => (
          <div className="row row--between" key={version.id}>
            <span className="small">
              {t('forms.version', { n: version.version })}
              {version.publishedAt ? ` · ${new Date(version.publishedAt).toLocaleString()}` : ''}
            </span>
            <button className="button button--quiet small" onClick={() => restore(version.version)}>
              {t('builder.restore')}
            </button>
          </div>
        ))}
      </section>
    </section>
  );
}
