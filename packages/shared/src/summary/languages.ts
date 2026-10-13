/**
 * The twelve languages of the summary and translation centre, and what spike S1 allowed in each
 * (`docs/plan/SUMMARY-SPIKE.md` section 9, ADR 0023 section 5).
 *
 * Plain data and plain functions: nothing here touches a model. The model is told a language by
 * its English name and its own, because a small model follows "Icelandic (íslenska)" more reliably
 * than "is-IS".
 */
export const SUMMARY_LOCALES = [
  'da-DK',
  'de-DE',
  'en-GB',
  'es-ES',
  'fi-FI',
  'fr-FR',
  'is-IS',
  'ja-JP',
  'nb-NO',
  'ru-RU',
  'sv-SE',
  'zh-CN',
] as const;
export type SummaryLocale = (typeof SUMMARY_LOCALES)[number];

export function isSummaryLocale(value: string): value is SummaryLocale {
  return (SUMMARY_LOCALES as readonly string[]).includes(value);
}

/** How the prompts name a language. Prompts are code, never shown to a person. */
export const PROMPT_LANGUAGE: Readonly<Record<SummaryLocale, string>> = {
  'da-DK': 'Danish (dansk)',
  'de-DE': 'German (Deutsch)',
  'en-GB': 'English',
  'es-ES': 'Spanish (español)',
  'fi-FI': 'Finnish (suomi)',
  'fr-FR': 'French (français)',
  'is-IS': 'Icelandic (íslenska)',
  'ja-JP': 'Japanese (日本語)',
  'nb-NO': 'Norwegian Bokmål (norsk bokmål)',
  'ru-RU': 'Russian (русский)',
  'sv-SE': 'Swedish (svenska)',
  'zh-CN': 'Chinese (简体中文)',
};

/**
 * Writing a summary in a language.
 * - `yes`: it passed the mechanical checks.
 * - `names`: borderline. Russian changed a surname once, so the pane warns that names can change.
 * - `no`: it must not be offered. Icelandic stays off until a native speaker has read a sample.
 */
export type SummaryIn = 'yes' | 'names' | 'no';
export function summaryIn(language: SummaryLocale): SummaryIn {
  if (language === 'is-IS') return 'no';
  if (language === 'ru-RU') return 'names';
  return 'yes';
}

/** Translating into a language. Every translation is a draft; Icelandic failed outright. */
export function translateInto(language: SummaryLocale): 'draft' | 'no' {
  return language === 'is-IS' ? 'no' : 'draft';
}

/** A pair is offered when the target is writable and the two differ. */
export function canTranslate(from: SummaryLocale | null, into: SummaryLocale): boolean {
  return translateInto(into) === 'draft' && from !== into;
}
