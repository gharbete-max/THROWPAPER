import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FIELD_TYPES, fieldProperties, fieldSupports, type Field } from '@tp/shared/forms';
import { rulesFor } from './FieldRules.js';
import { newField } from './field-defaults.js';

/**
 * Every property the schema gives a field must be settable somewhere in the builder.
 *
 * This test exists because the answer was "no" for eleven of them, for months. The validator
 * enforced `minLength`, `maxLength`, `pattern`, `min`, `max`, `decimals`, `minSelected` and
 * `maxSelected`; `long_text` had `rows`, `hidden` had `defaultValue`, and every answerable field
 * had `placeholder`. None had a control. Nothing was broken in a way a test could see — the
 * features simply could not be reached, and no list was ever compared to any other list.
 *
 * So the comparison is the test. Add a property to a field in `definition.ts` and this fails
 * until the builder can set it.
 */

/**
 * Properties the properties panel renders a control for, outside the rules section.
 *
 * Not a list of everything — `id` and `type` have no control by design, and are excused below.
 */
const PANEL_CONTROLS = [
  'key',
  'label',
  'helpText',
  'placeholder',
  'content',
  'alt',
  'src',
  'href',
  'options',
  'width',
  'required',
  'appearance',
  'maxWidth',
  'fromParameter',
  'accept',
  'maxBytes',
  'scale',
  'minLabel',
  'maxLabel',
  'showWhen',
];

/** Deliberately not editable: an id is internal, and the type is chosen from the palette. */
const NO_CONTROL_BY_DESIGN = ['id', 'type'];

describe('the properties panel', () => {
  it.each(FIELD_TYPES)('can set every property of a %s', (type) => {
    // `rulesFor` switches on the field type only, so the rest of the object can be minimal.
    const reachable = new Set<string>([
      ...NO_CONTROL_BY_DESIGN,
      ...PANEL_CONTROLS,
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

/**
 * ## The `'property' in field` trap
 *
 * Zod **omits** an `.optional()` property that was never set, so the key is absent from the parsed
 * object. `'helpText' in field` therefore answers "this kind of field has no help text" when the
 * truth is "nobody has written any yet".
 *
 * That is not hypothetical. The builder asked exactly that question about `helpText`, so the box
 * for it appeared only on fields that already had help text — meaning help text could never be
 * *added* to anything, for as long as the builder has existed. `placeholder` and conditional
 * visibility were about to inherit the same bug for the same reason.
 *
 * It hid because `width`, `required` and `appearance` are `.default()`ed, so they are always
 * present after parsing and the pattern appeared to work everywhere anybody looked.
 *
 * `fieldSupports(type, property)` asks the schema instead. This test bans the old habit.
 */
const BUILDER_ROOT = new URL('./', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [full] : [];
  });
}

/**
 * The properties Zod leaves off a freshly-created field — the ones `in` cannot be trusted for.
 *
 * Derived, not listed: a new field of each type is built by the builder's own `newField`, and
 * whatever the schema declares but that object does not carry is a property that will be absent
 * until somebody sets it. Probing those with `in` is the bug; probing a `.default()`ed one like
 * `required` or `width` is fine, because it is always there.
 */
const ABSENT_WHEN_UNSET = new Set(
  FIELD_TYPES.flatMap((type) => {
    const present = new Set(Object.keys(newField(type, [], 'sv-SE')));
    return fieldProperties(type).filter((property) => !present.has(property));
  }),
);

describe('asking what a field supports', () => {
  it('goes through the schema for any property that can be absent', () => {
    // Sanity: if this set is empty the derivation broke and the test proves nothing.
    expect(ABSENT_WHEN_UNSET.size).toBeGreaterThan(5);
    expect(ABSENT_WHEN_UNSET.has('helpText')).toBe(true);
    expect(ABSENT_WHEN_UNSET.has('showWhen')).toBe(true);
    // `required` is defaulted, so `'required' in field` stays a legitimate narrowing.
    expect(ABSENT_WHEN_UNSET.has('required')).toBe(false);

    const probe = new RegExp(`['"](${[...ABSENT_WHEN_UNSET].join('|')})['"]\\s+in\\s+\\w`);
    const offenders = sourceFiles(BUILDER_ROOT)
      .filter((file) => probe.test(readFileSync(file, 'utf8')))
      .map((file) => file.slice(BUILDER_ROOT.length));

    expect(offenders).toEqual([]);
  });

  it('reports what the schema says, not what one object happens to carry', () => {
    // The regression in one line: a short text field with no help text still supports help text.
    expect(fieldSupports('short_text', 'helpText')).toBe(true);
    expect(fieldSupports('short_text', 'placeholder')).toBe(true);
    expect(fieldSupports('short_text', 'showWhen')).toBe(true);
    // And a page break supports none of them.
    expect(fieldSupports('page_break', 'helpText')).toBe(false);
    expect(fieldSupports('page_break', 'showWhen')).toBe(false);
    expect(fieldSupports('hidden', 'showWhen')).toBe(false);
  });
});
