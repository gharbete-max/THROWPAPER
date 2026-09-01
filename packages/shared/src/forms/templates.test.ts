import { describe, expect, it } from 'vitest';
import { FORM_TEMPLATES, FormTemplate, findTemplate } from './templates.js';
import { FormDefinition } from './definition.js';
import { answerableFields, pagesOf, translatableTexts } from './helpers.js';
import { validateSubmission } from './validate.js';

/**
 * The point of these tests is that a template is content shipped as code, and content rots
 * silently. A field type gaining a required property would leave every template that uses it
 * invalid, and nobody would find out until an author picked one — so the build finds out instead.
 */
describe('the template catalogue', () => {
  it('is not empty and has no duplicate ids', () => {
    expect(FORM_TEMPLATES.length).toBeGreaterThan(0);
    const ids = FORM_TEMPLATES.map((template) => template.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(FORM_TEMPLATES.map((template) => [template.id, template] as const))(
    '%s is a valid template',
    (_id, template) => {
      expect(() => FormTemplate.parse(template)).not.toThrow();
      expect(() => FormDefinition.parse(template.definition)).not.toThrow();
    },
  );

  it.each(FORM_TEMPLATES.map((template) => [template.id, template] as const))(
    '%s collects something and can actually be published',
    (_id, template) => {
      // A template that collects nothing fails the publish check; better to catch it here.
      expect(answerableFields(template.definition).length).toBeGreaterThan(0);
      expect(pagesOf(template.definition).length).toBeGreaterThan(0);
    },
  );

  it.each(FORM_TEMPLATES.map((template) => [template.id, template] as const))(
    '%s has unique field keys and ids',
    (_id, template) => {
      const keys = template.definition.fields.map((field) => field.key);
      const ids = template.definition.fields.map((field) => field.id);
      // A duplicate key silently loses answers, which is the worst kind of template defect.
      expect(new Set(keys).size).toBe(keys.length);
      expect(new Set(ids).size).toBe(ids.length);
    },
  );

  /**
   * Every template ships in both languages the product supports. A half-translated template is
   * worse than an English-only one: the author cannot tell which strings are theirs to finish.
   */
  it.each(FORM_TEMPLATES.map((template) => [template.id, template] as const))(
    '%s is complete in both sv-SE and en-GB',
    (_id, template) => {
      expect(template.name['sv-SE']).toBeTruthy();
      expect(template.name['en-GB']).toBeTruthy();
      expect(template.description['sv-SE']).toBeTruthy();
      expect(template.description['en-GB']).toBeTruthy();

      const missing = translatableTexts(template.definition)
        .filter((text) => text.required)
        .filter((text) => !text.text['sv-SE'] || !text.text['en-GB'])
        .map((text) => text.path);
      expect(missing).toEqual([]);
    },
  );

  it.each(FORM_TEMPLATES.map((template) => [template.id, template] as const))(
    '%s labels every choice in both languages',
    (_id, template) => {
      for (const field of template.definition.fields) {
        if (!('options' in field)) continue;
        for (const option of field.options) {
          expect(option.label['sv-SE'], `${field.key}/${option.value}`).toBeTruthy();
          expect(option.label['en-GB'], `${field.key}/${option.value}`).toBeTruthy();
        }
      }
    },
  );

  /**
   * `CLAUDE.md` rule 8 and `SPEC-forms.md` §8: templates must not carry legal, clinical, tax or
   * safety-critical wording, because a plausible-looking one written here would be sent out.
   *
   * A word list cannot prove absence, and this one is not pretending to. What it does is fail
   * loudly the moment somebody adds a template that reaches for those categories, which makes the
   * boundary a decision rather than something that erodes one well-meaning template at a time.
   */
  it.each(FORM_TEMPLATES.map((template) => [template.id, template] as const))(
    '%s stays out of the regulated categories',
    (_id, template) => {
      const forbidden = [
        'samtycke',
        'consent',
        'gdpr',
        'diagnos',
        'diagnosis',
        'symptom',
        'medicin',
        'medication',
        'moms',
        'vat number',
        'skatt',
        'tax',
        'personnummer',
        'social security',
        'olycka',
        'accident',
        'incident',
        'tillbud',
        'avtal',
        'contract',
        'villkor',
        'terms and conditions',
        'signature',
        'underskrift',
      ];

      const haystack = JSON.stringify(template).toLowerCase();
      const found = forbidden.filter((word) => haystack.includes(word));
      expect(found, `${template.id} mentions ${found.join(', ')}`).toEqual([]);
    },
  );

  it('answers a filled-in submission the way the author would expect', () => {
    const template = findTemplate('contact-enquiry');
    expect(template).not.toBeNull();

    const result = validateSubmission(template!.definition, {
      full_name: 'Åsa Öqvist',
      email: 'asa@example.com',
      topic: 'quote',
      message: 'Hej!',
    });
    expect(result.issues).toEqual([]);

    // And still refuses what it should.
    expect(validateSubmission(template!.definition, { full_name: 'Åsa' }).issues).not.toEqual([]);
  });

  it('returns null for an id nobody shipped', () => {
    expect(findTemplate('does-not-exist')).toBeNull();
  });
});
