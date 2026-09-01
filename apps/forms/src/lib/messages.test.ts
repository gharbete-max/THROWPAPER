import { describe, expect, it } from 'vitest';
import {
  FIELD_TYPES,
  MULTI_SELECT_APPEARANCES,
  SINGLE_SELECT_APPEARANCES,
  YES_NO_APPEARANCES,
} from '@tp/shared/forms';
import { messages } from './messages.js';

/**
 * A missing key renders as the key itself — `fieldType.image` appeared in the palette exactly like
 * that, in front of anybody building a form, for as long as the image field existed.
 *
 * Nothing else catches it: the app compiles, the tests pass, and the string only shows up on a
 * screen somebody happens to open. So the check is here, driven by the schema rather than by a
 * list that would need remembering.
 */
describe('translations for schema-driven strings', () => {
  it.each(FIELD_TYPES)('names the %s field type', (type) => {
    expect(messages[`fieldType.${type}`], `fieldType.${type}`).toBeDefined();
  });

  it.each([
    ...new Set([...SINGLE_SELECT_APPEARANCES, ...MULTI_SELECT_APPEARANCES, ...YES_NO_APPEARANCES]),
  ])('names the %s appearance', (appearance) => {
    expect(messages[`field.appearance.${appearance}`], appearance).toBeDefined();
  });

  it('has both languages for every string it defines', () => {
    const incomplete = Object.entries(messages)
      .filter(([, value]) => !value['sv-SE'] || !value['en-GB'])
      .map(([key]) => key);
    expect(incomplete).toEqual([]);
  });
});
