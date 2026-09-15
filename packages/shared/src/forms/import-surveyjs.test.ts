import { describe, expect, it } from 'vitest';
import { FormDefinition } from './definition.js';
import { importSurveyJson } from './import-surveyjs.js';

/**
 * Fixtures are written here rather than copied out of `surveyjs/survey-library`.
 *
 * Their repository is MIT, so vendoring a file would be allowed — and would drag a licence notice
 * and an attribution obligation into the test suite for the sake of a fixture we can write in
 * twelve lines. What their files are genuinely useful for is *checking* this against real output,
 * which was done while building it: their four-page history quiz imports to eleven fields with
 * nothing skipped. These fixtures cover the mapping table instead, which that one file does not.
 */
function survey(...elements: Array<Record<string, unknown>>) {
  return { pages: [{ elements }] };
}

describe('question types with an equivalent here', () => {
  it.each([
    ['text', {}, 'short_text'],
    ['text', { inputType: 'email' }, 'email'],
    ['text', { inputType: 'tel' }, 'phone'],
    ['text', { inputType: 'number' }, 'number'],
    ['text', { inputType: 'date' }, 'date'],
    ['text', { inputType: 'time' }, 'time'],
    /* Not `link`: that is presentational decoration, not a box somebody types a URL into. */
    ['text', { inputType: 'url' }, 'short_text'],
    ['comment', {}, 'long_text'],
    ['boolean', {}, 'yes_no'],
    ['rating', {}, 'rating'],
    ['slider', {}, 'rating'],
    ['file', {}, 'file'],
    ['signaturepad', {}, 'signature'],
  ])('maps %s %o to %s', (type, extra, expected) => {
    const { definition, skipped } = importSurveyJson(
      survey({ type, name: 'q', title: 'A question', ...extra }),
    );

    expect(skipped).toEqual([]);
    expect(definition.fields[0]?.type).toBe(expected);
  });

  /** Their four single-choice flavours are one type of ours plus an appearance. */
  it.each([
    ['radiogroup', 'single_select', 'radio'],
    ['dropdown', 'single_select', 'dropdown'],
    ['buttongroup', 'single_select', 'buttons'],
    ['imagepicker', 'single_select', 'cards'],
    ['checkbox', 'multi_select', 'checkboxes'],
    ['tagbox', 'multi_select', 'checkboxes'],
  ])('maps %s to %s drawn as %s', (type, expected, appearance) => {
    const { definition } = importSurveyJson(
      survey({ type, name: 'q', title: 'Pick', choices: ['One', 'Two'] }),
    );

    const field = definition.fields[0];
    expect(field?.type).toBe(expected);
    expect(field && 'appearance' in field ? field.appearance : undefined).toBe(appearance);
  });
});

/**
 * The gap against their taxonomy, asserted rather than described. Each of these is a change to
 * `FIELD_TYPES`, which that file calls "a scope change, not a detail" — so the importer reports
 * them and does not invent one. A `matrix` flattened into a row of selects is not the question the
 * author wrote, and somebody would discover that after collecting answers.
 */
describe('question types with no equivalent', () => {
  it.each([
    'matrix',
    'matrixdropdown',
    'matrixdynamic',
    'paneldynamic',
    'ranking',
    'expression',
    'multipletext',
  ])('reports %s rather than guessing', (type) => {
    const { definition, skipped } = importSurveyJson(survey({ type, name: 'grid', title: 'X' }));

    expect(definition.fields).toHaveLength(0);
    expect(skipped).toEqual([{ type, name: 'grid', reason: 'no-equivalent' }]);
  });

  /**
   * Their image points anywhere on the web; ours is a path into this organisation's own store.
   * Importing one means fetching and re-hosting a remote file, which is not something a pure
   * function that reads a document should be doing.
   */
  it('reports an image as needing an asset', () => {
    const { skipped } = importSurveyJson(
      survey({ type: 'image', name: 'logo', imageLink: 'https://example.test/a.png' }),
    );
    expect(skipped).toEqual([{ type: 'image', name: 'logo', reason: 'needs-asset' }]);
  });

  it('reports a type it has never heard of', () => {
    const { skipped } = importSurveyJson(survey({ type: 'hypercube', name: 'q' }));
    expect(skipped[0]).toMatchObject({ type: 'hypercube', reason: 'unknown-type' });
  });
});

describe('keys', () => {
  /** Our key is what a CSV column is called, so it has to satisfy `^[a-z][a-z0-9_]*$`. */
  it('sanitises a name rather than refusing the import', () => {
    const { definition } = importSurveyJson(
      survey({ type: 'text', name: 'Name (first)', title: 'First name' }),
    );
    expect(definition.fields[0]?.key).toBe('name_first');
  });

  it('prefixes a name that does not start with a letter', () => {
    const { definition } = importSurveyJson(survey({ type: 'text', name: '1st', title: 'First' }));
    expect(definition.fields[0]?.key).toMatch(/^[a-z]/);
  });

  /**
   * Their own example survey has four questions all named `civilwar`. Dropping three would drop
   * three answers, so they are suffixed instead.
   */
  it('keeps every question when names collide', () => {
    const { definition } = importSurveyJson(
      survey(
        { type: 'text', name: 'civilwar', title: 'When?' },
        { type: 'text', name: 'civilwar', title: 'When?' },
        { type: 'text', name: 'civilwar', title: 'When?' },
      ),
    );

    expect(definition.fields.map((field) => field.key)).toEqual([
      'civilwar',
      'civilwar_2',
      'civilwar_3',
    ]);
  });
});

describe('text and localisation', () => {
  it('reads a title given per language, widening a bare code to the tag we use', () => {
    const { definition } = importSurveyJson(
      survey({ type: 'text', name: 'q', title: { default: 'Name', de: 'Name', sv: 'Namn' } }),
    );

    const field = definition.fields[0];
    expect(field && 'label' in field ? field.label : undefined).toEqual({
      'en-GB': 'Name',
      'de-DE': 'Name',
      'sv-SE': 'Namn',
    });
  });

  it('carries a description across as help text', () => {
    const { definition } = importSurveyJson(
      survey({ type: 'text', name: 'q', title: 'Name', description: 'As it appears on your card' }),
    );
    const field = definition.fields[0];
    expect(field && 'helpText' in field ? field.helpText : undefined).toEqual({
      'en-GB': 'As it appears on your card',
    });
  });

  it('carries isRequired across', () => {
    const { definition } = importSurveyJson(
      survey({ type: 'text', name: 'q', title: 'Name', isRequired: true }),
    );
    const field = definition.fields[0];
    expect(field && 'required' in field ? field.required : undefined).toBe(true);
  });
});

/**
 * `rich_text` holds plain text, and its schema says why: "Not HTML — that would be a stored-XSS
 * surface." Markup arriving from a file somebody else wrote is exactly the case that rule is for.
 */
describe('their html block', () => {
  it('strips the markup rather than storing it', () => {
    const { definition } = importSurveyJson(
      survey({ type: 'html', html: '<p>Read <b>this</b> first &amp; then answer.</p>' }),
    );

    const field = definition.fields[0];
    expect(field?.type).toBe('rich_text');
    const content = field && 'content' in field ? (field.content as Record<string, string>) : {};
    expect(content['en-GB']).toBe('Read this first & then answer.');
    expect(content['en-GB']).not.toContain('<');
  });

  /** A block-level tag is a paragraph break; a heading run into its sentence is a different text. */
  it('turns a line break into a line break', () => {
    const { definition } = importSurveyJson(survey({ type: 'html', html: 'One<br>Two' }));
    const field = definition.fields[0];
    const content = field && 'content' in field ? (field.content as Record<string, string>) : {};
    expect(content['en-GB']).toBe('One\nTwo');
  });

  /**
   * The ordering bug this caught: their `html` question has neither `title` nor `name`, so a
   * label check running first rejected it before the branch that does not need one.
   */
  it('imports even with no title and no name', () => {
    const { definition, skipped } = importSurveyJson(survey({ type: 'html', html: 'Hello' }));
    expect(skipped).toEqual([]);
    expect(definition.fields[0]?.type).toBe('rich_text');
  });
});

describe('the document as a whole', () => {
  /** Their pages are the nearest thing we have to a page break, and the only thing. */
  it('puts a page break between pages, but not before the first', () => {
    const { definition } = importSurveyJson({
      pages: [
        { elements: [{ type: 'text', name: 'a', title: 'A' }] },
        { elements: [{ type: 'text', name: 'b', title: 'B' }] },
      ],
    });

    expect(definition.fields.map((field) => field.type)).toEqual([
      'short_text',
      'page_break',
      'short_text',
    ]);
  });

  /**
   * `page_break` is `{ id, key, type }` and nothing else. Passing a label is not an error — Zod
   * strips it — so the field arrives blank and the mistake shows up in a builder rather than here.
   */
  it('produces a page break the schema actually accepts', () => {
    const { definition } = importSurveyJson({
      pages: [{ elements: [{ type: 'text', name: 'a', title: 'A' }] }, { elements: [] }],
    });

    const separator = definition.fields.find((field) => field.type === 'page_break');
    expect(separator).toBeDefined();
    expect(Object.keys(separator ?? {}).sort()).toEqual(['id', 'key', 'type']);
  });

  it('reads a survey that puts its questions at the top level', () => {
    const { definition } = importSurveyJson({
      elements: [{ type: 'text', name: 'a', title: 'A' }],
    });
    expect(definition.fields).toHaveLength(1);
  });

  it('returns an empty form for an empty survey rather than throwing', () => {
    expect(importSurveyJson({}).definition.fields).toEqual([]);
  });

  /**
   * The output has to be a document the builder can open. Parsed rather than asserted field by
   * field, so a mapping that produces something subtly invalid fails here rather than in a form.
   */
  it('always produces a definition that parses', () => {
    const { definition } = importSurveyJson(
      survey(
        { type: 'text', name: 'a', title: 'A', isRequired: true },
        { type: 'radiogroup', name: 'b', title: 'B', choices: [{ value: '1', text: 'One' }] },
        { type: 'html', html: '<p>Note</p>' },
      ),
    );
    expect(() => FormDefinition.parse(definition)).not.toThrow();
  });

  it('refuses a document that is not a survey at all', () => {
    expect(() => importSurveyJson('not a survey')).toThrow();
  });

  /** A choice question with nothing readable to choose from is not a choice question. */
  it('reports a select with no usable choices', () => {
    const { skipped } = importSurveyJson(
      survey({ type: 'radiogroup', name: 'q', title: 'Pick', choices: [] }),
    );
    expect(skipped[0]).toMatchObject({ type: 'radiogroup', reason: 'unreadable' });
  });
});
