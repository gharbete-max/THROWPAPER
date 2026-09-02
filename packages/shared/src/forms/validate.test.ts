import { describe, expect, it } from 'vitest';
import { Field, emptyDefinition, validateSubmission, type FormDefinition } from './index.js';

function definitionWith(...fields: unknown[]): FormDefinition {
  return { ...emptyDefinition, fields: fields.map((field) => Field.parse(field)) };
}

const text = {
  id: 'f1',
  key: 'first_name',
  type: 'short_text',
  label: { 'sv-SE': 'Förnamn' },
  required: true,
};

describe('required', () => {
  const definition = definitionWith(text);

  it('rejects a missing answer', () => {
    const result = validateSubmission(definition, {});
    expect(result.ok).toBe(false);
    expect(result.issues[0]).toEqual({ key: 'first_name', code: 'validation.required' });
  });

  it('treats whitespace as missing', () => {
    expect(validateSubmission(definition, { first_name: '   ' }).ok).toBe(false);
  });

  it('accepts an answer and trims it', () => {
    const result = validateSubmission(definition, { first_name: '  Alva ' });
    expect(result.ok).toBe(true);
    expect(result.values['first_name']).toBe('Alva');
  });

  it('does not demand required answers on a partial save', () => {
    expect(validateSubmission(definition, {}, { partial: true }).ok).toBe(true);
  });
});

describe('per-type rules', () => {
  it('checks email shape and lower-cases it', () => {
    const definition = definitionWith({ ...text, key: 'email', type: 'email' });
    expect(validateSubmission(definition, { email: 'nope' }).issues[0]?.code).toBe(
      'validation.email',
    );
    expect(validateSubmission(definition, { email: 'Alva@Example.COM' }).values['email']).toBe(
      'alva@example.com',
    );
  });

  it('enforces number bounds and accepts a Swedish decimal comma', () => {
    const definition = definitionWith({
      ...text,
      key: 'guests',
      type: 'number',
      min: 1,
      max: 3,
    });
    expect(validateSubmission(definition, { guests: 0 }).issues[0]?.code).toBe('validation.min');
    expect(validateSubmission(definition, { guests: 9 }).issues[0]?.code).toBe('validation.max');
    expect(validateSubmission(definition, { guests: '2,5' }).values['guests']).toBe(2.5);
    expect(validateSubmission(definition, { guests: 'many' }).issues[0]?.code).toBe(
      'validation.number',
    );
  });

  it('rejects an option that is not on the list — the client cannot invent choices', () => {
    const definition = definitionWith({
      ...text,
      key: 'meal',
      type: 'single_select',
      options: [{ value: 'veg', label: { 'sv-SE': 'Vegetariskt' } }],
    });
    expect(validateSubmission(definition, { meal: 'steak' }).issues[0]?.code).toBe(
      'validation.option',
    );
    expect(validateSubmission(definition, { meal: 'veg' }).ok).toBe(true);
  });

  it('enforces multi-select bounds', () => {
    const definition = definitionWith({
      ...text,
      key: 'sessions',
      type: 'multi_select',
      minSelected: 1,
      maxSelected: 2,
      options: [
        { value: 'a', label: {} },
        { value: 'b', label: {} },
        { value: 'c', label: {} },
      ],
    });
    expect(validateSubmission(definition, { sessions: ['a', 'b', 'c'] }).issues[0]?.code).toBe(
      'validation.maxSelected',
    );
    expect(validateSubmission(definition, { sessions: ['a'] }).ok).toBe(true);
  });

  it('checks date shape and bounds', () => {
    const definition = definitionWith({
      ...text,
      key: 'arrival',
      type: 'date',
      min: '2026-05-01',
    });
    expect(validateSubmission(definition, { arrival: '14/05/2026' }).issues[0]?.code).toBe(
      'validation.date',
    );
    expect(validateSubmission(definition, { arrival: '2026-04-01' }).issues[0]?.code).toBe(
      'validation.dateMin',
    );
    expect(validateSubmission(definition, { arrival: '2026-05-14' }).ok).toBe(true);
  });

  it('accepts yes/no as a boolean or its string form', () => {
    const definition = definitionWith({ ...text, key: 'dietary', type: 'yes_no' });
    expect(validateSubmission(definition, { dietary: 'true' }).values['dietary']).toBe(true);
    expect(validateSubmission(definition, { dietary: 'maybe' }).issues[0]?.code).toBe(
      'validation.yesNo',
    );
  });

  it('refuses everything when an operator pattern will not compile', () => {
    const definition = definitionWith({ ...text, pattern: '([unclosed' });
    expect(validateSubmission(definition, { first_name: 'anything' }).issues[0]?.code).toBe(
      'validation.pattern',
    );
  });
});

describe('the server does not trust the client', () => {
  it('drops answers for fields that are not in the definition', () => {
    const definition = definitionWith(text);
    const result = validateSubmission(definition, { first_name: 'Alva', is_admin: true });
    expect(result.ok).toBe(true);
    expect(result.values).not.toHaveProperty('is_admin');
  });

  it('ignores answers to presentational fields', () => {
    const definition = definitionWith(text, {
      id: 'f2',
      key: 'intro',
      type: 'rich_text',
      content: { 'sv-SE': 'Hej' },
    });
    const result = validateSubmission(definition, { first_name: 'Alva', intro: 'injected' });
    expect(result.values).not.toHaveProperty('intro');
  });
});

describe('issues are keys, not sentences', () => {
  it('returns a message key and parameters so the caller can translate', () => {
    const definition = definitionWith({ ...text, key: 'guests', type: 'number', max: 3 });
    const issue = validateSubmission(definition, { guests: 10 }).issues[0];
    expect(issue?.code).toMatch(/^validation\./);
    expect(issue?.params).toEqual({ max: 3 });
    // No human-readable English leaked into the result.
    expect(JSON.stringify(issue)).not.toMatch(/too (large|many)/i);
  });
});

/**
 * `decimalPlaces` used to read the digits out of `String(value)`.
 *
 * JavaScript prints anything below 1e-6 in exponential notation, so `String(0.0000001)` is
 * `"1e-7"`: no `.` to find, zero decimals reported, and a `decimals: 0` rule that a visitor could
 * walk straight past by typing a small enough number. Found by an audit, not by a failing test —
 * hence this one.
 */
describe('counting decimal places', () => {
  const field = (decimals: number) =>
    Field.parse({
      id: 'f1',
      key: 'amount',
      type: 'number',
      label: { 'sv-SE': 'Belopp' },
      decimals,
    });

  const form = (decimals: number): FormDefinition => ({
    schemaVersion: 1,
    fields: [field(decimals)],
    settings: emptyDefinition.settings,
  });

  it('rejects a small number written in full, which prints as an exponent', () => {
    const result = validateSubmission(form(0), { amount: '0.0000001' });
    expect(result.issues).toEqual([
      { key: 'amount', code: 'validation.decimals', params: { decimals: 0 } },
    ]);
  });

  it('still counts ordinary decimals', () => {
    expect(validateSubmission(form(2), { amount: '1.25' }).ok).toBe(true);
    expect(validateSubmission(form(2), { amount: '1.256' }).ok).toBe(false);
    expect(validateSubmission(form(0), { amount: '100' }).ok).toBe(true);
    expect(validateSubmission(form(0), { amount: '100.5' }).ok).toBe(false);
  });

  it('accepts a small number when that many places are allowed', () => {
    // Six is the schema's cap on `decimals`, and 1e-6 is exactly where JavaScript stops printing
    // a plain decimal — so this is the boundary the old implementation got right by luck.
    expect(validateSubmission(form(6), { amount: '0.000001' }).ok).toBe(true);
    expect(validateSubmission(form(6), { amount: '0.0000001' }).ok).toBe(false);
  });

  it('counts a value typed in exponential notation', () => {
    // `2.5e-3` is 0.0025 — four places, whichever way it was written.
    expect(validateSubmission(form(4), { amount: '2.5e-3' }).ok).toBe(true);
    expect(validateSubmission(form(3), { amount: '2.5e-3' }).ok).toBe(false);
  });
});

/**
 * A number field silently rewrote long answers.
 *
 * `Number('1234567890123456789')` is `1234567890123456800`. An author reaches for a number field
 * for an account number, an organisation number or a long reference, and before this the answer
 * was changed on the way in — no error, no warning, wrong digits in the export. Rule 5.
 */
describe('numbers a double cannot hold', () => {
  const form = (): FormDefinition => ({
    schemaVersion: 1,
    fields: [
      Field.parse({ id: 'f1', key: 'account', type: 'number', label: { 'sv-SE': 'Konto' } }),
    ],
    settings: emptyDefinition.settings,
  });

  const check = (account: string) => validateSubmission(form(), { account });

  it.each([
    ['1234567890123456789', 'a 19-digit account number'],
    ['12345678901234567890', 'a 20-digit reference'],
    ['9007199254740993', 'one past the last exactly representable integer'],
  ])('refuses %s — %s', (account) => {
    expect(check(account).issues).toEqual([{ key: 'account', code: 'validation.precision' }]);
  });

  it.each([
    ['5560160680', 'a Swedish organisation number'],
    ['0.1', 'an ordinary decimal'],
    ['123.456', 'a measurement'],
    ['1.50', 'trailing zeros, which are not extra precision'],
    ['007', 'leading zeros'],
    ['-42', 'a negative'],
    ['-0', 'negative zero, which is zero'],
    ['1000000000000000000', 'nineteen digits that happen to be a power of ten'],
    ['9007199254740992', 'the last exactly representable integer'],
  ])('accepts %s — %s', (account) => {
    expect(check(account).ok, account).toBe(true);
  });

  it('accepts a comma as the decimal separator, as it always did', () => {
    const result = validateSubmission(form(), { account: '1,5' });
    expect(result.ok).toBe(true);
    expect(result.values.account).toBe(1.5);
  });

  /**
   * The counting rule this replaced would have been wrong in both directions: sixteen significant
   * digits are sometimes exact, and fifteen are not always enough. Round-tripping asks directly.
   */
  it('judges by round-tripping, not by counting digits', () => {
    expect(check('1000000000000000000').ok).toBe(true);
    expect(check('1000000000000000001').ok).toBe(false);
  });
});
