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
    if (!vars) return value || key;
    return interpolate(plural(value || key, locale, vars), vars);
  };
}

/**
 * The plural categories a locale can ask for. Named rather than positional on purpose.
 *
 * A message written as `one {count} form | other {count} forms` says which form is which, so a
 * translator working in a language with three or four categories can add them without anybody
 * having to remember what order the previous translator used. Positional forms are how "1 forms"
 * becomes "1 formulär" in one language and nonsense in the next.
 */
const CATEGORIES: ReadonlySet<string> = new Set(['zero', 'one', 'two', 'few', 'many', 'other']);

/**
 * Pick the plural form of a message, if it has any.
 *
 * Selection is `Intl.PluralRules`, so the rules come from the platform's CLDR data rather than
 * from `count === 1` — which is right for English and Swedish and wrong for most of the languages
 * this product will meet later.
 *
 * A message with no `|`, or with a `|` that is not followed by category names, is returned
 * untouched: an ordinary sentence containing a pipe must not be silently cut in half.
 */
function plural(
  template: string,
  locale: string,
  vars: Readonly<Record<string, string | number>>,
): string {
  if (!template.includes('|') || !('count' in vars)) return template;

  const forms = new Map<string, string>();
  for (const part of template.split('|')) {
    const trimmed = part.trim();
    const space = trimmed.indexOf(' ');
    const category = space === -1 ? trimmed : trimmed.slice(0, space);
    if (!CATEGORIES.has(category)) return template;
    forms.set(category, space === -1 ? '' : trimmed.slice(space + 1));
  }

  const count = Number(vars.count);
  if (!Number.isFinite(count)) return forms.get('other') ?? template;
  return forms.get(new Intl.PluralRules(locale).select(count)) ?? forms.get('other') ?? template;
}

function interpolate(template: string, vars: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}
