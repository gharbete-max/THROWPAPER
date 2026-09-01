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
import { LocalisedField } from './LocalisedField.js';

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
      {/*
        The question text first, in the language being worked in, with other languages behind a
        plus. Translation is something an author asks for rather than a parallel tab that makes
        every field look unfinished until it is filled in.
      */}
      {hasLabel(field) && (
        <LocalisedField
          label={t('field.label')}
          value={field.label}
          locale={locale}
          supported={locales.supported}
          placeholder={t('field.labelPlaceholder')}
          onChange={(target, text) => setText('label', target, text)}
        />
      )}

      {'helpText' in field && (
        <LocalisedField
          label={t('field.helpText')}
          value={field.helpText}
          locale={locale}
          supported={locales.supported}
          onChange={(target, text) => setText('helpText', target, text)}
        />
      )}

      {field.type === 'rich_text' && (
        <LocalisedField
          label={t('field.content')}
          value={field.content}
          locale={locale}
          supported={locales.supported}
          multiline
          onChange={(target, text) => setText('content', target, text)}
        />
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

      {field.type === 'link' && (
        <div className="stack">
          <label className="field">
            <span>{t('field.href')}</span>
            <input
              type="url"
              inputMode="url"
              placeholder="https://"
              value={field.href}
              onChange={(event) => patch({ href: event.target.value } as Partial<Field>)}
            />
            <span className="small muted">{t('field.hrefHint')}</span>
          </label>

          <label className="field">
            <span>{t('field.linkAppearance')}</span>
            <select
              value={field.appearance}
              onChange={(event) => patch({ appearance: event.target.value } as Partial<Field>)}
            >
              <option value="button">{t('field.linkAppearance.button')}</option>
              <option value="link">{t('field.linkAppearance.link')}</option>
            </select>
          </label>
        </div>
      )}

      {field.type === 'image' && (
        <div className="stack">
          <ImagePicker
            value={field.src || null}
            onChange={(path) => patch({ src: path ?? '' } as Partial<Field>)}
          />

          <LocalisedField
            label={t('image.alt')}
            value={field.alt}
            locale={locale}
            supported={locales.supported}
            hint={t('image.altHint')}
            onChange={(target, text) => setText('alt', target, text)}
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
              <LocalisedField
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
                options: [...field.options, newOption(field.options.length + 1, locale)],
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
