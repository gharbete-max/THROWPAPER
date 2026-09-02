import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CONDITION_OPERATORS,
  FIELD_TYPES,
  MULTI_SELECT_APPEARANCES,
  SINGLE_SELECT_APPEARANCES,
  YES_NO_APPEARANCES,
} from '@tp/shared/forms';
import { THEME_PRESET_IDS } from '@tp/tokens';
import { LOCALE_CODES } from '@tp/i18n';
import { TRANSLATED_LOCALES } from './messages/index.js';
import { messages } from './messages/all.js';
import { PALETTE_GROUPS } from '../screens/builder/field-defaults.js';

/**
 * A missing key renders as the key itself — `fieldType.image` appeared in the palette exactly like
 * that, in front of anybody building a form, for as long as the image field existed.
 *
 * Nothing else catches it: the app compiles, the tests pass, and the string only shows up on a
 * screen somebody happens to open. So the check is here, driven by the schema rather than by a
 * list that would need remembering.
 */
describe('translations for schema-driven strings', () => {
  it.each(FIELD_TYPES)('names the %s field type', (type) => {
    expect(messages[`fieldType.${type}`], `fieldType.${type}`).toBeDefined();
  });

  it.each([
    ...new Set([...SINGLE_SELECT_APPEARANCES, ...MULTI_SELECT_APPEARANCES, ...YES_NO_APPEARANCES]),
  ])('names the %s appearance', (appearance) => {
    expect(messages[`field.appearance.${appearance}`], appearance).toBeDefined();
  });

  /**
   * The palette headings. Splitting a group because it grew past six types is a two-file change,
   * and this is the file that gets forgotten — the new heading would render as `palette.numbers`
   * above the fields it names.
   */
  /** An unnamed operator would put `visibility.operator.greaterThan` in a dropdown. */
  it.each(CONDITION_OPERATORS)('names the %s condition operator', (operator) => {
    expect(messages[`visibility.operator.${operator}`], operator).toBeDefined();
  });

  /** A shipped theme with no name shows as `theme.garden` under its own swatch. */
  it.each(THEME_PRESET_IDS)('names the %s theme', (id) => {
    expect(messages[`theme.${id}`], id).toBeDefined();
  });

  it.each(PALETTE_GROUPS.map((group) => group.id))('names the %s palette group', (id) => {
    expect(messages[`palette.${id}`], `palette.${id}`).toBeDefined();
  });

  /**
   * Every reason a form cannot be published must be sayable.
   *
   * These were rendered from `problem.message` — English sentences written in `packages/shared`,
   * shown straight to the operator. The only place in the product where an English string reached
   * a Swedish screen, and rule 4 says exactly that must not happen. Read out of the union in
   * `helpers.ts` rather than from a list beside it, because a list beside it is what drifts.
   */
  it('can say every reason a form cannot be published', () => {
    const source = readFileSync(
      new URL('../../../../packages/shared/src/forms/helpers.ts', import.meta.url),
      'utf8',
    );
    const union = /export interface DefinitionProblem \{\s*code:([^;]+);/.exec(source)?.[1] ?? '';
    const codes = [...union.matchAll(/'([a-z-]+)'/g)].map((match) => match[1]!);

    expect(codes.length).toBeGreaterThan(3);
    expect(codes.filter((code) => !messages[`problem.${code}`])).toEqual([]);
  });

  /**
   * Every shipped language, for every string.
   *
   * The type already guarantees this — each locale file is `Record<MessageKey, string>` — but the
   * type cannot see an *empty* string, and an empty translation renders as nothing at all rather
   * than as the key, which is the one failure mode that hides itself. So the values are checked
   * as well as the keys.
   */
  it('has every shipped language for every string it defines', () => {
    const incomplete = Object.entries(messages)
      .flatMap(([key, value]) =>
        LOCALE_CODES.filter((locale) => !value[locale]?.trim()).map(
          (locale) => `${key} (${locale})`,
        ),
      )
      .sort();
    expect(incomplete).toEqual([]);
  });

  /**
   * The registry and the catalogues are two lists that must agree.
   *
   * `LOCALES` drives the language picker; the catalogues are what the picker's choices resolve
   * to. A locale in the registry with no catalogue is a language somebody can select and then
   * find the whole app in English.
   */
  it('ships a catalogue for exactly the locales the registry names', () => {
    expect([...TRANSLATED_LOCALES].sort()).toEqual([...LOCALE_CODES].sort());
  });

  /**
   * A plural message must declare a form for every category its language actually uses, or a
   * Russian reader meeting 5 of something sees the form meant for 2.
   */
  it('declares every plural category its language needs', () => {
    const gaps: string[] = [];
    for (const [key, value] of Object.entries(messages)) {
      for (const locale of LOCALE_CODES) {
        const text = value[locale] ?? '';
        if (!text.startsWith('plural:')) continue;
        const declared = new Set(
          text
            .slice('plural:'.length)
            .split('|')
            .map((part) => part.trim().split(' ')[0]),
        );
        // The categories this language can produce for a whole number. `other` is the documented
        // fallback, so a message that declares it covers anything it did not name.
        const needed = new Set(
          Array.from({ length: 101 }, (_, n) => new Intl.PluralRules(locale).select(n)),
        );
        if (declared.has('other')) continue;
        for (const category of needed) {
          if (!declared.has(category)) gaps.push(`${key} (${locale}) missing "${category}"`);
        }
      }
    }
    expect(gaps).toEqual([]);
  });

  /**
   * Every reason the validator can reject an answer must be sayable.
   *
   * A code with no message renders as `validation.tooShort` under the box, to a member of the
   * public, at the moment they are being told they got something wrong — the worst place in the
   * product for a raw key to surface. The codes are read out of the validator's source rather
   * than from a list kept alongside it, because a list kept alongside it is the thing that drifts.
   */
  it('can say every reason the validator rejects an answer', () => {
    const source = readFileSync(
      new URL('../../../../packages/shared/src/forms/validate.ts', import.meta.url),
      'utf8',
    );
    const codes = [...source.matchAll(/code: '(validation\.[A-Za-z]+)'/g)].map(
      (match) => match[1]!,
    );

    // If this is ever empty the regex has drifted from the source and the test proves nothing.
    expect(codes.length).toBeGreaterThan(10);
    expect([...new Set(codes)].filter((code) => !messages[code])).toEqual([]);
  });
});
