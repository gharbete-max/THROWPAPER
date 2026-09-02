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
 * The marker that makes a message a plural one.
 *
 * Explicit rather than inferred. The first version treated any message containing a `|` whose
 * segments began with category names as plural, which cannot express a language with a single
 * category: Chinese and Japanese need one form and therefore no pipe, and `other {count} 表单`
 * with nothing to detect would have rendered the word "other" to the reader.
 *
 * Inferring from a bare leading `one`/`other` instead would misread any ordinary message that
 * happens to start with those words. A prefix nobody writes by accident settles both.
 */
const PLURAL = 'plural:';

/**
 * Pick the plural form of a message, if it declares any.
 *
 * Selection is `Intl.PluralRules`, so the rules come from the platform's CLDR data rather than
 * from `count === 1` — right for English and Swedish, wrong for Russian, and wrong in a different
 * way for every language with a dual or a paucal.
 *
 * An unmarked message is returned untouched, so an ordinary sentence containing a pipe is never
 * silently cut in half.
 */
function plural(
  template: string,
  locale: string,
  vars: Readonly<Record<string, string | number>>,
): string {
  if (!template.startsWith(PLURAL)) return template;
  const body = template.slice(PLURAL.length);
  if (!('count' in vars)) return body;

  const forms = new Map<string, string>();
  for (const part of body.split('|')) {
    const trimmed = part.trim();
    const space = trimmed.indexOf(' ');
    const category = space === -1 ? trimmed : trimmed.slice(0, space);
    // A marked message with a segment that names no category is a typo in the catalogue. Showing
    // the whole thing, marker and all, makes that loud rather than silently dropping a form.
    if (!CATEGORIES.has(category)) return template;
    forms.set(category, space === -1 ? '' : trimmed.slice(space + 1));
  }

  const count = Number(vars.count);
  const chosen = Number.isFinite(count)
    ? new Intl.PluralRules(locale).select(count)
    : /* A count that is not a number cannot be pluralised; the general form is the safe one. */
      'other';
  return forms.get(chosen) ?? forms.get('other') ?? body;
}

function interpolate(template: string, vars: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}
