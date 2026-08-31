import { resolveChain, type LocaleConfig } from './locale.js';

/**
 * Text stored per locale: `{ 'sv-SE': 'Vårmötet', 'en-GB': 'Spring meeting' }`.
 *
 * Records carry this shape from the start so phase 3's translation tab is a UI change rather than
 * a schema migration and a backfill.
 */
export type LocalisedText = Readonly<Record<string, string>>;

export interface PickedText {
  value: string;
  /** The locale actually used, which may not be the one asked for. */
  locale: string;
  /** True when the requested locale had no content and a fallback was used. */
  fallback: boolean;
}

/**
 * First non-empty translation along the locale fallback chain. Returns an empty string rather
 * than throwing — a missing translation is a completeness problem to surface in the UI
 * (see completenessFor), not a reason to fail a request.
 */
export function pickText(
  config: LocaleConfig,
  text: LocalisedText,
  requested: string | undefined,
): PickedText {
  const chain = resolveChain(config, requested);
  for (const locale of chain) {
    const value = text[locale]?.trim();
    if (value) return { value, locale, fallback: locale !== (requested ?? config.default) };
  }

  // Nothing along the chain: fall back to any content at all before giving up entirely.
  for (const [locale, value] of Object.entries(text)) {
    if (value.trim()) return { value: value.trim(), locale, fallback: true };
  }
  return { value: '', locale: config.default, fallback: true };
}

/** Locales in `config.supported` that have no content yet. Drives the completeness indicator. */
export function missingLocales(config: LocaleConfig, text: LocalisedText): string[] {
  return config.supported.filter((locale) => !text[locale]?.trim());
}
