import { useState } from 'react';
import { importSurveyJson, type FormDefinition, type SkippedQuestion } from '@tp/shared/forms';
import { useT } from '../../lib/i18n.js';
import { Icon } from '../../components/Icon.js';

/**
 * Bring a SurveyJS survey in as a form.
 *
 * `packages/shared/src/forms/import-surveyjs.ts` has done the mapping since the phase that added
 * it, and until now nothing could reach it: a tested function with no way in is a feature nobody
 * has. This is the way in.
 *
 * ## Pasted, not uploaded
 *
 * A survey is JSON, and JSON is something you can select and copy. Taking it as text needs no
 * upload endpoint, no storage, no retention decision and no size limit beyond what a textarea
 * already implies — none of which this feature would be improved by having. The PDF importer is
 * the one that genuinely needs a file, and it is waiting on exactly those decisions.
 *
 * ## Why it shows what it will do before doing it
 *
 * Importing **replaces the draft**. `CLAUDE.md` rule 7 — nothing deletes without a confirmation
 * step — so the paste is mapped first and the result described: how many questions arrived, and
 * which ones did not survive and why. Pressing the button after reading that is the confirmation.
 *
 * Mapping twice is deliberate. `importSurveyJson` is pure, so running it for the preview costs
 * nothing that matters and guarantees the summary describes the definition that is actually
 * applied — a preview computed from a different call is a preview that can lie.
 */
export function ImportSurvey({ onImport }: { onImport: (definition: FormDefinition) => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');

  /** The mapping, or the reason the paste is not a survey. Recomputed as they type. */
  const preview = previewOf(text);

  function apply() {
    if (!preview.ok) return;
    onImport(preview.definition);
    setOpen(false);
    setText('');
  }

  if (!open) {
    return (
      <button type="button" className="button button--quiet" onClick={() => setOpen(true)}>
        <Icon name="upload" />
        {t('import.open')}
      </button>
    );
  }

  return (
    <div className="card stack import">
      <div className="row row--between">
        <strong>{t('import.heading')}</strong>
        <button
          type="button"
          className="button button--quiet button--icon"
          onClick={() => setOpen(false)}
          aria-label={t('import.cancel')}
        >
          <Icon name="close" />
        </button>
      </div>

      <p className="small muted">{t('import.explain')}</p>

      <label className="field">
        <span>{t('import.paste')}</span>
        <textarea
          rows={8}
          value={text}
          onChange={(event) => setText(event.target.value)}
          spellCheck={false}
          placeholder={'{ "pages": [ … ] }'}
        />
      </label>

      {/*
        The summary is `role="status"` rather than silent: it changes as somebody pastes, and a
        screen reader user pressing the button deserves to have heard what it is about to do.
      */}
      <div className="stack small" role="status">
        {text.trim() === '' ? null : !preview.ok ? (
          <span className="status-down">{t('import.notASurvey')}</span>
        ) : (
          <>
            <span className={preview.count > 0 ? 'status-up' : 'status-warning'}>
              {t('import.willImport', { n: preview.count })}
            </span>
            {preview.skipped.length > 0 && (
              <>
                <span className="status-warning">
                  {t('import.willSkip', { n: preview.skipped.length })}
                </span>
                {/*
                  Named one by one, not counted.
                  "3 questions were skipped" tells an author to go hunting. The reasons are the
                  whole point of the importer reporting rather than guessing, so they are shown.
                */}
                <ul className="import__skipped">
                  {preview.skipped.map((entry, at) => (
                    <li key={at}>
                      {entry.name || entry.type} — {t(`import.reason.${entry.reason}`)}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </div>

      {/*
        Rule 7's confirmation. The warning is stated at the moment of the decision rather than in
        the help text above, because that is where somebody is looking.
      */}
      <p className="small status-warning">{t('import.replaces')}</p>

      <div className="row">
        <button
          type="button"
          className="button"
          onClick={apply}
          disabled={!preview.ok || preview.count === 0}
        >
          {t('import.confirm')}
        </button>
        <button type="button" className="button button--quiet" onClick={() => setOpen(false)}>
          {t('import.cancel')}
        </button>
      </div>
    </div>
  );
}

type Preview =
  | { ok: false }
  | { ok: true; definition: FormDefinition; count: number; skipped: SkippedQuestion[] };

/**
 * What this paste would produce.
 *
 * Both the JSON parse and the import can throw on a document somebody pasted — the first on
 * anything that is not JSON, the second on JSON that is not a survey — and neither is an error
 * worth showing a stack trace for. Somebody pasting into a box is allowed to paste the wrong
 * thing, and the honest answer is "this is not a survey", not a crash.
 */
function previewOf(text: string): Preview {
  if (text.trim() === '') return { ok: false };
  try {
    const { definition, skipped } = importSurveyJson(JSON.parse(text));
    return { ok: true, definition, count: definition.fields.length, skipped };
  } catch {
    return { ok: false };
  }
}
