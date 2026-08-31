import { describe, expect, it } from 'vitest';
import {
  Field,
  FormDefinition,
  answerableFields,
  definitionCompleteness,
  definitionProblems,
  duplicateKeys,
  emptyDefinition,
  pagesOf,
  translatableTexts,
} from './index.js';

function field(overrides: Record<string, unknown>) {
  return Field.parse({
    id: 'f1',
    key: 'first_name',
    type: 'short_text',
    label: { 'sv-SE': 'Förnamn', 'en-GB': 'First name' },
    required: true,
    ...overrides,
  });
}

const definition: FormDefinition = {
  ...emptyDefinition,
  fields: [
    field({ id: 'f1', key: 'first_name' }),
    field({ id: 'f2', key: 'section', type: 'section_break', label: { 'sv-SE': 'Om dig' } }),
    field({ id: 'f3', key: 'page', type: 'page_break' }),
    field({
      id: 'f4',
      key: 'meal',
      type: 'single_select',
      label: { 'sv-SE': 'Måltid', 'en-GB': 'Meal' },
      options: [{ value: 'veg', label: { 'sv-SE': 'Vegetariskt', 'en-GB': 'Vegetarian' } }],
    }),
  ],
};

describe('field definitions', () => {
  it('accepts the thirteen v0.1 types and rejects anything else', () => {
    expect(Field.safeParse({ ...field({}), type: 'signature' }).success).toBe(false);
    expect(Field.safeParse({ id: 'f', key: 'p', type: 'page_break' }).success).toBe(true);
  });

  it('requires a machine-safe field key — data is addressed by key, not label', () => {
    expect(Field.safeParse({ ...field({}), key: 'First Name' }).success).toBe(false);
    expect(Field.safeParse({ ...field({}), key: '1st' }).success).toBe(false);
    expect(Field.safeParse({ ...field({}), key: 'first_name2' }).success).toBe(true);
  });

  it('refuses a choice field with no options', () => {
    const parsed = Field.safeParse({ ...field({}), type: 'single_select', options: [] });
    expect(parsed.success).toBe(false);
  });

  it('pins the document shape with a schema version', () => {
    expect(FormDefinition.safeParse({ ...emptyDefinition, schemaVersion: 2 }).success).toBe(false);
  });
});

describe('structure helpers', () => {
  it('separates answerable fields from presentational ones', () => {
    expect(answerableFields(definition).map((f) => f.key)).toEqual(['first_name', 'meal']);
  });

  it('splits into pages on page breaks, dropping the break itself', () => {
    const pages = pagesOf(definition);
    expect(pages).toHaveLength(2);
    expect(pages[0]?.map((f) => f.key)).toEqual(['first_name', 'section']);
    expect(pages[1]?.map((f) => f.key)).toEqual(['meal']);
  });

  it('always returns at least one page, even for an empty form', () => {
    expect(pagesOf(emptyDefinition)).toHaveLength(1);
  });

  it('finds duplicate keys, which would silently lose answers', () => {
    const clashing = { ...definition, fields: [field({ id: 'a' }), field({ id: 'b' })] };
    expect(duplicateKeys(clashing)).toEqual(['first_name']);
  });
});

describe('translation completeness', () => {
  it('lists required texts missing from a locale', () => {
    const [swedish, english] = definitionCompleteness(definition, ['sv-SE', 'en-GB']);
    expect(swedish?.complete).toBe(true);
    // The section break has no English label.
    expect(english?.complete).toBe(false);
    expect(english?.missing).toContain('field.f2.label');
  });

  it('counts option labels — an untranslated option is an untranslated form', () => {
    const partial: FormDefinition = {
      ...definition,
      fields: [
        field({
          id: 'f9',
          key: 'meal',
          type: 'single_select',
          label: { 'sv-SE': 'Måltid', 'en-GB': 'Meal' },
          options: [{ value: 'veg', label: { 'sv-SE': 'Vegetariskt' } }],
        }),
      ],
    };
    const [, english] = definitionCompleteness(partial, ['sv-SE', 'en-GB']);
    expect(english?.missing).toContain('field.f9.options.0');
  });

  it('does not block on optional text like help and placeholders', () => {
    // Label translated everywhere; help text only in Swedish. English is still publishable.
    const withHelp: FormDefinition = {
      ...emptyDefinition,
      fields: [field({ helpText: { 'sv-SE': 'Som i passet' } })],
    };
    const [, english] = definitionCompleteness(withHelp, ['sv-SE', 'en-GB']);
    expect(english?.missing).toEqual([]);
    expect(english?.complete).toBe(true);
  });

  it('does block on a missing label', () => {
    const swedishOnly: FormDefinition = {
      ...emptyDefinition,
      fields: [field({ label: { 'sv-SE': 'Förnamn' } })],
    };
    const [, english] = definitionCompleteness(swedishOnly, ['sv-SE', 'en-GB']);
    expect(english?.missing).toEqual(['field.f1.label']);
  });

  it('collects every translatable string for the editor to point at', () => {
    const paths = translatableTexts(definition).map((entry) => entry.path);
    expect(paths).toContain('field.f4.options.0');
    expect(paths).toContain('settings.confirmationMessage');
    // A page break has nothing to translate.
    expect(paths.some((path) => path.startsWith('field.f3.'))).toBe(false);
  });
});

describe('structural problems block publishing', () => {
  it('reports a form that collects nothing', () => {
    expect(definitionProblems(emptyDefinition).map((p) => p.code)).toContain(
      'no-answerable-fields',
    );
  });

  it('reports duplicate keys', () => {
    const clashing = { ...definition, fields: [field({ id: 'a' }), field({ id: 'b' })] };
    expect(definitionProblems(clashing).map((p) => p.code)).toContain('duplicate-key');
  });

  it('passes a well-formed definition', () => {
    expect(definitionProblems(definition)).toEqual([]);
  });
});
