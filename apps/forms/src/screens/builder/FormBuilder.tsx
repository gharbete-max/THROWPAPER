import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router';
import type {
  Field,
  FieldType,
  FormDefinition,
  FormResponse,
  FormVersionSummary,
} from '@tp/shared/forms';
import { ApiError, client } from '../../lib/api.js';
import { useT } from '../../lib/i18n.js';
import { FieldCanvas } from './FieldCanvas.js';
import { FieldProperties } from './FieldProperties.js';
import { PALETTE, newField } from './field-defaults.js';

type SaveState = 'saved' | 'saving' | 'unsaved';

const AUTOSAVE_DELAY_MS = 800;

export function FormBuilder() {
  const t = useT();
  const { id } = useParams();
  const [form, setForm] = useState<FormResponse | null>(null);
  const [definition, setDefinition] = useState<FormDefinition | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [versions, setVersions] = useState<FormVersionSummary[]>([]);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    setDefinition(next);
    setSaveState('unsaved');
    setError(null);
  }

  function addField(type: FieldType) {
    if (!definition) return;
    const field = newField(
      type,
      definition.fields.map((existing) => existing.key),
    );
    edit({ ...definition, fields: [...definition.fields, field] });
    setSelectedId(field.id);
  }

  function updateField(updated: Field) {
    if (!definition) return;
    edit({
      ...definition,
      fields: definition.fields.map((field) => (field.id === updated.id ? updated : field)),
    });
  }

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
        if (window.confirm(t('builder.overrideBody', { locales: missing }))) {
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
    if (!id || !window.confirm(t('builder.restoreConfirm', { n: version }))) return;
    const restored = await client.restoreFormVersion(id, version);
    setForm(restored);
    setDefinition(restored.draftDefinition);
    setSaveState('saved');
  }

  if (!form || !definition) return <p className="muted">{t('app.loading')}</p>;

  const selected = definition.fields.find((field) => field.id === selectedId) ?? null;
  const incomplete = form.completeness.filter((entry) => !entry.complete);

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
          <span className="small muted">{t(`builder.${saveState}`)}</span>
          <button
            className="button"
            onClick={publish}
            disabled={publishing || saveState !== 'saved'}
          >
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
          {form.problems.map((problem) => problem.message).join('; ')}
        </p>
      )}

      <div className="builder">
        <aside className="card stack builder__panel">
          <strong className="small">{t('builder.palette')}</strong>
          {PALETTE.map((type) => (
            <button
              key={type}
              type="button"
              className="button button--quiet small"
              onClick={() => addField(type)}
            >
              {t(`fieldType.${type}`)}
            </button>
          ))}
        </aside>

        <div className="card builder__canvas">
          <FieldCanvas
            fields={definition.fields}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onReorder={(fields) => edit({ ...definition, fields })}
            onRemove={removeField}
          />
        </div>

        <aside className="card stack builder__panel">
          <strong className="small">{t('builder.properties')}</strong>
          <FieldProperties field={selected} onChange={updateField} />
        </aside>
      </div>

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
