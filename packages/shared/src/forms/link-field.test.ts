import { describe, expect, it } from 'vitest';
import { Field } from './definition.js';
import { answerableFields } from './helpers.js';
import { FormDefinition } from './definition.js';

const base = { id: 'l1', key: 'terms', type: 'link' as const, label: { 'sv-SE': 'Läs mer' } };

describe('the link field', () => {
  it('accepts an http and an https link', () => {
    expect(() => Field.parse({ ...base, href: 'https://example.com/terms' })).not.toThrow();
    expect(() => Field.parse({ ...base, href: 'http://example.com' })).not.toThrow();
  });

  /**
   * A form is a public page and the href is written by a customer. `javascript:` here is script
   * execution against every visitor, and `data:` is a page the author controls wearing this
   * form's origin in the address bar.
   */
  it.each([
    ['javascript', 'javascript:alert(document.cookie)'],
    ['data', 'data:text/html,<script>alert(1)</script>'],
    ['file', 'file:///etc/passwd'],
    ['a bare word', 'example.com'],
    ['a protocol-relative URL', '//example.com'],
  ])('refuses a %s href', (_label, href) => {
    expect(() => Field.parse({ ...base, href })).toThrow();
  });

  it('collects no answer', () => {
    const definition = FormDefinition.parse({
      schemaVersion: 1,
      fields: [
        { ...base, href: 'https://example.com' },
        { id: 'f1', key: 'name', type: 'short_text', label: { 'sv-SE': 'Namn' }, required: true },
      ],
    });
    expect(answerableFields(definition).map((field) => field.key)).toEqual(['name']);
  });

  it('defaults to the button presentation', () => {
    expect(Field.parse({ ...base, href: 'https://example.com' })).toMatchObject({
      appearance: 'button',
    });
  });
});
