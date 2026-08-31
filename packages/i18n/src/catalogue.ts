import type { LocaleConfig } from './locale.js';
import { pickText, type LocalisedText } from './text.js';

/**
 * A translation catalogue: message key → per-locale text.
 *
 * CLAUDE.md rule 4 — no hard-coded user-facing strings. Screens call `t('key')`; the text lives
 * in a catalogue and falls back down the org's locale chain like every other translatable value.
 */
export type Catalogue = Readonly<Record<string, LocalisedText>>;

export type Translator = (key: string, vars?: Readonly<Record<string, string | number>>) => string;

export function createTranslator(
  config: LocaleConfig,
  catalogue: Catalogue,
  locale: string,
): Translator {
  return (key, vars) => {
    const entry = catalogue[key];
    // Showing the key is deliberate: a missing string should be obvious, not invisible.
    if (!entry) return key;
    const { value } = pickText(config, entry, locale);
    return vars ? interpolate(value || key, vars) : value || key;
  };
}

function interpolate(template: string, vars: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}
