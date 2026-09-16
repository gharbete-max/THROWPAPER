import { describe, expect, it } from 'vitest';
import { acroFieldKey, importAcroFields, type AcroField } from './import-acroform.js';

/**
 * The AcroForm mapping, held to what `docs/adr/0004-old-forms-on-paper.md` argued for.
 *
 * Tested without a PDF, which is the point of the module taking field descriptors rather than
 * bytes: the mapping is the half most likely to be wrong, and it should be provable without a
 * parser, a fixture file or a browser.
 */
function field(overrides: Partial<AcroField> & Pick<AcroField, 'name' | 'type'>): AcroField {
  return overrides;
}

describe('the field types that map', () => {
  it('turns a text field into short text, and a multiline one into long text', () => {
    const { definition, skipped } = importAcroFields([
      field({ name: 'full_name', type: 'text', label: 'Full name' }),
      field({ name: 'notes', type: 'text', label: 'Notes', multiline: true }),
    ]);

    expect(skipped).toEqual([]);
    expect(definition.fields.map((f) => [f.key, f.type])).toEqual([
      ['full_name', 'short_text'],
      ['notes', 'long_text'],
    ]);
  });

  it('turns a tick box into yes/no and a signature into a signature', () => {
    const { definition } = importAcroFields([
      field({ name: 'agree', type: 'checkbox', label: 'I agree' }),
      field({ name: 'sign', type: 'signature', label: 'Signature' }),
    ]);

    expect(definition.fields.map((f) => f.type)).toEqual(['yes_no', 'signature']);
  });

  it('turns a radio group into a single select, presented as radios', () => {
    const { definition } = importAcroFields([
      field({
        name: 'meal',
        type: 'radio',
        label: 'Meal',
        options: [
          { value: 'std', label: 'Standard' },
          { value: 'veg', label: 'Vegetarian' },
        ],
      }),
    ]);

    const [choice] = definition.fields;
    if (choice?.type !== 'single_select') throw new Error('expected a single select');
    expect(choice.appearance).toBe('radio');
    expect(choice.options.map((o) => [o.value, o.label['en-GB']])).toEqual([
      ['std', 'Standard'],
      ['veg', 'Vegetarian'],
    ]);
  });

  it('reads a multi-select list box as a multi select', () => {
    const { definition } = importAcroFields([
      field({
        name: 'topics',
        type: 'choice',
        label: 'Topics',
        multiSelect: true,
        options: [{ value: 'a', label: 'A' }],
      }),
    ]);
    expect(definition.fields[0]?.type).toBe('multi_select');
  });

  it('keeps a length limit the original form set', () => {
    const { definition } = importAcroFields([
      field({ name: 'reference', type: 'text', label: 'Reference', charLimit: 12 }),
    ]);
    const [text] = definition.fields;
    if (text?.type !== 'short_text') throw new Error('expected short text');
    expect(text.maxLength).toBe(12);
  });

  it('carries the required flag', () => {
    const { definition } = importAcroFields([
      field({ name: 'a', type: 'text', label: 'A', required: true }),
      field({ name: 'b', type: 'text', label: 'B' }),
    ]);
    expect(definition.fields.map((f) => ('required' in f ? f.required : null))).toEqual([
      true,
      false,
    ]);
  });
});

describe('what it refuses', () => {
  /** A push button runs an action. There is no answer to import. */
  it('reports a push button rather than importing a field nobody fills in', () => {
    const { definition, skipped } = importAcroFields([field({ name: 'submit', type: 'button' })]);

    expect(definition.fields).toHaveLength(0);
    expect(skipped).toEqual([{ name: 'submit', type: 'button', reason: 'no-answer' }]);
  });

  /**
   * A read-only field is the document talking to itself — a total, a stamped date, a copied
   * reference. Importing one puts a box on the form that the original never asked anybody for.
   */
  it('reports a read-only field as not a question', () => {
    const { definition, skipped } = importAcroFields([
      field({ name: 'total', type: 'text', label: 'Total', readOnly: true }),
    ]);

    expect(definition.fields).toHaveLength(0);
    expect(skipped[0]?.reason).toBe('not-a-question');
  });

  it('reports a choice with no readable options', () => {
    const { definition, skipped } = importAcroFields([
      field({ name: 'meal', type: 'radio', label: 'Meal', options: [] }),
    ]);

    expect(definition.fields).toHaveLength(0);
    expect(skipped[0]?.reason).toBe('unreadable');
  });

  /**
   * The decision most easily got wrong in the convenient direction.
   *
   * A PDF text field carries no semantic type — nothing in the format distinguishes an email box
   * from a name box. Reading one out of the field's *name* is a guess dressed as a mapping, and it
   * fails silently: the author never notices, and the form rejects an address the original took.
   */
  it('never infers a field type from the field name', () => {
    const { definition } = importAcroFields([
      field({ name: 'email_address', type: 'text', label: 'Email address' }),
      field({ name: 'date_of_birth', type: 'text', label: 'Date of birth' }),
      field({ name: 'phone_number', type: 'text', label: 'Telephone' }),
    ]);

    expect(definition.fields.map((f) => f.type)).toEqual([
      'short_text',
      'short_text',
      'short_text',
    ]);
  });
});

describe('the words on the form', () => {
  /**
   * `CLAUDE.md` rule 8: extracting their text is fine, and improving it is not.
   *
   * A membership form carries data-protection wording and a trade sheet carries safety wording.
   * Nothing here may rephrase, expand or tidy either.
   */
  it('takes the label out of the document verbatim', () => {
    const stated = '  I consent to the processing of my personal data.  ';
    const { definition } = importAcroFields([
      field({ name: 'consent', type: 'checkbox', label: stated }),
    ]);

    // Trimmed, and otherwise exactly what the file said.
    expect(
      definition.fields[0] && 'label' in definition.fields[0] && definition.fields[0].label,
    ).toEqual({ 'en-GB': 'I consent to the processing of my personal data.' });
  });

  /** A label is either in the file or it is not. Inventing one is what rule 8 forbids. */
  it('falls back to the field name rather than writing a nicer question', () => {
    const { definition } = importAcroFields([
      field({ name: 'topmostSubform[0].Page1[0].f1_01[0]', type: 'text' }),
    ]);

    const [only] = definition.fields;
    if (!only || !('label' in only)) throw new Error('expected a labelled field');
    expect(only.label['en-GB']).toBe('topmostSubform[0].Page1[0].f1_01[0]');
  });

  /**
   * A PDF carries no locale, so the language is asked for rather than guessed. The alternative is
   * Swedish labels filed under `en-GB` and an author moving them by hand.
   */
  it('files the labels under the language the document is written in', () => {
    const { definition } = importAcroFields(
      [field({ name: 'namn', type: 'text', label: 'Namn' })],
      { locale: 'sv-SE' },
    );

    const [only] = definition.fields;
    if (!only || !('label' in only)) throw new Error('expected a labelled field');
    expect(only.label).toEqual({ 'sv-SE': 'Namn' });
  });
});

describe('keys', () => {
  /** PDF field names are frequently paths; the last segment is the part that means anything. */
  it('reduces a path to its last segment', () => {
    expect(acroFieldKey('topmostSubform[0].Page1[0].f1_01[0]', 0, new Set())).toBe('f1_01');
    expect(acroFieldKey('Full Name', 0, new Set())).toBe('full_name');
  });

  it('starts a key with a letter, because the schema requires one', () => {
    expect(acroFieldKey('1st_choice', 0, new Set())).toMatch(/^[a-z]/);
  });

  it('falls back to a position when the name reduces to nothing', () => {
    expect(acroFieldKey('___', 4, new Set())).toBe('field_5');
  });

  /**
   * Two fields sharing a key silently merge their answers into one column, which is the whole
   * reason `duplicateKeys` exists. A PDF with repeated field names is ordinary.
   */
  it('never lets two fields share a key', () => {
    const { definition } = importAcroFields([
      field({ name: 'name', type: 'text', label: 'Name' }),
      field({ name: 'name', type: 'text', label: 'Name again' }),
      field({ name: 'Page2[0].name', type: 'text', label: 'And again' }),
    ]);

    const keys = definition.fields.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual(['name', 'name_2', 'name_3']);
  });

  /** A rejected field must not leave its key reserved, or the next one is needlessly suffixed. */
  it('releases the key of a field it then refuses', () => {
    const { definition } = importAcroFields([
      field({ name: 'meal', type: 'radio', label: 'Meal', options: [] }),
      field({ name: 'meal', type: 'text', label: 'Meal' }),
    ]);

    expect(definition.fields.map((f) => f.key)).toEqual(['meal']);
  });
});

describe('the result is a form this product would accept', () => {
  /**
   * The closing `FormDefinition.parse` is the safety net, exactly as in the SurveyJS importer: a
   * mapping that produces something subtly invalid fails in this module's tests rather than in
   * somebody's form.
   */
  it('produces a definition with no publish-blocking problems', async () => {
    const { definitionProblems } = await import('./helpers.js');
    const { definition } = importAcroFields([
      field({ name: 'full_name', type: 'text', label: 'Full name', required: true }),
      field({ name: 'notes', type: 'text', label: 'Notes', multiline: true }),
      field({
        name: 'meal',
        type: 'radio',
        label: 'Meal',
        options: [{ value: 'std', label: 'Standard' }],
      }),
      field({ name: 'sign', type: 'signature', label: 'Signature' }),
    ]);

    expect(definitionProblems(definition)).toEqual([]);
  });

  it('refuses nothing and collects nothing from an empty document', () => {
    const { definition, skipped } = importAcroFields([]);
    expect(definition.fields).toEqual([]);
    expect(skipped).toEqual([]);
  });
});
