import { describe, expect, it } from 'vitest';
import { LOCALE_CODES } from '@tp/i18n';
import { FORM_TEMPLATES } from './templates.js';
import { V } from './vocabulary.js';
import { translatableTexts } from './helpers.js';

/**
 * A string should be written in the script its language uses.
 *
 * Twelve languages written by hand means twelve keyboards' worth of opportunity to leak a glyph
 * from one into another, and the result is invisible to every other check: it is a non-empty
 * string in the right slot, so the completeness guard passes and nothing renders as a key. It is
 * only wrong to somebody who reads that language.
 *
 * This has now happened twice — a 形 in a Russian sentence about colours, and a 長 in a Russian
 * sentence about conferences. Both survived a full review. So the check is mechanical.
 *
 * ## What it does and does not claim
 *
 * It cannot judge whether a translation is *good*; nothing automated can. It catches exactly one
 * thing: characters from a script the language does not use. A Cyrillic word in a French sentence,
 * a Han character in a Swedish one. That is a narrow claim and a real one.
 *
 * Latin script is deliberately allowed everywhere — every language here borrows brand names,
 * units and codes ("PNG", "Formwork", "Ctrl+Z"), and forbidding it would be wrong far more often
 * than right.
 */

/** The scripts each locale is written in, beyond the Latin every one of them borrows. */
const SCRIPTS: Record<string, RegExp | null> = {
  'en-GB': null,
  'sv-SE': null,
  'da-DK': null,
  'nb-NO': null,
  'fi-FI': null,
  'is-IS': null,
  'fr-FR': null,
  'de-DE': null,
  'es-ES': null,
  'zh-CN': /[㐀-䶿一-鿿]/,
  'ja-JP': /[぀-ヿ㐀-䶿一-鿿]/,
  'ru-RU': /[Ѐ-ӿ]/,
};

const HAN_OR_KANA = /[぀-ヿ㐀-䶿一-鿿]/g;
const CYRILLIC = /[Ѐ-ӿ]/g;

/** Every string the templates and the vocabulary carry, with where it came from. */
function everyString(): Array<{ where: string; locale: string; text: string }> {
  const out: Array<{ where: string; locale: string; text: string }> = [];

  for (const [key, word] of Object.entries(V)) {
    for (const locale of LOCALE_CODES) {
      const text = (word as Record<string, string>)[locale];
      if (text) out.push({ where: `vocabulary.${key}`, locale, text });
    }
  }

  for (const template of FORM_TEMPLATES) {
    for (const locale of LOCALE_CODES) {
      if (template.name[locale]) {
        out.push({ where: `${template.id}.name`, locale, text: template.name[locale]! });
      }
      if (template.description[locale]) {
        out.push({
          where: `${template.id}.description`,
          locale,
          text: template.description[locale]!,
        });
      }
    }
    for (const entry of translatableTexts(template.definition)) {
      for (const locale of LOCALE_CODES) {
        const text = entry.text[locale];
        if (text) out.push({ where: `${template.id}/${entry.path}`, locale, text });
      }
    }
  }

  return out;
}

describe('every string is written in its own script', () => {
  const strings = everyString();

  it('has plenty to check, or it is proving nothing', () => {
    expect(strings.length).toBeGreaterThan(1000);
  });

  /** A Han or kana character in a language that does not use one. */
  it('has no stray CJK characters outside Chinese and Japanese', () => {
    // Named rather than inferred from the regexes above: the ranges are written as literal
    // characters, so asking a pattern's `source` whether it covers Han quietly answers "no" for
    // every locale — which is how the first version of this test passed while proving nothing.
    const usesCjk = new Set(['zh-CN', 'ja-JP']);
    const strays = strings
      .filter(({ locale }) => !usesCjk.has(locale))
      .flatMap(({ where, locale, text }) => {
        const hits = text.match(HAN_OR_KANA) ?? [];
        return hits.length > 0
          ? [`${where} (${locale}): "${text.slice(0, 60)}" has ${hits.join('')}`]
          : [];
      });
    expect(strays).toEqual([]);
  });

  /** And Cyrillic anywhere but Russian. */
  it('has no stray Cyrillic outside Russian', () => {
    const strays = strings
      .filter(({ locale }) => locale !== 'ru-RU')
      .flatMap(({ where, locale, text }) => {
        const hits = text.match(CYRILLIC) ?? [];
        return hits.length > 0
          ? [`${where} (${locale}): "${text.slice(0, 60)}" has ${hits.join('')}`]
          : [];
      });
    expect(strays).toEqual([]);
  });

  /**
   * The other direction: a language that uses a non-Latin script should mostly be *in* it.
   *
   * A Chinese entry that is entirely Latin is almost always an untranslated string copied from
   * the English column — which the completeness check cannot see, because the slot is filled.
   * Short strings are exempt: "PNG", "CSV" and "Ctrl+Z" are correct in every language.
   */
  it('does not leave a non-Latin language holding an English sentence', () => {
    const untranslated = strings
      .filter(({ locale }) => SCRIPTS[locale] !== null)
      .filter(({ text }) => text.replace(/[^A-Za-z]/g, '').length > 12)
      .filter(({ locale, text }) => !SCRIPTS[locale]!.test(text))
      .map(({ where, locale, text }) => `${where} (${locale}): "${text.slice(0, 60)}"`);
    expect(untranslated).toEqual([]);
  });
});
