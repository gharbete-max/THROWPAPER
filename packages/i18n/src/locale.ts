/** SPEC-shared.md §packages/i18n. Per-organisation config with a default and a fallback chain. */
export interface LocaleConfig {
  /** Locales the organisation publishes in, in preference order. */
  supported: readonly string[];
  default: string;
  /** Explicit overrides, e.g. { 'nb-NO': ['da-DK', 'sv-SE'] }. */
  fallbacks?: Readonly<Record<string, readonly string[]>>;
}

/**
 * Ordered chain to try for `requested`: the locale itself, its base language, any configured
 * fallbacks, then the org default. Deduplicated, and only ever returns supported locales.
 */
export function resolveChain(config: LocaleConfig, requested: string | undefined): string[] {
  const candidates: string[] = [];
  const push = (locale: string | undefined) => {
    if (locale && config.supported.includes(locale) && !candidates.includes(locale)) {
      candidates.push(locale);
    }
  };

  if (requested) {
    push(requested);
    push(baseLanguage(requested));
    for (const supported of config.supported) {
      if (baseLanguage(supported) === baseLanguage(requested)) push(supported);
    }
    for (const fallback of config.fallbacks?.[requested] ?? []) push(fallback);
  }
  push(config.default);
  return candidates;
}

/** The one locale to render in. Never undefined — the org default always terminates the chain. */
export function resolveLocale(config: LocaleConfig, requested: string | undefined): string {
  return resolveChain(config, requested)[0] ?? config.default;
}

function baseLanguage(locale: string): string {
  return locale.split('-')[0] ?? locale;
}
