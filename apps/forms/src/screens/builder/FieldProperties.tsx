import { useState } from 'react';
import {
  MULTI_SELECT_APPEARANCES,
  SINGLE_SELECT_APPEARANCES,
  YES_NO_APPEARANCES,
  type Field,
} from '@tp/shared/forms';
import { useSession } from '../../lib/session.js';
import { useT } from '../../lib/i18n.js';
import { hasLabel, hasOptions, newOption } from './field-defaults.js';
import { ImagePicker } from '../../components/ImagePicker.js';

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
  const { locale, locales } = useSession();
  const [tab, setTab] = useState<'properties' | 'translations'>('properties');

  if (!field) return <p className="muted small">{t('builder.selectField')}</p>;

  function patch(changes: Partial<Field>) {
    onChange({ ...(field as Field), ...changes } as Field);
  }

  function setText(
    property: 'label' | 'helpText' | 'placeholder' | 'content' | 'alt',
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
          {/*
            The question text comes first, in the language being worked in.

            It used to live only on the translation tab, with the machine key at the top of this
            one — so the first thing an author saw was `full_name`, and writing "What is your
            name?" meant knowing to switch tabs. That is the wrong way round: the label is the
            field as far as anybody except the database is concerned. The other locales stay on
            the translation tab, which is what that tab is for.
          */}
          {/*
            Edited in the language currently being viewed, not the organisation's default.
            Writing to the default would mean an author working in English types English into the
            Swedish slot and sees their own text vanish behind a fallback — so the locale is named
            beside the box rather than assumed.
          */}
          {hasLabel(field) && (
            <label className="field">
              <span>
                {t('field.label')} · {locale}
              </span>
              <input
                autoFocus
                value={field.label[locale] ?? ''}
                onChange={(event) => setText('label', locale, event.target.value)}
                placeholder={t('field.labelPlaceholder')}
              />
              {locales.supported.length > 1 && (
                <span className="small muted">
                  {t('field.labelOtherLocales', { n: locales.supported.length - 1 })}
                </span>
              )}
            </label>
          )}

          {'helpText' in field && (
            <label className="field">
              <span>
                {t('field.helpText')} · {locale}
              </span>
              <input
                value={field.helpText?.[locale] ?? ''}
                onChange={(event) => setText('helpText', locale, event.target.value)}
              />
            </label>
          )}

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

          {field.type === 'image' && (
            <div className="stack">
              <ImagePicker
                value={field.src || null}
                onChange={(path) => patch({ src: path ?? '' } as Partial<Field>)}
              />

              <label className="field">
                <span>{t('image.maxWidth')}</span>
                <input
                  type="number"
                  min={40}
                  max={2000}
                  value={field.maxWidth ?? ''}
                  onChange={(event) =>
                    patch({
                      maxWidth: event.target.value ? Number(event.target.value) : undefined,
                    } as Partial<Field>)
                  }
                />
              </label>
            </div>
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
                <div className="stack builder__option" key={index}>
                  {/*
                    The text people read, first — the same fix as the field label. This box used to
                    show only `option.value`, the machine name, with the visible wording on the
                    translation tab, so writing "Vegetarian" meant knowing to go and look for it.
                  */}
                  <label className="field">
                    <span className="small muted">
                      {t('field.optionLabel')} · {locale}
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

                  <div className="row row--between">
                    <details className="builder__advanced">
                      <summary className="small muted">{t('field.optionValue')}</summary>
                      <input
                        value={option.value}
                        onChange={(event) => {
                          const options = [...field.options];
                          options[index] = { ...option, value: event.target.value };
                          patch({ options } as Partial<Field>);
                        }}
                      />
                      <span className="small muted">{t('field.optionValueHint')}</span>
                    </details>

                    {/* Removing the last option would leave a choice with nothing to choose. */}
                    {field.options.length > 1 && (
                      <button
                        type="button"
                        className="button button--quiet small"
                        onClick={() => {
                          const options = field.options.filter((_, at) => at !== index);
                          patch({ options } as Partial<Field>);
                        }}
                      >
                        {t('field.removeOption')}
                      </button>
                    )}
                  </div>
                  <ImagePicker
                    compact
                    label={t('image.optionImage')}
                    value={option.image ?? null}
                    onChange={(path) => {
                      const options = [...field.options];
                      options[index] = { ...option, image: path };
                      patch({ options } as Partial<Field>);
                    }}
                  />
                </div>
              ))}
              <button
                type="button"
                className="button button--quiet small"
                onClick={() =>
                  patch({
                    options: [
                      ...field.options,
                      newOption(field.options.length + 1, locales.supported),
                    ],
                  } as Partial<Field>)
                }
              >
                {t('field.addOption')}
              </button>
            </div>
          )}

          {/*
            The key is real and occasionally matters — it is what a CSV column is named and what an
            integration reads — but it is not what somebody is thinking about while writing a form,
            and putting it first made the panel look like a database screen. Folded away, and
            warned about: changing it after answers exist orphans them.
          */}
          <details className="builder__advanced">
            <summary className="small muted">{t('field.advanced')}</summary>
            <label className="field">
              <span>{t('field.key')}</span>
              <input
                value={field.key}
                onChange={(event) => patch({ key: event.target.value } as Partial<Field>)}
              />
              <span className="small muted">{t('field.keyHint')}</span>
            </label>
          </details>
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

          {field.type === 'image' &&
            locales.supported.map((locale) => (
              <label className="field" key={`alt-${locale}`}>
                <span>
                  {t('image.alt')} · {locale}
                </span>
                <input
                  value={field.alt?.[locale] ?? ''}
                  onChange={(event) => setText('alt', locale, event.target.value)}
                />
                <span className="small muted">{t('image.altHint')}</span>
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
