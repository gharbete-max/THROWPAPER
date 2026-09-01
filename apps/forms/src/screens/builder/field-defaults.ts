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
  { id: 'layout', types: ['section_break', 'page_break', 'rich_text', 'image', 'link', 'hidden'] },
];

/**
 * A default for the language being written in — and only that one.
 *
 * A new field used to arrive with `label: {}`, which meant it was immediately missing in every
 * locale: three fields and the header read "sv-SE: 3 missing · en-GB: 3 missing" before anybody
 * had done anything wrong.
 *
 * Filling *every* supported locale with the same placeholder fixed the warning and created a
 * worse problem — an untranslated English form would have shown a real respondent the words
 * "New question". One locale is seeded; the rest fall back to it when rendered, and are added
 * deliberately when somebody wants them.
 */
function localisedDefault(
  key: string,
  locale: string,
  replacements: Record<string, string | number> = {},
): Record<string, string> {
  const value = messages[key]?.[locale];
  if (!value) return {};
  const text = Object.entries(replacements).reduce(
    (result, [token, replacement]) => result.replaceAll(`{${token}}`, String(replacement)),
    value,
  );
  return { [locale]: text };
}

/** The label an option gets when it is created, so a new choice is not blank either. */
export function newOption(index: number, locale: string) {
  return {
    value: `option_${index}`,
    label: localisedDefault('field.defaultOption', locale, { n: index }),
    image: null,
  };
}

export function newField(
  type: FieldType,
  existingKeys: readonly string[],
  defaultLocale: string,
): Field {
  const id = crypto.randomUUID();
  const key = uniqueKey(type, existingKeys);
  const label = localisedDefault('field.defaultLabel', defaultLocale);

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
        options: [newOption(1, defaultLocale)],
        appearance: 'dropdown',
      };
    case 'multi_select':
      return {
        id,
        key,
        type,
        label,
        required: false,
        options: [newOption(1, defaultLocale)],
        appearance: 'checkboxes',
      };
    case 'yes_no':
      return { id, key, type, label, required: false, appearance: 'dropdown' };
    /**
     * An image field is created with no picture yet: `src` is only valid once something has been
     * uploaded, so the builder shows an upload control and the field is incomplete until then.
     * That is better than inventing a placeholder path that would fail validation on publish.
     */
    /**
     * Created without a destination. `href` only validates once somebody types one, so the field
     * is incomplete until then — better than inventing a placeholder URL that would fail on
     * publish, or worse, point somewhere real.
     */
    case 'link':
      return { id, key, type, label, href: '', appearance: 'button' } as unknown as Field;
    case 'image':
      return { id, key, type, src: '', alt: {} } as unknown as Field;
    case 'section_break':
      return { id, key, type, label: localisedDefault('field.defaultSection', defaultLocale) };
    case 'page_break':
      return { id, key, type };
    case 'rich_text':
      return { id, key, type, content: localisedDefault('field.defaultText', defaultLocale) };
    case 'hidden':
      return { id, key, type };
    default:
      return { id, key, type, label, required: false };
  }
}

/**
 * A key nothing else is using, derived from `base`.
 *
 * Used both for a new field (where the base is the type) and for a copy (where it is the original
 * key). Two fields sharing a key silently merge their answers into one column, and nobody finds
 * that until the export.
 */
export function uniqueKey(base: string, existing: readonly string[]): string {
  // A copy of `email_2` should be `email_3`, not `email_2_2`.
  const stem = base.replace(/_\d+$/, '');
  let candidate = stem;
  let counter = 2;
  while (existing.includes(candidate)) {
    candidate = `${stem}_${counter}`;
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
