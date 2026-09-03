import type { FormDefinition, FormSettings } from '@tp/shared/forms';
import { useSession } from '../../lib/session.js';
import { useT } from '../../lib/i18n.js';
import { Icon } from '../../components/Icon.js';
import { LocalisedField } from './LocalisedField.js';
import { Flag } from '../../components/Flag.js';
import { localeLabel } from '@tp/i18n';

/**
 * Settings that belong to the form rather than to any one field.
 *
 * All four of the original ones — the submit button's wording, the thank-you message, duplicate
 * control, save-and-resume — were in the schema, honoured by the public page, and editable
 * nowhere. The submit label in particular was already read by `PublicForm`, so a form could carry
 * a custom one only if something other than the builder had written it.
 *
 * `form-settings.test.ts` compares this panel's list against the schema, the same way
 * `field-properties.test.ts` does for fields, so a new setting cannot arrive unreachable.
 */

/** Every setting this panel offers a control for. The test checks it against `FormSettings`. */
export const SETTINGS_CONTROLS: Array<keyof FormSettings> = [
  'submitLabel',
  'confirmationMessage',
  'redirectUrl',
  'showProgress',
  'allowSaveAndResume',
  'duplicateControl',
  'locales',
];

export function FormSettingsPanel({
  definition,
  onChange,
}: {
  definition: FormDefinition;
  onChange: (definition: FormDefinition) => void;
}) {
  const t = useT();
  const { locale, locales } = useSession();
  const settings = definition.settings;

  function patch(changes: Partial<FormSettings>) {
    onChange({ ...definition, settings: { ...settings, ...changes } });
  }

  function setText(property: 'submitLabel' | 'confirmationMessage', target: string, value: string) {
    patch({ [property]: { ...settings[property], [target]: value } });
  }

  return (
    <section className="card stack">
      <strong className="small">
        <Icon name="settings" className="icon--lead" />
        {t('settings.heading')}
      </strong>

      <LocalisedField
        label={t('settings.submitLabel')}
        value={settings.submitLabel}
        locale={locale}
        supported={locales.supported}
        hint={t('settings.submitLabelHint')}
        onChange={(target, text) => setText('submitLabel', target, text)}
      />

      <LocalisedField
        label={t('settings.confirmationMessage')}
        value={settings.confirmationMessage}
        locale={locale}
        supported={locales.supported}
        multiline
        hint={t('settings.confirmationMessageHint')}
        onChange={(target, text) => setText('confirmationMessage', target, text)}
      />

      <label className="field">
        <span>{t('settings.redirectUrl')}</span>
        <input
          type="url"
          inputMode="url"
          placeholder="https://"
          value={settings.redirectUrl ?? ''}
          onChange={(event) => patch({ redirectUrl: event.target.value || undefined })}
        />
        <span className="small muted">{t('settings.redirectUrlHint')}</span>
      </label>

      {/**
       * Which languages this form offers its readers.
       *
       * Separate from the interface language, which is one at a time and belongs to whoever is
       * signed in. A form is a document: tick two here and the public page grows a flag in the
       * corner that flips between them, and the author writes both versions of every label on
       * the translation tab.
       *
       * None ticked means the organisation's whole list — which is what every form published
       * before this setting existed effectively had, so nothing changed under anybody.
       */}
      <fieldset className="field">
        <legend>{t('settings.locales')}</legend>
        <span className="small muted">{t('settings.localesHint')}</span>
        <div className="locale-choices">
          {locales.supported.map((supported) => {
            const chosen = settings.locales.includes(supported);
            return (
              <label key={supported} className="locale-choice">
                <input
                  type="checkbox"
                  checked={chosen}
                  onChange={() =>
                    patch({
                      locales: chosen
                        ? settings.locales.filter((each) => each !== supported)
                        : [...settings.locales, supported],
                    })
                  }
                />
                <Flag locale={supported} />
                <span>{localeLabel(supported)}</span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <label className="field field--inline">
        <input
          type="checkbox"
          checked={settings.showProgress}
          onChange={(event) => patch({ showProgress: event.target.checked })}
        />
        <span>{t('settings.showProgress')}</span>
      </label>

      <label className="field field--inline">
        <input
          type="checkbox"
          checked={settings.allowSaveAndResume}
          onChange={(event) => patch({ allowSaveAndResume: event.target.checked })}
        />
        <span>{t('settings.allowSaveAndResume')}</span>
      </label>

      <label className="field">
        <span>{t('settings.duplicateControl')}</span>
        <select
          value={settings.duplicateControl}
          onChange={(event) =>
            patch({ duplicateControl: event.target.value as FormSettings['duplicateControl'] })
          }
        >
          <option value="email">{t('settings.duplicateControl.email')}</option>
          <option value="none">{t('settings.duplicateControl.none')}</option>
        </select>
        <span className="small muted">{t('settings.duplicateControlHint')}</span>
      </label>
    </section>
  );
}
