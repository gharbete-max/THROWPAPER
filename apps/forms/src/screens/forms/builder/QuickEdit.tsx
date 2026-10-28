import { useState } from 'react';
import type { Field, FormDefinition } from '@tp/shared/forms';
import { useSession } from '../../../lib/session.js';
import { useT } from '../../../lib/i18n.js';
import { hasLabel, hasOptions, newOption } from './field-defaults.js';
import { LocalisedField } from './LocalisedField.js';
import { FieldProperties } from './FieldProperties.js';

/**
 * The few settings a first-timer needs beside a piece: its words, whether it is required, its
 * choices. Everything else is today's full panel, one press away (`docs/plan/EASY.md`, E3).
 */
export function QuickEdit({
  field,
  definition,
  onChange,
}: {
  field: Field;
  definition: FormDefinition;
  onChange: (field: Field) => void;
}) {
  const t = useT();
  const { contentLocale: locale, locales } = useSession();
  const [full, setFull] = useState(false);
  const patch = (changes: Partial<Field>) => onChange({ ...field, ...changes } as Field);

  return (
    <div className="stack quickedit">
      {full ? (
        <FieldProperties field={field} definition={definition} onChange={onChange} />
      ) : (
        <>
          {hasLabel(field) && (
            <LocalisedField
              label={t('field.label')}
              value={field.label}
              locale={locale}
              supported={locales.supported}
              placeholder={t('field.labelPlaceholder')}
              onChange={(target, text) =>
                patch({ label: { ...field.label, [target]: text } } as Partial<Field>)
              }
            />
          )}
          {'required' in field && (
            <label className="row">
              <input
                type="checkbox"
                checked={field.required}
                onChange={(event) => patch({ required: event.target.checked } as Partial<Field>)}
              />
              <span>{t('field.required')}</span>
            </label>
          )}
          {hasOptions(field) && (
            <div className="stack">
              {field.options.map((option, index) => (
                <LocalisedField
                  key={index}
                  label={t('field.optionLabel')}
                  value={option.label}
                  locale={locale}
                  supported={locales.supported}
                  onChange={(target, text) => {
                    const options = [...field.options];
                    options[index] = { ...option, label: { ...option.label, [target]: text } };
                    patch({ options } as Partial<Field>);
                  }}
                />
              ))}
              <button
                type="button"
                className="button button--quiet small"
                onClick={() =>
                  patch({
                    options: [...field.options, newOption(field.options.length + 1, locale)],
                  } as Partial<Field>)
                }
              >
                {t('field.addOption')}
              </button>
            </div>
          )}
        </>
      )}
      <button
        type="button"
        className="button button--quiet small"
        aria-expanded={full}
        onClick={() => setFull(!full)}
      >
        {full ? t('eb.fewer') : t('eb.moreOptions')}
      </button>
    </div>
  );
}
