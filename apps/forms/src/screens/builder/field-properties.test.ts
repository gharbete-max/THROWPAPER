import { describe, expect, it } from 'vitest';
import { FIELD_TYPES, fieldProperties, type Field } from '@tp/shared/forms';
import { rulesFor } from './FieldRules.js';

/**
 * Every property the schema gives a field must be settable somewhere in the builder.
 *
 * This test exists because the answer was "no" for eleven of them, for months. The validator
 * enforced `minLength`, `maxLength`, `pattern`, `min`, `max`, `decimals`, `minSelected` and
 * `maxSelected`; `long_text` had `rows`, `hidden` had `defaultValue`, and every answerable field
 * had `placeholder`. None of them had a control. Nothing was broken in a way a test could see —
 * the features simply could not be reached, and no list was ever compared to any other list.
 *
 * So the comparison is the test. Add a property to a field in `definition.ts` and this fails
 * until the builder can set it.
 */

/** Properties the properties panel handles directly, outside the rules section. */
const HANDLED_BY_PANEL = new Set([
  // Identity. `type` is chosen from the palette; `id` is never author-visible.
  'id',
  'type',
  'key',
  // Content.
  'label',
  'helpText',
  'placeholder',
  'content',
  'alt',
  'src',
  'href',
  'options',
  // Presentation.
  'scale',
  'minLabel',
  'maxLabel',
  'width',
  'required',
  'appearance',
  'maxWidth',
  // Wiring.
  'fromParameter',
]);

describe('the properties panel', () => {
  it.each(FIELD_TYPES)('can set every property of a %s', (type) => {
    // `rulesFor` switches on the field type only, so the rest of the object can be minimal.
    const reachable = new Set<string>([
      ...HANDLED_BY_PANEL,
      ...rulesFor({ type } as unknown as Field),
    ]);

    const unreachable = fieldProperties(type).filter((property) => !reachable.has(property));
    expect(unreachable, `no control for ${type}.${unreachable.join(', ')}`).toEqual([]);
  });

  it('offers no rule a field does not actually have', () => {
    // The other direction: a control for a property the schema would reject is a box that
    // silently does nothing, which is worse than a missing one because it looks like it worked.
    for (const type of FIELD_TYPES) {
      const properties = new Set(fieldProperties(type));
      const invented = rulesFor({ type } as unknown as Field).filter(
        (rule) => !properties.has(rule),
      );
      expect(invented, `${type} has no such property: ${invented.join(', ')}`).toEqual([]);
    }
  });
});
