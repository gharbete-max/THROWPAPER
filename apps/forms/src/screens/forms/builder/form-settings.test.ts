import { describe, expect, it } from 'vitest';
import { FormSettings } from '@tp/shared/forms';
import { SETTINGS_CONTROLS } from './FormSettingsPanel.js';

/**
 * Every form setting must be settable.
 *
 * The same gap as the field rules, in a different place: `submitLabel`, `confirmationMessage`,
 * `duplicateControl` and `allowSaveAndResume` were all in the schema and honoured by the public
 * page, and the builder had a control for none of them. `PublicForm` read the submit label — so a
 * form could carry a custom one only if something other than the builder had written it.
 *
 * The schema is the list. Add a setting and this fails until the panel can set it.
 */
describe('the form settings panel', () => {
  const schemaKeys = Object.keys(FormSettings.shape);

  it('offers a control for every setting', () => {
    const missing = schemaKeys.filter(
      (key) => !SETTINGS_CONTROLS.includes(key as (typeof SETTINGS_CONTROLS)[number]),
    );
    expect(missing, `no control for settings.${missing.join(', ')}`).toEqual([]);
  });

  it('offers no control for a setting that does not exist', () => {
    // A box wired to a key the schema drops looks like it worked and changes nothing.
    const invented = SETTINGS_CONTROLS.filter((key) => !schemaKeys.includes(key));
    expect(invented, `no such setting: ${invented.join(', ')}`).toEqual([]);
  });
});
