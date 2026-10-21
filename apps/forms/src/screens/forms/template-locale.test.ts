import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Our text resolves against the interface languages; the customer's against theirs.
 *
 * These are two different lists and the difference is invisible until somebody reads the app in a
 * language their organisation does not publish in. Then it bites: the template gallery rendered
 * every name and description with `pickText(locales, …)` — the organisation's *publish* languages
 * — so an operator reading the app in Japanese, in an organisation publishing in Swedish and
 * English, got Swedish template names under Japanese headings. Every template already carried a
 * Japanese name. Nothing was asking for it.
 *
 * A template is shipped by this product in all twelve languages, like a button label, so it
 * follows the reader. A form title is the organisation's content and correctly does not.
 *
 * Checked in the source because that is where the mistake lives — both calls type-check, both
 * return a string, and the wrong one is only wrong for people who are not in the room.
 */
const SOURCE = readFileSync(new URL('./Forms.tsx', import.meta.url), 'utf8');

describe('the template gallery', () => {
  it('resolves our own text against the interface languages', () => {
    // Every pickText call in this file, with the arguments it was given.
    const calls = [...SOURCE.matchAll(/pickText\(\s*(\w+)\s*,\s*([^,]+),/g)].map((match) => ({
      list: match[1]!,
      text: match[2]!.trim(),
    }));

    expect(calls.length).toBeGreaterThan(3);

    const wrong = calls
      .filter((call) => call.text.startsWith('template.'))
      .filter((call) => call.list !== 'interfaceLocales');

    expect(
      wrong.map((call) => `pickText(${call.list}, ${call.text})`),
      'template text must follow the reader, not the organisation',
    ).toEqual([]);
  });

  it('still resolves the organisation’s own content against its languages', () => {
    // The other half of the rule, so a well-meaning sweep does not swap every call at once.
    const formTitles = [...SOURCE.matchAll(/pickText\(\s*(\w+)\s*,\s*form\.title/g)].map(
      (match) => match[1],
    );

    expect(formTitles.length).toBeGreaterThan(0);
    expect(formTitles.every((list) => list === 'locales')).toBe(true);
  });
});
