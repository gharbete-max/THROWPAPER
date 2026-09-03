import { describe, expect, it } from 'vitest';
import { LOCALE_CODES } from '@tp/i18n';
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
   * Every template ships in **every** language the product does.
   *
   * A template's text is copied into the author's draft when they pick it, so it cannot fall back
   * to a message catalogue the way the interface does — whatever is missing here is missing in
   * their form, and they have no way of telling which strings were meant to be ours.
   *
   * Driven by `LOCALE_CODES` rather than a list written here, so adding a thirteenth language
   * fails this test rather than quietly shipping eighteen half-translated templates.
   */
  it.each(FORM_TEMPLATES.map((template) => [template.id, template] as const))(
    '%s is complete in every shipped language',
    (_id, template) => {
      const gaps: string[] = [];
      for (const locale of LOCALE_CODES) {
        if (!template.name[locale]?.trim()) gaps.push(`name (${locale})`);
        if (!template.description[locale]?.trim()) gaps.push(`description (${locale})`);
      }
      for (const text of translatableTexts(template.definition).filter((each) => each.required)) {
        for (const locale of LOCALE_CODES) {
          if (!text.text[locale]?.trim()) gaps.push(`${text.path} (${locale})`);
        }
      }
      expect(gaps).toEqual([]);
    },
  );

  it.each(FORM_TEMPLATES.map((template) => [template.id, template] as const))(
    '%s labels every choice in every shipped language',
    (_id, template) => {
      const gaps: string[] = [];
      for (const field of template.definition.fields) {
        if (!('options' in field)) continue;
        for (const option of field.options) {
          for (const locale of LOCALE_CODES) {
            if (!option.label[locale]?.trim())
              gaps.push(`${field.key}/${option.value} (${locale})`);
          }
        }
      }
      expect(gaps).toEqual([]);
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
      ];

      const haystack = JSON.stringify(template).toLowerCase();
      const found = forbidden.filter((word) => haystack.includes(word));
      expect(found, `${template.id} mentions ${found.join(', ')}`).toEqual([]);
    },
  );

  /**
   * A signature is a control, not a claim.
   *
   * "signature" and "underskrift" used to sit in the forbidden list above, from before the field
   * type existed — which would now ban the one template that most needs one. The wording is what
   * rule 8 is about, so this checks the wording instead, and checks it harder: a signature in a
   * shipped template must not assert anything. Whatever it confirms is for a person to write, so
   * the statement has to read as a placeholder.
   */
  it.each(
    FORM_TEMPLATES.flatMap((template) =>
      template.definition.fields
        .filter((field) => field.type === 'signature')
        .map((field) => [`${template.id}/${field.key}`, field] as const),
    ),
  )('%s asserts nothing a person did not write', (_id, field) => {
    const statement = 'statement' in field ? (field.statement ?? {}) : {};
    for (const locale of LOCALE_CODES) {
      const text = statement[locale] ?? '';
      expect(text, `${locale} statement`).toBeTruthy();
      // A bracketed placeholder, in any script. Anything else is a declaration this file wrote.
      expect(
        /^[[［].*[\]］]$/su.test(text.trim()),
        `${locale}: "${text}" reads as a declaration rather than a placeholder`,
      ).toBe(true);
    }
  });

  it('answers a filled-in submission the way the author would expect', () => {
    const template = findTemplate('contact-enquiry');
    expect(template).not.toBeNull();

    const result = validateSubmission(template!.definition, {
      full_name: 'Åsa Öqvist',
      email: 'asa@example.com',
      topic: 'sales',
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
