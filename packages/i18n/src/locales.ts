/**
 * The languages this product ships in.
 *
 * One list, and everything else derives from it: the language picker, the completeness report
 * that blocks publishing a half-translated form, the seed, and the type that makes a missing
 * translation a compile error rather than a blank label.
 *
 * ## Why the endonym
 *
 * A picker showing `sv-SE` and `zh-CN` is a picker only a developer can use. Somebody looking for
 * their own language is looking for the word *they* call it — Svenska, 简体中文 — not a code and
 * not the English name for it. `name` is here for English-language administration screens and
 * documentation; `endonym` is what a reader sees.
 */
export interface LocaleInfo {
  /** BCP 47, language-REGION. The region matters: en-GB and en-US differ in more than spelling. */
  code: string;
  /** The English name, for administration screens that are themselves in English. */
  name: string;
  /** What speakers call it. This is what the language picker shows. */
  endonym: string;
  /**
   * Right-to-left. None of the twelve are, but the field exists because the day one is added is
   * the day somebody needs to find every place that assumed otherwise, and a field nobody set is
   * easier to find than an assumption nobody wrote down.
   */
  rtl?: boolean;
}

export const LOCALES: readonly LocaleInfo[] = [
  { code: 'en-GB', name: 'English', endonym: 'English' },
  { code: 'sv-SE', name: 'Swedish', endonym: 'Svenska' },
  { code: 'da-DK', name: 'Danish', endonym: 'Dansk' },
  { code: 'nb-NO', name: 'Norwegian Bokmål', endonym: 'Norsk bokmål' },
  { code: 'fi-FI', name: 'Finnish', endonym: 'Suomi' },
  { code: 'is-IS', name: 'Icelandic', endonym: 'Íslenska' },
  { code: 'fr-FR', name: 'French', endonym: 'Français' },
  { code: 'de-DE', name: 'German', endonym: 'Deutsch' },
  { code: 'es-ES', name: 'Spanish', endonym: 'Español' },
  // Mandarin, mainland, simplified script. Traditional is a separate locale, not a font choice.
  { code: 'zh-CN', name: 'Chinese (Simplified)', endonym: '简体中文' },
  { code: 'ja-JP', name: 'Japanese', endonym: '日本語' },
  { code: 'ru-RU', name: 'Russian', endonym: 'Русский' },
];

export const LOCALE_CODES: readonly string[] = LOCALES.map((locale) => locale.code);

const BY_CODE = new Map(LOCALES.map((locale) => [locale.code, locale]));

export function localeInfo(code: string): LocaleInfo | undefined {
  return BY_CODE.get(code);
}

/**
 * What to show a reader for a locale code, whether or not it is one we ship.
 *
 * Falls back to `Intl.DisplayNames` in the reader's own language before giving up and showing the
 * code — an organisation may support a locale this list has never heard of, and "fr-CA" is a
 * worse answer than "français (Canada)" for somebody who has to pick from a list.
 */
export function localeLabel(code: string, displayIn = code): string {
  const known = BY_CODE.get(code);
  if (known) return known.endonym;
  try {
    return new Intl.DisplayNames([displayIn], { type: 'language' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/**
 * Sensible fallbacks between languages whose readers can mostly read each other.
 *
 * These matter while a translation is incomplete: a Norwegian reader meeting an untranslated
 * string is far better served by the Danish than by dropping to English, and an organisation
 * publishing in Nordic languages will hit exactly that during the weeks between adding a locale
 * and finishing it.
 *
 * Only where the claim is honest. Finnish is not related to Swedish at all — it is here because
 * Finland is officially bilingual and a Finnish reader is far more likely to have Swedish than
 * English. Icelandic falls to Danish for the same historical reason. Nothing falls to a language
 * merely because the scripts look similar.
 */
export const DEFAULT_FALLBACKS: Readonly<Record<string, readonly string[]>> = {
  'sv-SE': ['nb-NO', 'da-DK', 'en-GB'],
  'da-DK': ['nb-NO', 'sv-SE', 'en-GB'],
  'nb-NO': ['da-DK', 'sv-SE', 'en-GB'],
  'is-IS': ['da-DK', 'nb-NO', 'en-GB'],
  'fi-FI': ['sv-SE', 'en-GB'],
  // Everything else falls to English, which `resolveChain` appends anyway via the org default.
};
