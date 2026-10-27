import { describe, expect, it } from 'vitest';
import { FormDefinition } from '../forms/definition.js';
import { isDraftFormTask, needsAHuman, readDraft } from './draft-form.js';

const answer = (value: unknown) => `Here you go:\n\`\`\`json\n${JSON.stringify(value)}\n\`\`\``;

describe('readDraft', () => {
  it('reads fields out of prose and a code fence, and the result is a valid form', () => {
    const draft = readDraft(
      answer({
        title: 'Camp',
        fields: [
          { label: 'Name', type: 'short_text', required: true },
          { label: 'Age group', type: 'single_select', options: ['6-8', '9-12'] },
        ],
      }),
      'en-GB',
    );
    expect(draft?.title).toBe('Camp');
    expect(draft?.fields).toHaveLength(2);
    expect(() => FormDefinition.parse({ schemaVersion: 1, fields: draft?.fields })).not.toThrow();
  });

  it('keeps only what it can use', () => {
    const draft = readDraft(
      answer({
        fields: [
          { label: 'Name', type: 'nonsense' },
          { label: 'name', type: 'email' },
          { label: 'Pick', type: 'single_select', options: ['only one'] },
          { type: 'short_text' },
          'junk',
        ],
      }),
      'sv-SE',
    );
    expect(draft?.fields.map((f) => [f.type, f.label['sv-SE']])).toEqual([
      ['short_text', 'Name'],
      ['short_text', 'Pick'],
    ]);
  });

  it('gives nothing for nothing', () => {
    expect(readDraft('no json here', 'en-GB')).toBeNull();
    expect(readDraft('{"fields":[]}', 'en-GB')).toBeNull();
    expect(readDraft('{broken', 'en-GB')).toBeNull();
  });

  it('caps the number of fields', () => {
    const fields = Array.from({ length: 40 }, (_, i) => ({ label: `Q${i}`, type: 'short_text' }));
    expect(readDraft(answer({ fields }), 'en-GB')?.fields.length).toBe(14);
  });
});

describe('isDraftFormTask', () => {
  it('checks the shape and the size', () => {
    expect(isDraftFormTask({ kind: 'draft-form', request: 'a party', into: 'en-GB' })).toBe(true);
    expect(isDraftFormTask({ kind: 'draft-form', request: ' ', into: 'en-GB' })).toBe(false);
    expect(isDraftFormTask({ kind: 'draft-form', request: 'x'.repeat(401), into: 'en-GB' })).toBe(
      false,
    );
    expect(isDraftFormTask({ kind: 'draft-form', request: 'a', into: 'xx' })).toBe(false);
  });
});

describe('needsAHuman', () => {
  it.each(['a consent form', 'Waiver for the camp', 'hyresavtal', 'tax return', 'samtycke'])(
    '%s is left to a person',
    (request) => expect(needsAHuman(request)).toBe(true),
  );
  it.each(['football camp sign-up', 'birthday party', 'bokning av tvättstuga', 'taxi order'])(
    '%s is drafted',
    (request) => expect(needsAHuman(request)).toBe(false),
  );
});
