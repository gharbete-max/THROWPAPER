import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  FIELD_TYPES,
  MULTI_SELECT_APPEARANCES,
  SINGLE_SELECT_APPEARANCES,
  YES_NO_APPEARANCES,
} from '@tp/shared/forms';
import { messages } from './messages.js';
import { PALETTE_GROUPS } from '../screens/builder/field-defaults.js';

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

  /**
   * The palette headings. Splitting a group because it grew past six types is a two-file change,
   * and this is the file that gets forgotten — the new heading would render as `palette.numbers`
   * above the fields it names.
   */
  it.each(PALETTE_GROUPS.map((group) => group.id))('names the %s palette group', (id) => {
    expect(messages[`palette.${id}`], `palette.${id}`).toBeDefined();
  });

  it('has both languages for every string it defines', () => {
    const incomplete = Object.entries(messages)
      .filter(([, value]) => !value['sv-SE'] || !value['en-GB'])
      .map(([key]) => key);
    expect(incomplete).toEqual([]);
  });

  /**
   * Every reason the validator can reject an answer must be sayable.
   *
   * A code with no message renders as `validation.tooShort` under the box, to a member of the
   * public, at the moment they are being told they got something wrong — the worst place in the
   * product for a raw key to surface. The codes are read out of the validator's source rather
   * than from a list kept alongside it, because a list kept alongside it is the thing that drifts.
   */
  it('can say every reason the validator rejects an answer', () => {
    const source = readFileSync(
      new URL('../../../../packages/shared/src/forms/validate.ts', import.meta.url),
      'utf8',
    );
    const codes = [...source.matchAll(/code: '(validation\.[A-Za-z]+)'/g)].map(
      (match) => match[1]!,
    );

    // If this is ever empty the regex has drifted from the source and the test proves nothing.
    expect(codes.length).toBeGreaterThan(10);
    expect([...new Set(codes)].filter((code) => !messages[code])).toEqual([]);
  });
});
