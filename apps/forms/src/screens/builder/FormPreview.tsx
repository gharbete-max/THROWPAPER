import { useEffect, useState } from 'react';
import type { LocaleConfig } from '@tp/i18n';
import {
  pagesOf,
  type AnswerValue,
  type FormDefinition,
  type SubmissionValues,
} from '@tp/shared/forms';
import { FieldInput } from '../../components/FieldInput.js';
import { useT } from '../../lib/i18n.js';

/**
 * The form as the person filling it in will see it.
 *
 * This is the answer to "what am I actually building?", which the builder previously had no way of
 * telling anybody: you laid out abstract rows and found out what they looked like by publishing.
 *
 * It renders the **same `FieldInput`** the public page does, so it cannot drift into a flattering
 * lie. It is interactive on purpose — an author should be able to tap their own cards and see the
 * selected state, because "does this read clearly" is not a question a static picture answers.
 * Nothing is submitted and nothing is stored; the values live here and die with the screen.
 */
export function FormPreview({
  definition,
  locale,
  locales,
  selectedId,
}: {
  definition: FormDefinition;
  locale: string;
  locales: LocaleConfig;
  /** Highlighted so it is obvious which row in the list is which question on the page. */
  selectedId: string | null;
}) {
  const t = useT();
  const [values, setValues] = useState<SubmissionValues>({});
  const [page, setPage] = useState(0);

  const pages = pagesOf(definition);
  const current = Math.min(page, pages.length - 1);
  const fields = pages[current] ?? [];

  /**
   * Follow the selection onto its own page.
   *
   * Without this, selecting a question on page two and switching to the preview showed page one
   * with nothing highlighted — the preview appeared not to know what was selected, which is worse
   * than having no highlight at all.
   */
  useEffect(() => {
    if (!selectedId) return;
    const at = pagesOf(definition).findIndex((fieldsOnPage) =>
      fieldsOnPage.some((field) => field.id === selectedId),
    );
    if (at !== -1) setPage(at);
  }, [selectedId, definition]);

  function setValue(key: string, value: AnswerValue) {
    setValues((previous) => ({ ...previous, [key]: value }));
  }

  if (definition.fields.length === 0) {
    return <p className="muted small">{t('preview.empty')}</p>;
  }

  return (
    <div className="preview">
      <div className="preview__page">
        {pages.length > 1 && (
          <p className="small muted">
            {t('preview.page', { current: current + 1, total: pages.length })}
          </p>
        )}

        {fields.map((field) => (
          <div
            key={field.id}
            className={
              field.id === selectedId ? 'preview__field preview__field--selected' : 'preview__field'
            }
          >
            <FieldInput
              field={field}
              locale={locale}
              locales={locales}
              value={values[field.key] ?? null}
              error={null}
              chooseLabel={t('public.choose')}
              yesLabel={t('public.yes')}
              noLabel={t('public.no')}
              onChange={setValue}
            />
          </div>
        ))}

        {pages.length > 1 && (
          <div className="row">
            <button
              type="button"
              className="button button--quiet small"
              disabled={current === 0}
              onClick={() => setPage(current - 1)}
            >
              {t('public.back')}
            </button>
            <button
              type="button"
              className="button button--quiet small"
              disabled={current >= pages.length - 1}
              onClick={() => setPage(current + 1)}
            >
              {t('public.next')}
            </button>
          </div>
        )}
      </div>

      {/* Said plainly, because an interactive preview invites the assumption that it saves. */}
      <p className="small muted">{t('preview.note')}</p>
    </div>
  );
}
