import { useState } from 'react';
import {
  MULTI_SELECT_APPEARANCES,
  SINGLE_SELECT_APPEARANCES,
  YES_NO_APPEARANCES,
  type Field,
} from '@tp/shared/forms';
import { useSession } from '../../lib/session.js';
import { useT } from '../../lib/i18n.js';
import { hasLabel, hasOptions } from './field-defaults.js';

interface Props {
  field: Field | null;
  onChange: (field: Field) => void;
}

/**
 * Right-hand panel: properties and the translation tab.
 *
 * `SPEC-forms.md` §3 asks for "a translation tab covering every text property per locale". Every
 * text property here is edited per locale rather than in one box, which is why the completeness
 * indicator can be trusted.
 */
export function FieldProperties({ field, onChange }: Props) {
  const t = useT();
  const { locales } = useSession();
  const [tab, setTab] = useState<'properties' | 'translations'>('properties');

  if (!field) return <p className="muted small">{t('builder.selectField')}</p>;

  function patch(changes: Partial<Field>) {
    onChange({ ...(field as Field), ...changes } as Field);
  }

  function setText(
    property: 'label' | 'helpText' | 'placeholder' | 'content',
    locale: string,
    value: string,
  ) {
    const current =
      (field as unknown as Record<string, Record<string, string> | undefined>)[property] ?? {};
    patch({ [property]: { ...current, [locale]: value } } as Partial<Field>);
  }

  return (
    <div className="stack">
      <div className="row builder__tabs">
        <button
          type="button"
          className={tab === 'properties' ? 'button small' : 'button button--quiet small'}
          onClick={() => setTab('properties')}
        >
          {t('builder.tabProperties')}
        </button>
        <button
          type="button"
          className={tab === 'translations' ? 'button small' : 'button button--quiet small'}
          onClick={() => setTab('translations')}
        >
          {t('builder.tabTranslations')}
        </button>
      </div>

      {tab === 'properties' ? (
        <div className="stack">
          <label className="field">
            <span>{t('field.key')}</span>
            <input
              value={field.key}
              onChange={(event) => patch({ key: event.target.value } as Partial<Field>)}
            />
            <span className="small muted">{t('field.keyHint')}</span>
          </label>

          {'required' in field && (
            <label className="field field--inline">
              <input
                type="checkbox"
                checked={field.required}
                onChange={(event) => patch({ required: event.target.checked } as Partial<Field>)}
              />
              <span>{t('field.required')}</span>
            </label>
          )}

          {'appearance' in field && (
            <label className="field">
              <span>{t('field.appearance')}</span>
              <select
                value={field.appearance}
                onChange={(event) => patch({ appearance: event.target.value } as Partial<Field>)}
              >
                {appearances(field)?.map((option) => (
                  <option key={option} value={option}>
                    {t(`field.appearance.${option}`)}
                  </option>
                ))}
              </select>
              <span className="small muted">{t('field.appearanceHint')}</span>
            </label>
          )}

          {field.type === 'hidden' && (
            <label className="field">
              <span>{t('field.fromParameter')}</span>
              <input
                value={field.fromParameter ?? ''}
                onChange={(event) => patch({ fromParameter: event.target.value } as Partial<Field>)}
              />
            </label>
          )}

          {hasOptions(field) && (
            <div className="stack">
              <strong className="small">{t('field.options')}</strong>
              {field.options.map((option, index) => (
                <label className="field" key={index}>
                  <span className="small muted">{t('field.optionValue')}</span>
                  <input
                    value={option.value}
                    onChange={(event) => {
                      const options = [...field.options];
                      options[index] = { ...option, value: event.target.value };
                      patch({ options } as Partial<Field>);
                    }}
                  />
                </label>
              ))}
              <button
                type="button"
                className="button button--quiet small"
                onClick={() =>
                  patch({
                    options: [
                      ...field.options,
                      { value: `option_${field.options.length + 1}`, label: {} },
                    ],
                  } as Partial<Field>)
                }
              >
                {t('field.addOption')}
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="stack">
          {hasLabel(field) &&
            locales.supported.map((locale) => (
              <label className="field" key={`label-${locale}`}>
                <span>
                  {t('field.label')} · {locale}
                </span>
                <input
                  value={field.label[locale] ?? ''}
                  onChange={(event) => setText('label', locale, event.target.value)}
                />
              </label>
            ))}

          {field.type === 'rich_text' &&
            locales.supported.map((locale) => (
              <label className="field" key={`content-${locale}`}>
                <span>
                  {t('field.content')} · {locale}
                </span>
                <textarea
                  rows={3}
                  value={field.content[locale] ?? ''}
                  onChange={(event) => setText('content', locale, event.target.value)}
                />
              </label>
            ))}

          {'helpText' in field &&
            locales.supported.map((locale) => (
              <label className="field" key={`help-${locale}`}>
                <span>
                  {t('field.helpText')} · {locale}
                </span>
                <input
                  value={field.helpText?.[locale] ?? ''}
                  onChange={(event) => setText('helpText', locale, event.target.value)}
                />
              </label>
            ))}

          {'placeholder' in field &&
            locales.supported.map((locale) => (
              <label className="field" key={`placeholder-${locale}`}>
                <span>
                  {t('field.placeholder')} · {locale}
                </span>
                <input
                  value={field.placeholder?.[locale] ?? ''}
                  onChange={(event) => setText('placeholder', locale, event.target.value)}
                />
              </label>
            ))}

          {hasOptions(field) &&
            field.options.map((option, index) =>
              locales.supported.map((locale) => (
                <label className="field" key={`option-${index}-${locale}`}>
                  <span className="small">
                    {option.value} · {locale}
                  </span>
                  <input
                    value={option.label[locale] ?? ''}
                    onChange={(event) => {
                      const options = [...field.options];
                      options[index] = {
                        ...option,
                        label: { ...option.label, [locale]: event.target.value },
                      };
                      patch({ options } as Partial<Field>);
                    }}
                  />
                </label>
              )),
            )}
        </div>
      )}
    </div>
  );
}

/**
 * Which appearances this field may take, or `null` if it is not a choice field.
 *
 * The lists come from the schema rather than being retyped here, so a new appearance shows up in
 * the builder the moment it is allowed by the definition — one place to change, not two.
 */
function appearances(field: Field): readonly string[] | null {
  switch (field.type) {
    case 'single_select':
      return SINGLE_SELECT_APPEARANCES;
    case 'multi_select':
      return MULTI_SELECT_APPEARANCES;
    case 'yes_no':
      return YES_NO_APPEARANCES;
    default:
      return null;
  }
}
