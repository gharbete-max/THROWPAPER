import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { importSurveyJson } from '@tp/shared/forms';

/**
 * The import panel, and the two rules it exists to honour.
 *
 * Checked in the source rather than by rendering, for the reason `field-describedby.test.ts` gives:
 * there is no DOM test setup in this workspace. What matters here is structural anyway — an import
 * replaces a whole form, and the guard against doing that by accident is a property of the markup.
 */
const SOURCE = readFileSync(new URL('./ImportSurvey.tsx', import.meta.url), 'utf8');

describe('rule 7: nothing deletes without a confirmation step', () => {
  /**
   * Importing replaces the draft. That is a delete, so it is described before it happens and
   * confirmed by a button somebody presses after reading the description.
   */
  it('warns that the current form is replaced', () => {
    expect(SOURCE).toContain("t('import.replaces')");
  });

  it('never imports straight from the paste box', () => {
    // The textarea's own handler may only hold text. Applying is a separate, deliberate press.
    expect(SOURCE).toMatch(/onChange=\{\(event\) => setText\(event\.target\.value\)\}/);
    expect(SOURCE).toMatch(/onClick=\{apply\}/);
  });

  it('will not apply a paste it could not read', () => {
    expect(SOURCE).toMatch(/if \(!preview\.ok\) return;/);
    expect(SOURCE).toMatch(/disabled=\{!preview\.ok \|\| preview\.count === 0\}/);
  });
});

describe('what it tells the author', () => {
  /**
   * The reasons are the point.
   *
   * `importSurveyJson` reports rather than guesses — a `matrix` flattened into a row of selects is
   * not the question the author wrote. That reporting is worth nothing if the screen only counts.
   */
  it('names each skipped question and why, rather than counting them', () => {
    expect(SOURCE).toContain('import.reason.');
    expect(SOURCE).toMatch(/preview\.skipped\.map/);
  });

  it('announces the summary, since it changes as somebody types', () => {
    expect(SOURCE).toMatch(/role="status"/);
  });
});

describe('the summary describes the import that will happen', () => {
  /**
   * The preview and the applied definition come from the same call, so the summary cannot lie.
   *
   * This asserts the property that makes that safe: `importSurveyJson` is pure, so mapping the
   * same text twice gives the same answer. If it ever stopped being pure, the panel would be
   * describing one import and performing another.
   */
  it('maps the same survey to the same definition every time', () => {
    const survey = {
      pages: [
        {
          elements: [
            { type: 'text', name: 'who', title: 'Your name' },
            { type: 'matrix', name: 'grid', title: 'A grid' },
          ],
        },
      ],
    };

    const first = importSurveyJson(survey);
    const second = importSurveyJson(survey);

    expect(second.definition).toEqual(first.definition);
    expect(second.skipped).toEqual(first.skipped);
    // And the fixture is doing its job: one question in, one reported.
    expect(first.definition.fields).toHaveLength(1);
    expect(first.skipped).toHaveLength(1);
  });
});
