import { FIELD_TYPES, type Field, type FieldType } from '@tp/shared/forms';
import { messages } from '../../lib/messages.js';

/**
 * A new field of each type, ready to drop on the canvas.
 *
 * The key is generated and unique, because a duplicate key silently loses answers — the publish
 * endpoint refuses one, and the operator should never have to think about it.
 */
export const PALETTE: readonly FieldType[] = FIELD_TYPES;

/**
 * The palette, grouped.
 *
 * Fourteen equally-weighted buttons in a column is a list, not a palette: it fills the screen,
 * buries the form being built, and gives no clue that "Page break" and "Email" are different kinds
 * of thing. Three groups of five or fewer is something you can scan.
 *
 * Every type appears exactly once — `field-defaults.test.ts` proves it, so adding a field type
 * without deciding where it belongs fails the build rather than quietly vanishing from the
 * palette.
 */
export const PALETTE_GROUPS: ReadonlyArray<{ id: string; types: readonly FieldType[] }> = [
  { id: 'text', types: ['short_text', 'long_text', 'number', 'email', 'phone', 'date'] },
  { id: 'choice', types: ['single_select', 'multi_select', 'yes_no'] },
  { id: 'layout', types: ['section_break', 'page_break', 'rich_text', 'image', 'hidden'] },
];

/**
 * A default in **every language the organisation publishes**, read straight from the catalogue.
 *
 * A new field used to arrive with `label: {}`, which meant it was immediately missing in every
 * locale — add three fields and the header reads "sv-SE: 3 missing · en-GB: 3 missing" before
 * anybody has done anything wrong. Warnings that appear for doing the normal thing are warnings
 * people learn to ignore.
 *
 * A placeholder that is obviously a placeholder is better: the form stays publishable, the
 * completeness indicator stays meaningful, and "New question" tells the author exactly what is
 * left to do.
 */
function localisedDefault(
  key: string,
  supported: readonly string[],
  replacements: Record<string, string | number> = {},
): Record<string, string> {
  const entry = messages[key] ?? {};
  const out: Record<string, string> = {};
  for (const locale of supported) {
    const value = entry[locale];
    if (!value) continue;
    out[locale] = Object.entries(replacements).reduce(
      (text, [token, replacement]) => text.replaceAll(`{${token}}`, String(replacement)),
      value,
    );
  }
  return out;
}

/** The label an option gets when it is created, so a new choice is not missing either. */
export function newOption(index: number, supported: readonly string[]) {
  return {
    value: `option_${index}`,
    label: localisedDefault('field.defaultOption', supported, { n: index }),
    image: null,
  };
}

export function newField(
  type: FieldType,
  existingKeys: readonly string[],
  supported: readonly string[],
): Field {
  const id = crypto.randomUUID();
  const key = uniqueKey(type, existingKeys);
  const label = localisedDefault('field.defaultLabel', supported);

  switch (type) {
    // Split, rather than sharing a branch, because the two have different appearance vocabularies
    // and the defaults are what the form looked like before appearance was a choice at all.
    case 'single_select':
      return {
        id,
        key,
        type,
        label,
        required: false,
        options: [newOption(1, supported)],
        appearance: 'dropdown',
      };
    case 'multi_select':
      return {
        id,
        key,
        type,
        label,
        required: false,
        options: [newOption(1, supported)],
        appearance: 'checkboxes',
      };
    case 'yes_no':
      return { id, key, type, label, required: false, appearance: 'dropdown' };
    /**
     * An image field is created with no picture yet: `src` is only valid once something has been
     * uploaded, so the builder shows an upload control and the field is incomplete until then.
     * That is better than inventing a placeholder path that would fail validation on publish.
     */
    case 'image':
      return { id, key, type, src: '', alt: {} } as unknown as Field;
    case 'section_break':
      return { id, key, type, label: localisedDefault('field.defaultSection', supported) };
    case 'page_break':
      return { id, key, type };
    case 'rich_text':
      return { id, key, type, content: localisedDefault('field.defaultText', supported) };
    case 'hidden':
      return { id, key, type };
    default:
      return { id, key, type, label, required: false };
  }
}

function uniqueKey(type: FieldType, existing: readonly string[]): string {
  const base = type.replace(/_/g, '_');
  let candidate = base;
  let counter = 2;
  while (existing.includes(candidate)) {
    candidate = `${base}_${counter}`;
    counter += 1;
  }
  return candidate;
}

/** Fields that carry a label the operator edits. */
export function hasLabel(field: Field): field is Extract<Field, { label: Record<string, string> }> {
  return 'label' in field;
}

export function hasOptions(
  field: Field,
): field is Extract<Field, { options: { value: string; label: Record<string, string> }[] }> {
  return 'options' in field;
}
