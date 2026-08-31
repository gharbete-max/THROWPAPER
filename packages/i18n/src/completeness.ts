/**
 * Per-locale completeness for a form or template. Publishing with missing required translations
 * is blocked unless explicitly overridden — SPEC-shared.md §packages/i18n.
 */
export interface CompletenessReport {
  locale: string;
  requiredKeys: number;
  translatedKeys: number;
  missing: string[];
  complete: boolean;
}

export function completenessFor(
  locale: string,
  requiredKeys: readonly string[],
  translations: Readonly<Record<string, string | undefined>>,
): CompletenessReport {
  const missing = requiredKeys.filter((key) => !translations[key]?.trim());
  return {
    locale,
    requiredKeys: requiredKeys.length,
    translatedKeys: requiredKeys.length - missing.length,
    missing,
    complete: missing.length === 0,
  };
}
