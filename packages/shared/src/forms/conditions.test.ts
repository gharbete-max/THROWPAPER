import { describe, expect, it } from 'vitest';
import {
  Field,
  conditionHolds,
  definitionProblems,
  isVisible,
  validateSubmission,
} from './index.js';
import type { Condition, FormDefinition } from './index.js';

const condition = (over: Partial<Condition> = {}): Condition => ({
  fieldKey: 'country',
  operator: 'equals',
  value: 'SE',
  ...over,
});

describe('a single condition', () => {
  it('compares the stored answer, not anything displayed', () => {
    // The label could be "Sverige" or "Sweden" depending on the locale; the value is what counts.
    expect(conditionHolds(condition(), { country: 'SE' })).toBe(true);
    expect(conditionHolds(condition(), { country: 'NO' })).toBe(false);
  });

  it('treats an unanswered field as satisfying no comparison — not even "not equals"', () => {
    /**
     * The tempting reading is that a blank is "not equal to SE" and so should show the field.
     * That makes every conditional field appear on an empty form and then vanish as somebody
     * answers, which reads as a glitch. A comparison needs something to compare.
     */
    expect(conditionHolds(condition({ operator: 'notEquals' }), {})).toBe(false);
    expect(conditionHolds(condition({ operator: 'notEquals' }), { country: '' })).toBe(false);
    expect(conditionHolds(condition({ operator: 'notEquals' }), { country: 'NO' })).toBe(true);
  });

  it('answers "answered" and "empty" without a value', () => {
    expect(conditionHolds(condition({ operator: 'answered', value: '' }), { country: 'SE' })).toBe(
      true,
    );
    expect(conditionHolds(condition({ operator: 'answered', value: '' }), { country: '  ' })).toBe(
      false,
    );
    expect(conditionHolds(condition({ operator: 'empty', value: '' }), {})).toBe(true);
    expect(conditionHolds(condition({ operator: 'empty', value: '' }), { country: [] })).toBe(true);
  });

  it('reads "equals" against a multi-select as "is one of the chosen"', () => {
    const meals = { meals: ['vegetarian', 'gluten_free'] };
    expect(conditionHolds(condition({ fieldKey: 'meals', value: 'vegetarian' }), meals)).toBe(true);
    expect(conditionHolds(condition({ fieldKey: 'meals', value: 'standard' }), meals)).toBe(false);
    expect(
      conditionHolds(
        condition({ fieldKey: 'meals', operator: 'notEquals', value: 'standard' }),
        meals,
      ),
    ).toBe(true);
  });

  it('orders numbers numerically and dates and times as text', () => {
    const gt = (fieldKey: string, value: string) =>
      condition({ fieldKey, operator: 'greaterThan', value });

    // 9 > 10 as text, which is why this cannot be a string comparison for numbers.
    expect(conditionHolds(gt('guests', '10'), { guests: 9 })).toBe(false);
    expect(conditionHolds(gt('guests', '10'), { guests: 11 })).toBe(true);

    // Zero-padded and fixed width, so text order is clock and calendar order.
    expect(conditionHolds(gt('starts', '09:30'), { starts: '14:00' })).toBe(true);
    expect(conditionHolds(gt('day', '2026-01-31'), { day: '2026-02-01' })).toBe(true);
  });

  it('does not order a list against a scalar', () => {
    // `String(['a','b'])` is "a,b", and comparing that to anything is an accident, not an answer.
    expect(
      conditionHolds(condition({ fieldKey: 'meals', operator: 'greaterThan', value: 'a' }), {
        meals: ['b'],
      }),
    ).toBe(false);
  });
});

describe('a field with a rule', () => {
  const field = (showWhen: unknown) =>
    Field.parse({
      id: 'f1',
      key: 'vat_number',
      type: 'short_text',
      label: { 'sv-SE': 'Momsnummer' },
      showWhen,
    });

  it('is shown when it has no rule at all', () => {
    expect(isVisible(field(undefined), {})).toBe(true);
  });

  it('needs every condition under "all" and any one under "any"', () => {
    const both = [condition(), condition({ fieldKey: 'business', value: 'true' })];
    expect(isVisible(field({ match: 'all', conditions: both }), { country: 'SE' })).toBe(false);
    expect(
      isVisible(field({ match: 'all', conditions: both }), { country: 'SE', business: 'true' }),
    ).toBe(true);
    expect(isVisible(field({ match: 'any', conditions: both }), { country: 'SE' })).toBe(true);
  });
});

describe('validation and visibility together', () => {
  const definition = (): FormDefinition => ({
    schemaVersion: 1,
    fields: [
      Field.parse({
        id: 'f1',
        key: 'business',
        type: 'yes_no',
        label: { 'sv-SE': 'Företag?' },
      }),
      Field.parse({
        id: 'f2',
        key: 'vat_number',
        type: 'short_text',
        label: { 'sv-SE': 'Momsnummer' },
        required: true,
        showWhen: {
          match: 'all',
          conditions: [condition({ fieldKey: 'business', value: 'true' })],
        },
      }),
    ],
    settings: {
      submitLabel: {},
      confirmationMessage: {},
      duplicateControl: 'none',
      allowSaveAndResume: true,
    },
  });

  /**
   * The dead end this exists to prevent: a required question behind a condition, refusing the
   * submission with an error attached to a field that is not on the page. Unfixable by the person
   * filling it in, and invisible to the person who built it.
   */
  it('does not demand a required field the conditions have hidden', () => {
    const result = validateSubmission(definition(), { business: false });
    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
    // The column still exists, so a blank means "was not asked" in every row of the export.
    expect(result.values.vat_number).toBeNull();
  });

  it('demands it again as soon as the condition holds', () => {
    const result = validateSubmission(definition(), { business: true });
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual([{ key: 'vat_number', code: 'validation.required' }]);
  });

  it('drops an answer to a hidden field rather than storing it', () => {
    // Otherwise somebody who answers, changes their mind, and flips the condition back leaves a
    // stale answer behind — and a client that never showed the field could post one deliberately.
    const result = validateSubmission(definition(), { business: false, vat_number: 'SE123' });
    expect(result.values.vat_number).toBeNull();
  });
});

describe('conditions that cannot work', () => {
  const withCondition = (fieldKey: string, order: 'before' | 'after'): FormDefinition => {
    const asker = Field.parse({
      id: 'f2',
      key: 'vat_number',
      type: 'short_text',
      label: { 'sv-SE': 'Momsnummer' },
      showWhen: { match: 'all', conditions: [condition({ fieldKey, value: 'true' })] },
    });
    const other = Field.parse({
      id: 'f1',
      key: 'business',
      type: 'yes_no',
      label: { 'sv-SE': 'Företag?' },
    });
    return {
      schemaVersion: 1,
      fields: order === 'before' ? [other, asker] : [asker, other],
      settings: {
        submitLabel: {},
        confirmationMessage: {},
        duplicateControl: 'none',
        allowSaveAndResume: true,
      },
    };
  };

  it('accepts a reference to a field above it', () => {
    expect(definitionProblems(withCondition('business', 'before'))).toEqual([]);
  });

  /** Refusing forward references is what makes cycles impossible without a cycle detector. */
  it('refuses a reference to a field below it', () => {
    expect(definitionProblems(withCondition('business', 'after'))).toContainEqual(
      expect.objectContaining({ code: 'condition-forward-reference', fieldId: 'f2' }),
    );
  });

  it('refuses a reference to a field that does not exist', () => {
    // Otherwise the condition silently never holds and the field simply never appears.
    expect(definitionProblems(withCondition('deleted_field', 'before'))).toContainEqual(
      expect.objectContaining({ code: 'condition-unknown-field', fieldId: 'f2' }),
    );
  });
});
