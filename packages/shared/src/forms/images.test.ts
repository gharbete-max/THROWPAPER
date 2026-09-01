import { describe, expect, it } from 'vitest';
import { Field, FormDefinition } from './definition.js';
import { answerableFields, translatableTexts } from './helpers.js';
import { validateSubmission } from './validate.js';

const ASSET = `/public/assets/${'a'.repeat(64)}.png`;

describe('images in a form', () => {
  it('accepts an image field pointing at an uploaded asset', () => {
    const field = Field.parse({
      id: 'f1',
      key: 'banner',
      type: 'image',
      src: ASSET,
      alt: { 'sv-SE': 'Vårmötets logotyp' },
    });

    expect(field).toMatchObject({ type: 'image', src: ASSET });
  });

  /**
   * A form definition is written by a customer and rendered on a public page. An arbitrary URL
   * would leak every visitor's IP address to a third-party host and hand whoever runs it control
   * over what the form appears to show.
   */
  it.each([
    ['an external URL', 'https://evil.example.com/tracker.gif'],
    ['a data URI', 'data:image/png;base64,iVBORw0KGgo='],
    ['a protocol-relative URL', '//evil.example.com/x.png'],
    ['a path outside the asset store', '/public/forms/varmotet'],
    ['an SVG extension', `/public/assets/${'a'.repeat(64)}.svg`],
    ['a traversal', '/public/assets/../../etc/passwd'],
  ])('refuses %s as an image source', (_label, src) => {
    expect(() => Field.parse({ id: 'f1', key: 'banner', type: 'image', src, alt: {} })).toThrow();
  });

  it('collects no answer, so it never reaches a submission', () => {
    const definition = FormDefinition.parse({
      schemaVersion: 1,
      fields: [
        { id: 'f1', key: 'banner', type: 'image', src: ASSET, alt: {} },
        {
          id: 'f2',
          key: 'full_name',
          type: 'short_text',
          label: { 'sv-SE': 'Namn' },
          required: true,
        },
      ],
    });

    expect(answerableFields(definition).map((field) => field.key)).toEqual(['full_name']);

    const result = validateSubmission(definition, { full_name: 'Åsa' });
    expect(result.issues).toEqual([]);
    // The image key is not a value somebody can submit, so it is not carried through either.
    expect(result.values).toEqual({ full_name: 'Åsa' });
  });

  /**
   * Alt text is translatable but not required. An empty alt means "decorative, skip it", which is
   * right for a banner; requiring it would push people to type something rather than nothing, and
   * a screen reader announcing "image" repeatedly is worse than silence.
   */
  it('offers alt text for translation without demanding it', () => {
    const definition = FormDefinition.parse({
      schemaVersion: 1,
      fields: [{ id: 'f1', key: 'banner', type: 'image', src: ASSET, alt: { 'sv-SE': 'Logotyp' } }],
    });

    const alt = translatableTexts(definition).find((text) => text.path.endsWith('.alt'));
    expect(alt).toMatchObject({ fieldId: 'f1', required: false });
  });

  it('does not ask for a label on an image, because it has none', () => {
    const definition = FormDefinition.parse({
      schemaVersion: 1,
      fields: [{ id: 'f1', key: 'banner', type: 'image', src: ASSET, alt: {} }],
    });

    expect(translatableTexts(definition).map((text) => text.path)).not.toContain('field.f1.label');
  });
});

describe('images on a choice', () => {
  it('accepts a picture per option', () => {
    const field = Field.parse({
      id: 'f1',
      key: 'meal',
      type: 'single_select',
      label: {},
      appearance: 'cards',
      options: [
        { value: 'veg', label: { 'sv-SE': 'Vegetariskt' }, image: ASSET },
        { value: 'standard', label: { 'sv-SE': 'Standard' } },
      ],
    });

    expect(field).toMatchObject({
      options: [
        { value: 'veg', image: ASSET },
        { value: 'standard', image: null },
      ],
    });
  });

  it('refuses an external image on an option, the same as anywhere else', () => {
    expect(() =>
      Field.parse({
        id: 'f1',
        key: 'meal',
        type: 'single_select',
        label: {},
        options: [{ value: 'veg', label: {}, image: 'https://evil.example.com/x.png' }],
      }),
    ).toThrow();
  });

  it('still validates an answer against the option values, not the images', () => {
    const definition = FormDefinition.parse({
      schemaVersion: 1,
      fields: [
        {
          id: 'f1',
          key: 'meal',
          type: 'single_select',
          label: {},
          required: true,
          appearance: 'cards',
          options: [
            { value: 'veg', label: {}, image: ASSET },
            { value: 'standard', label: {} },
          ],
        },
      ],
    });

    expect(validateSubmission(definition, { meal: 'veg' }).issues).toEqual([]);
    expect(validateSubmission(definition, { meal: ASSET }).issues).not.toEqual([]);
  });

  it('defaults an option written before images existed', () => {
    const field = Field.parse({
      id: 'f1',
      key: 'meal',
      type: 'multi_select',
      label: {},
      options: [{ value: 'veg', label: {} }],
    });

    expect(field).toMatchObject({ options: [{ image: null }] });
  });
});
