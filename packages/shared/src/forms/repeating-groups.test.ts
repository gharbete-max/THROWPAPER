import { describe, expect, it } from 'vitest';
import {
  admittingGroup,
  columnsFor,
  definitionCompleteness,
  definitionProblems,
  emptyDefinition,
  entryColumnKey,
  entryIssueKey,
  EntryField,
  Field,
  flattenAnswers,
  MAX_GROUP_ENTRIES,
  minEntries,
  repeatingGroups,
  validateSubmission,
  type FormDefinition,
} from './index.js';

function definitionWith(...fields: unknown[]): FormDefinition {
  return { ...emptyDefinition, fields: fields.map((field) => Field.parse(field)) };
}

/** A guests group with a name and a meal, capped at three. The AGM case, minimally. */
function guests(overrides: Record<string, unknown> = {}) {
  return {
    id: 'g1',
    key: 'guests',
    type: 'repeating_group',
    label: { 'en-GB': 'Guests' },
    max: 3,
    fields: [
      { id: 'c1', key: 'name', type: 'short_text', label: { 'en-GB': 'Name' }, required: true },
      {
        id: 'c2',
        key: 'meal',
        type: 'single_select',
        label: { 'en-GB': 'Meal' },
        options: [
          { value: 'standard', label: { 'en-GB': 'Standard' } },
          { value: 'veg', label: { 'en-GB': 'Vegetarian' } },
        ],
      },
    ],
    ...overrides,
  };
}

const labels = {
  header: (key: string) => key,
  fieldHeader: (key: string) => key,
};

describe('the schema', () => {
  it('parses a group and defaults it to admitting nobody', () => {
    const group = repeatingGroups(definitionWith(guests()))[0];
    expect(group?.admits).toBe(false);
    expect(group?.min).toBe(0);
  });

  /**
   * The decision `max` exists to enforce. Without it the column set depends on the data, which is
   * what every other part of this codebase already assumes it does not.
   */
  it('refuses a group with no maximum', () => {
    const { max: _dropped, ...noMax } = guests();
    expect(() => Field.parse(noMax)).toThrow();
  });

  it('refuses a maximum above the cap', () => {
    expect(() => Field.parse(guests({ max: MAX_GROUP_ENTRIES + 1 }))).toThrow();
  });

  it('refuses a group with no fields in it', () => {
    expect(() => Field.parse(guests({ fields: [] }))).toThrow();
  });

  it('refuses a group inside a group', () => {
    expect(() => Field.parse(guests({ fields: [guests({ id: 'g2', key: 'inner' })] }))).toThrow();
  });

  it('refuses a page break inside a group', () => {
    const page = { id: 'p1', key: 'page', type: 'page_break' };
    expect(() => EntryField.parse(page)).toThrow();
    expect(() => Field.parse(guests({ fields: [page] }))).toThrow();
    // …while the same field is perfectly valid at the top level.
    expect(() => Field.parse(page)).not.toThrow();
  });

  it('allows presentational fields inside a group', () => {
    const heading = {
      id: 'h1',
      key: 'heading',
      type: 'section_break',
      label: { 'en-GB': 'Guest' },
    };
    expect(() => Field.parse(guests({ fields: [heading, ...guests().fields] }))).not.toThrow();
  });

  it('reads required as at least one entry', () => {
    expect(minEntries({ required: true, min: 0 })).toBe(1);
    expect(minEntries({ required: true, min: 2 })).toBe(2);
    expect(minEntries({ required: false, min: 0 })).toBe(0);
  });
});

describe('validation', () => {
  const definition = definitionWith(guests());

  it('accepts entries and keeps them keyed by the child key', () => {
    const result = validateSubmission(definition, {
      guests: [{ name: 'Alva', meal: 'veg' }, { name: 'Björn' }],
    });
    expect(result.ok).toBe(true);
    expect(result.values['guests']).toEqual([
      { name: 'Alva', meal: 'veg' },
      { name: 'Björn', meal: null },
    ]);
  });

  it('stores an absent group as no entries rather than null', () => {
    const result = validateSubmission(definition, {});
    expect(result.ok).toBe(true);
    expect(result.values['guests']).toEqual([]);
  });

  it('names the box an entry issue came from', () => {
    const result = validateSubmission(definition, { guests: [{ meal: 'veg' }] });
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual([{ key: 'guests[0].name', code: 'validation.required' }]);
  });

  it('applies a child rule per entry', () => {
    const result = validateSubmission(definition, {
      guests: [
        { name: 'Alva', meal: 'veg' },
        { name: 'Björn', meal: 'steak' },
      ],
    });
    expect(result.issues).toEqual([{ key: 'guests[1].meal', code: 'validation.option' }]);
  });

  it('refuses more entries than the maximum rather than trimming them', () => {
    const four = [1, 2, 3, 4].map((n) => ({ name: `Guest ${n}` }));
    const result = validateSubmission(definition, { guests: four });
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual([
      { key: 'guests', code: 'validation.groupMax', params: { max: 3 } },
    ]);
  });

  it('demands the minimum number of entries', () => {
    const required = definitionWith(guests({ required: true }));
    const result = validateSubmission(required, { guests: [] });
    expect(result.issues).toEqual([
      { key: 'guests', code: 'validation.groupMin', params: { min: 1 } },
    ]);
  });

  it('asks for no entries at all on a partial save', () => {
    const required = definitionWith(guests({ required: true, min: 2 }));
    expect(validateSubmission(required, {}, { partial: true }).ok).toBe(true);
  });

  it('refuses an entry that is not an object', () => {
    const result = validateSubmission(definition, { guests: ['Alva'] });
    expect(result.issues).toEqual([{ key: 'guests[0]', code: 'validation.group' }]);
  });

  it('refuses an answer that is not a list', () => {
    const result = validateSubmission(definition, { guests: 'Alva' });
    expect(result.issues).toEqual([{ key: 'guests', code: 'validation.group' }]);
  });

  it('drops answers for children the group does not have', () => {
    const result = validateSubmission(definition, {
      guests: [{ name: 'Alva', smuggled: 'x' }],
    });
    expect(result.values['guests']).toEqual([{ name: 'Alva', meal: null }]);
  });

  /**
   * The hole `asScalar` exists to close. Before it, an array of objects handed to a text field was
   * stringified to `[object Object]`, which is fifteen characters and passes most length rules.
   */
  it('does not let a group-shaped answer become a text answer', () => {
    const plain = definitionWith({
      id: 'f1',
      key: 'note',
      type: 'short_text',
      label: { 'en-GB': 'Note' },
      required: true,
    });
    const result = validateSubmission(plain, { note: [{ name: 'Alva' }] });
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual([{ key: 'note', code: 'validation.required' }]);
  });

  it('stores a hidden group as no entries', () => {
    const conditional = definitionWith(
      {
        id: 'f1',
        key: 'bringing',
        type: 'yes_no',
        label: { 'en-GB': 'Bringing anyone?' },
      },
      guests({
        showWhen: {
          match: 'all',
          conditions: [{ fieldKey: 'bringing', operator: 'equals', value: 'true' }],
        },
      }),
    );
    const result = validateSubmission(conditional, {
      bringing: false,
      guests: [{ name: 'Alva' }],
    });
    expect(result.values['guests']).toEqual([]);
  });
});

describe('a condition inside an entry sees only that entry', () => {
  const definition = definitionWith({
    ...guests(),
    fields: [
      { id: 'c1', key: 'name', type: 'short_text', label: { 'en-GB': 'Name' } },
      {
        id: 'c2',
        key: 'allergies',
        type: 'short_text',
        label: { 'en-GB': 'Allergies' },
        required: true,
        showWhen: {
          match: 'all',
          conditions: [{ fieldKey: 'name', operator: 'answered', value: '' }],
        },
      },
    ],
  });

  it('shows a child when its own entry satisfies the rule', () => {
    const result = validateSubmission(definition, { guests: [{ name: 'Alva' }] });
    expect(result.issues).toEqual([{ key: 'guests[0].allergies', code: 'validation.required' }]);
  });

  /**
   * A condition reads what the entry *kept*, not what the client *sent*.
   *
   * The distinction only shows up in a cascade: if a question was never asked, an answer smuggled
   * in beside it must not go on to drive a second question. Reading the raw entry instead would
   * make `notes` required below on the strength of a `diet` nobody was shown.
   */
  it('reads an entry as validated so far, so hiding one child hides what depends on it', () => {
    const cascading = definitionWith({
      ...guests(),
      fields: [
        { id: 'c1', key: 'bringing', type: 'yes_no', label: { 'en-GB': 'Bringing anyone?' } },
        {
          id: 'c2',
          key: 'diet',
          type: 'short_text',
          label: { 'en-GB': 'Diet' },
          showWhen: {
            match: 'all',
            conditions: [{ fieldKey: 'bringing', operator: 'equals', value: 'true' }],
          },
        },
        {
          id: 'c3',
          key: 'notes',
          type: 'short_text',
          label: { 'en-GB': 'Notes' },
          required: true,
          showWhen: {
            match: 'all',
            conditions: [{ fieldKey: 'diet', operator: 'answered', value: '' }],
          },
        },
      ],
    });

    const result = validateSubmission(cascading, {
      guests: [{ bringing: false, diet: 'veg', notes: '' }],
    });
    expect(result.ok).toBe(true);
    expect(result.values['guests']).toEqual([{ bringing: false, diet: null, notes: null }]);
  });

  it('hides it in an entry that does not, without looking at its neighbours', () => {
    const result = validateSubmission(definition, {
      guests: [{ name: 'Alva', allergies: 'nuts' }, {}],
    });
    expect(result.ok).toBe(true);
    expect(result.values['guests']).toEqual([
      { name: 'Alva', allergies: 'nuts' },
      { name: null, allergies: null },
    ]);
  });
});

describe('definition problems', () => {
  it('refuses a minimum above the maximum', () => {
    const problems = definitionProblems(definitionWith(guests({ min: 4, max: 3 })));
    expect(problems.map((problem) => problem.code)).toContain('group-min-above-max');
  });

  it('refuses two children with the same key', () => {
    const clash = guests({
      fields: [
        { id: 'c1', key: 'name', type: 'short_text', label: { 'en-GB': 'Name' } },
        { id: 'c2', key: 'name', type: 'short_text', label: { 'en-GB': 'Also name' } },
      ],
    });
    const codes = definitionProblems(definitionWith(clash)).map((problem) => problem.code);
    expect(codes).toContain('group-duplicate-child-key');
  });

  /** Scoped, not global: `guests[].name` and a top-level `name` are different questions. */
  it('allows a child to reuse a top-level key', () => {
    const definition = definitionWith(
      { id: 'f1', key: 'name', type: 'short_text', label: { 'en-GB': 'Your name' } },
      guests(),
    );
    expect(definitionProblems(definition)).toEqual([]);
  });

  it('refuses a condition inside an entry that reaches outside it', () => {
    const definition = definitionWith(
      { id: 'f1', key: 'attending', type: 'yes_no', label: { 'en-GB': 'Attending?' } },
      guests({
        fields: [
          {
            id: 'c1',
            key: 'name',
            type: 'short_text',
            label: { 'en-GB': 'Name' },
            showWhen: {
              match: 'all',
              conditions: [{ fieldKey: 'attending', operator: 'equals', value: 'true' }],
            },
          },
        ],
      }),
    );
    const codes = definitionProblems(definition).map((problem) => problem.code);
    expect(codes).toContain('condition-unknown-field');
  });

  it('refuses an attendee name that names no child', () => {
    const codes = definitionProblems(
      definitionWith(guests({ admits: true, admitNameKey: 'surname' })),
    ).map((problem) => problem.code);
    expect(codes).toContain('group-admit-name-unknown');
  });

  it('refuses two admitting groups, naming both', () => {
    const definition = definitionWith(
      guests({ admits: true }),
      guests({ id: 'g2', key: 'vehicles', admits: true }),
    );
    const named = definitionProblems(definition)
      .filter((problem) => problem.code === 'multiple-admitting-groups')
      .map((problem) => problem.params?.['key']);
    expect(named).toEqual(['guests', 'vehicles']);
  });

  it('accepts one admitting group and finds it', () => {
    const definition = definitionWith(
      guests({ admits: true, admitNameKey: 'name' }),
      guests({ id: 'g2', key: 'vehicles' }),
    );
    expect(definitionProblems(definition)).toEqual([]);
    expect(admittingGroup(definition)?.key).toBe('guests');
  });

  it('finds no admitting group when nothing admits', () => {
    expect(admittingGroup(definitionWith(guests()))).toBeNull();
  });
});

describe('translations', () => {
  it('requires a child label in every offered language', () => {
    const completeness = definitionCompleteness(definitionWith(guests()), ['en-GB', 'sv-SE']);
    const swedish = completeness.find((entry) => entry.locale === 'sv-SE');
    expect(swedish?.missing).toContain('field.c1.label');
    expect(swedish?.missing).toContain('field.c2.options.0');
  });

  it('does not require the add button or the entry heading', () => {
    const group = guests({
      label: { 'en-GB': 'Guests', 'sv-SE': 'Gäster' },
      addLabel: { 'en-GB': 'Add a guest' },
      fields: [
        { id: 'c1', key: 'name', type: 'short_text', label: { 'en-GB': 'N', 'sv-SE': 'N' } },
      ],
    });
    const completeness = definitionCompleteness(definitionWith(group), ['sv-SE']);
    expect(completeness[0]?.complete).toBe(true);
  });
});

describe('the export', () => {
  const definition = definitionWith(guests());

  it('produces one block of columns per possible entry', () => {
    const keys = columnsFor(definition, labels).map((column) => column.key);
    expect(keys).toEqual([
      'submittedAt',
      'guests_1_name',
      'guests_1_meal',
      'guests_2_name',
      'guests_2_meal',
      'guests_3_name',
      'guests_3_meal',
      'reference',
      'locale',
      'status',
    ]);
  });

  /** The property `max` was made required to buy: columns depend on the form, not on the answers. */
  it('produces the same columns whatever anybody answered', () => {
    const before = columnsFor(definition, labels).map((column) => column.key);
    const after = columnsFor(definition, labels).map((column) => column.key);
    expect(before).toEqual(after);
    expect(before).toHaveLength(10);
  });

  it('keeps each child column typed as its own field type', () => {
    const numeric = definitionWith(
      guests({
        fields: [
          { id: 'c1', key: 'reading', type: 'number', label: { 'en-GB': 'Reading' } },
          { id: 'c2', key: 'taken_on', type: 'date', label: { 'en-GB': 'Taken on' } },
        ],
        max: 1,
      }),
    );
    const columns = columnsFor(numeric, labels);
    expect(columns.find((column) => column.key === 'guests_1_reading')?.type).toBe('number');
    expect(columns.find((column) => column.key === 'guests_1_taken_on')?.type).toBe('date');
  });

  it('titles a numbered column through the caller, not in here', () => {
    const columns = columnsFor(definition, {
      ...labels,
      entryHeader: (group, number, child) => `${group}/${number}/${child}`,
    });
    expect(columns[1]?.header).toBe('guests/1/name');
  });

  it('spreads entries across the numbered columns and pads the rest', () => {
    const flat = flattenAnswers(definition, {
      reference: 'ABCD-EFGH',
      guests: [{ name: 'Alva', meal: 'veg' }],
    });
    expect(flat).toEqual({
      reference: 'ABCD-EFGH',
      guests_1_name: 'Alva',
      guests_1_meal: 'veg',
      guests_2_name: null,
      guests_2_meal: null,
      guests_3_name: null,
      guests_3_meal: null,
    });
  });

  it('drops the group key rather than leaving a cell of objects beside its columns', () => {
    const flat = flattenAnswers(definition, { guests: [{ name: 'Alva' }] });
    expect('guests' in flat).toBe(false);
  });

  it('leaves a form with no groups exactly as it was', () => {
    const plain = definitionWith({
      id: 'f1',
      key: 'note',
      type: 'short_text',
      label: { 'en-GB': 'Note' },
    });
    expect(flattenAnswers(plain, { note: 'hello' })).toEqual({ note: 'hello' });
  });

  it('survives a group answer that is missing or the wrong shape', () => {
    expect(flattenAnswers(definition, {})['guests_1_name']).toBeNull();
    expect(flattenAnswers(definition, { guests: 'x' })['guests_1_name']).toBeNull();
    expect(flattenAnswers(definition, { guests: ['x'] })['guests_1_name']).toBeNull();
  });
});

describe('the two ways of naming an answer inside a group', () => {
  /**
   * One is read by a person and one is read by code, and they deliberately differ: a spreadsheet
   * heading that started at nought would be a heading nobody could act on, and an array index that
   * started at one would be an array index that lies.
   */
  it('numbers the column from one and the issue from nought', () => {
    expect(entryColumnKey('guests', 1, 'name')).toBe('guests_1_name');
    expect(entryIssueKey('guests', 0, 'name')).toBe('guests[0].name');
    expect(entryIssueKey('guests', 0)).toBe('guests[0]');
  });
});
