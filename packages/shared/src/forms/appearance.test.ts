import { describe, expect, it } from 'vitest';
import {
  Field,
  FormDefinition,
  MULTI_SELECT_APPEARANCES,
  SINGLE_SELECT_APPEARANCES,
  YES_NO_APPEARANCES,
} from './definition.js';
import { validateSubmission } from './validate.js';

/**
 * Appearance is presentation. The tests that matter are the ones proving it changes nothing else:
 * a form written before this existed still parses, and restyling a question cannot alter what a
 * submission is allowed to contain.
 */
describe('choice field appearance', () => {
  it('defaults a definition written before appearance existed', () => {
    const before = {
      id: 'f1',
      key: 'meal',
      type: 'single_select',
      label: { 'sv-SE': 'Måltid' },
      options: [{ value: 'veg', label: { 'sv-SE': 'Vegetariskt' } }],
    };

    const parsed = Field.parse(before);
    expect(parsed).toMatchObject({ type: 'single_select', appearance: 'dropdown' });
  });

  it('defaults each choice type to what it rendered as before', () => {
    const multi = Field.parse({
      id: 'f2',
      key: 'extras',
      type: 'multi_select',
      label: {},
      options: [{ value: 'a', label: {} }],
    });
    const yesNo = Field.parse({ id: 'f3', key: 'member', type: 'yes_no', label: {} });

    expect(multi).toMatchObject({ appearance: 'checkboxes' });
    expect(yesNo).toMatchObject({ appearance: 'dropdown' });
  });

  it('accepts every appearance its own field type allows', () => {
    for (const appearance of SINGLE_SELECT_APPEARANCES) {
      expect(() =>
        Field.parse({
          id: 'f',
          key: 'k',
          type: 'single_select',
          label: {},
          options: [{ value: 'a', label: {} }],
          appearance,
        }),
      ).not.toThrow();
    }
    for (const appearance of MULTI_SELECT_APPEARANCES) {
      expect(() =>
        Field.parse({
          id: 'f',
          key: 'k',
          type: 'multi_select',
          label: {},
          options: [{ value: 'a', label: {} }],
          appearance,
        }),
      ).not.toThrow();
    }
    for (const appearance of YES_NO_APPEARANCES) {
      expect(() =>
        Field.parse({ id: 'f', key: 'k', type: 'yes_no', label: {}, appearance }),
      ).not.toThrow();
    }
  });

  it('refuses an appearance that belongs to a different field type', () => {
    // `checkboxes` is meaningless for a single choice, and `cards` for a yes/no question.
    expect(() =>
      Field.parse({
        id: 'f',
        key: 'k',
        type: 'single_select',
        label: {},
        options: [{ value: 'a', label: {} }],
        appearance: 'checkboxes',
      }),
    ).toThrow();
    expect(() =>
      Field.parse({ id: 'f', key: 'k', type: 'yes_no', label: {}, appearance: 'cards' }),
    ).toThrow();
  });

  it('does not change what a submission may contain', () => {
    const definitionFor = (appearance: string) =>
      FormDefinition.parse({
        schemaVersion: 1,
        fields: [
          {
            id: 'f1',
            key: 'meal',
            type: 'single_select',
            label: {},
            required: true,
            options: [
              { value: 'veg', label: {} },
              { value: 'standard', label: {} },
            ],
            appearance,
          },
        ],
      });

    for (const appearance of SINGLE_SELECT_APPEARANCES) {
      const definition = definitionFor(appearance);
      expect(validateSubmission(definition, { meal: 'veg' })).toMatchObject({
        issues: [],
        values: { meal: 'veg' },
      });
      // Still refused for the same reasons, whatever it looks like.
      expect(validateSubmission(definition, { meal: 'sushi' }).issues).not.toEqual([]);
      expect(validateSubmission(definition, {}).issues).not.toEqual([]);
    }
  });

  it('survives a round trip through the whole definition', () => {
    const definition = {
      schemaVersion: 1 as const,
      fields: [
        {
          id: 'f1',
          key: 'meal',
          type: 'single_select' as const,
          label: {},
          required: false,
          options: [{ value: 'veg', label: {} }],
          appearance: 'cards' as const,
        },
      ],
      settings: {},
    };

    const parsed = FormDefinition.parse(definition);
    const reparsed = FormDefinition.parse(JSON.parse(JSON.stringify(parsed)));
    expect(reparsed.fields[0]).toMatchObject({ appearance: 'cards' });
  });
});
