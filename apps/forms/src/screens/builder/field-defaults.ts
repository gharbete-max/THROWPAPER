import { FIELD_TYPES, type Field, type FieldType } from '@tp/shared/forms';

/**
 * A new field of each type, ready to drop on the canvas.
 *
 * The key is generated and unique, because a duplicate key silently loses answers — the publish
 * endpoint refuses one, and the operator should never have to think about it.
 */
export const PALETTE: readonly FieldType[] = FIELD_TYPES;

export function newField(type: FieldType, existingKeys: readonly string[]): Field {
  const id = crypto.randomUUID();
  const key = uniqueKey(type, existingKeys);

  switch (type) {
    // Split, rather than sharing a branch, because the two have different appearance vocabularies
    // and the defaults are what the form looked like before appearance was a choice at all.
    case 'single_select':
      return {
        id,
        key,
        type,
        label: {},
        required: false,
        options: [{ value: 'option_1', label: {}, image: null }],
        appearance: 'dropdown',
      };
    case 'multi_select':
      return {
        id,
        key,
        type,
        label: {},
        required: false,
        options: [{ value: 'option_1', label: {}, image: null }],
        appearance: 'checkboxes',
      };
    case 'yes_no':
      return { id, key, type, label: {}, required: false, appearance: 'dropdown' };
    /**
     * An image field is created with no picture yet: `src` is only valid once something has been
     * uploaded, so the builder shows an upload control and the field is incomplete until then.
     * That is better than inventing a placeholder path that would fail validation on publish.
     */
    case 'image':
      return { id, key, type, src: '', alt: {} } as unknown as Field;
    case 'section_break':
      return { id, key, type, label: {} };
    case 'page_break':
      return { id, key, type };
    case 'rich_text':
      return { id, key, type, content: {} };
    case 'hidden':
      return { id, key, type };
    default:
      return { id, key, type, label: {}, required: false };
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
