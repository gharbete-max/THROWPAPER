import { useEffect, useState } from 'react';
import { pickText } from '@tp/i18n';
import {
  answerableFields,
  flattenAnswers,
  type FormDefinition,
  type SubmissionResponse,
} from '@tp/shared/forms';
import { client } from '../../../lib/api.js';
import { useSession } from '../../../lib/session.js';
import { useT } from '../../../lib/i18n.js';

/**
 * Picks a form, and gives the centre either its questions or one response's answers as text.
 *
 * This is the one file of the centre that talks to the server, because forms live there. What it
 * fetches flows *into* the centre as a string; nothing the centre holds flows back out
 * (`bundle-split.test.ts`).
 */
export function formText(
  definition: FormDefinition,
  answers: Readonly<Record<string, unknown>> | null,
  label: (key: string, text: Record<string, string>) => string,
): string {
  const flat = answers ? flattenAnswers(definition, answers) : null;
  const lines: string[] = [];
  for (const field of answerableFields(definition)) {
    const heading = label(
      field.key,
      'label' in field ? (field.label as Record<string, string>) : {},
    );
    if (flat === null) {
      lines.push(heading);
      continue;
    }
    const keys =
      field.type === 'repeating_group'
        ? Object.keys(flat).filter((key) => key.startsWith(`${field.key}_`))
        : [field.key];
    for (const key of keys) {
      const value = flat[key];
      if (value === null || value === undefined || value === '') continue;
      const shown = Array.isArray(value) ? value.join(', ') : String(value);
      lines.push(`${keys.length > 1 ? key : heading}: ${shown}`);
    }
  }
  return lines.join('\n');
}

export function FormSource({
  answers,
  onText,
}: {
  answers: boolean;
  onText: (text: string) => void;
}) {
  const t = useT();
  const { locale, locales } = useSession();
  const [forms, setForms] = useState<Array<{
    id: string;
    title: Record<string, string>;
    definition: FormDefinition;
  }> | null>(null);
  const [formId, setFormId] = useState('');
  const [rows, setRows] = useState<SubmissionResponse[] | null>(null);
  const [definition, setDefinition] = useState<FormDefinition | null>(null);
  const [rowId, setRowId] = useState('');

  const label = (key: string, text: Record<string, string>) =>
    pickText(locales, text, locale).value || key;

  useEffect(() => {
    void client.listForms().then((r) =>
      setForms(
        r.forms.map((f) => ({
          id: f.id,
          title: f.title as Record<string, string>,
          definition: f.draftDefinition,
        })),
      ),
    );
  }, []);

  useEffect(() => {
    onText('');
    setRows(null);
    setRowId('');
    const form = forms?.find((f) => f.id === formId);
    if (!form) return;
    setDefinition(form.definition);
    if (!answers) {
      onText(formText(form.definition, null, label));
      return;
    }
    void client.listSubmissions(formId).then((r) => {
      setRows(r.submissions);
      setDefinition(r.definition);
    });
    // `label` and `onText` are stable enough for a pick; re-running on them would reset the pick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formId, answers, forms]);

  useEffect(() => {
    const row = rows?.find((r) => r.id === rowId);
    if (row && definition) onText(formText(definition, row.data, label));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowId]);

  if (forms && forms.length === 0) return <p className="muted">{t('summary.form.none')}</p>;
  return (
    <div className="stack">
      <label className="field">
        {t('summary.form.pick')}
        <select value={formId} onChange={(e) => setFormId(e.target.value)}>
          <option value="" />
          {(forms ?? []).map((f) => (
            <option key={f.id} value={f.id}>
              {label(f.id, f.title)}
            </option>
          ))}
        </select>
      </label>
      {answers && formId && rows ? (
        rows.length === 0 ? (
          <p className="muted">{t('summary.answers.none')}</p>
        ) : (
          <label className="field">
            {t('summary.answers.pick')}
            <select value={rowId} onChange={(e) => setRowId(e.target.value)}>
              <option value="" />
              {rows.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.reference}
                </option>
              ))}
            </select>
          </label>
        )
      ) : null}
    </div>
  );
}
