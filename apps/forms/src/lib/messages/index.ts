import type { Catalogue } from '@tp/i18n';
import { enGB, type MessageKey } from './en-GB.js';

/**
 * UI strings — CLAUDE.md rule 4 keeps them out of the components.
 *
 * ## One file per language, and only the one you need is downloaded
 *
 * These used to live in a single object keyed by message, with every language inline beside it.
 * That is readable at two languages and unusable at twelve: adding a string meant editing twelve
 * values on one line, and nothing could tell you which language was behind.
 *
 * Now each language is its own module, `en-GB` is the reference, and every other is typed
 * `Record<MessageKey, string>` — so **a missing translation is a compile error**, not a blank
 * label somebody finds in production. `MessageKey` is derived from the English file rather than
 * declared separately, so the reference and the type cannot drift apart either.
 *
 * ## Why the loaders are dynamic
 *
 * Importing all twelve statically put every language in the entry chunk: 307 kB became 548 kB,
 * and the person paying for it is a member of the public opening `/f/spring-meeting` on a phone
 * to read one form in one language. Twelve catalogues to render one is the same mistake as
 * shipping the form builder to a respondent, and this product has made it once already.
 *
 * English stays static because it is the last link in every fallback chain: something has to be
 * there before anything has loaded, and a language that might be needed at any moment is not a
 * good candidate for lazy loading.
 */
const LOADERS: Record<string, () => Promise<Record<MessageKey, string>>> = {
  'en-GB': () => Promise.resolve(enGB),
  'sv-SE': () => import('./sv-SE.js').then((m) => m.svSE),
  'da-DK': () => import('./da-DK.js').then((m) => m.daDK),
  'nb-NO': () => import('./nb-NO.js').then((m) => m.nbNO),
  'fi-FI': () => import('./fi-FI.js').then((m) => m.fiFI),
  'is-IS': () => import('./is-IS.js').then((m) => m.isIS),
  'fr-FR': () => import('./fr-FR.js').then((m) => m.frFR),
  'de-DE': () => import('./de-DE.js').then((m) => m.deDE),
  'es-ES': () => import('./es-ES.js').then((m) => m.esES),
  'zh-CN': () => import('./zh-CN.js').then((m) => m.zhCN),
  'ja-JP': () => import('./ja-JP.js').then((m) => m.jaJP),
  'ru-RU': () => import('./ru-RU.js').then((m) => m.ruRU),
};

/**
 * The locales the app itself is translated into.
 *
 * Exported so the language picker can offer what actually exists rather than what the
 * organisation has configured — those are different lists, and an organisation that has added a
 * locale the app does not speak should still see its own forms in it.
 */
export const TRANSLATED_LOCALES: readonly string[] = Object.keys(LOADERS);

/**
 * Catalogues fetched so far, English included from the start.
 *
 * Module-level rather than React state: a language, once downloaded, does not need downloading
 * again when somebody switches back to it, and the cache should outlive any one component.
 */
const loaded = new Map<string, Record<MessageKey, string>>([['en-GB', enGB]]);
const pending = new Map<string, Promise<void>>();

/**
 * A version that ticks when a language arrives, and the subscribers watching it.
 *
 * This is the external store behind `useT`: one subscription shared by every component that
 * translates anything, rather than a piece of state per consumer. Components re-render when a
 * catalogue lands and at no other time.
 */
let version = 0;
const listeners = new Set<() => void>();

export function subscribeToCatalogues(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function catalogueVersion(): number {
  return version;
}

/** Load one locale's catalogue. Resolves immediately for anything already held. */
export function loadCatalogue(locale: string): Promise<void> {
  if (loaded.has(locale)) return Promise.resolve();
  const existing = pending.get(locale);
  if (existing) return existing;

  const loader = LOADERS[locale];
  // An organisation may support a locale the app does not speak. That is not an error — their
  // forms are still in it, and the interface around them falls back down the chain.
  if (!loader) return Promise.resolve();

  const promise = loader()
    .then((catalogue) => {
      loaded.set(locale, catalogue);
      version += 1;
      for (const listener of listeners) listener();
    })
    .catch(() => {
      // A chunk that fails to load leaves the language absent, which the fallback chain already
      // knows how to survive. Better a page in English than no page.
    })
    .finally(() => {
      pending.delete(locale);
    });
  pending.set(locale, promise);
  return promise;
}

/**
 * The catalogue as `createTranslator` wants it: message key → per-locale text.
 *
 * Rebuilt whenever a language arrives, and memoised on the set of loaded languages so that
 * rendering does not transpose five hundred keys on every frame.
 */
let cache: { languages: string; catalogue: Catalogue } | null = null;

export function currentMessages(): Catalogue {
  const languages = [...loaded.keys()].sort().join(',');
  if (cache?.languages === languages) return cache.catalogue;

  const catalogue: Catalogue = Object.fromEntries(
    (Object.keys(enGB) as MessageKey[]).map((key) => [
      key,
      Object.fromEntries([...loaded].map(([locale, entries]) => [locale, entries[key]])),
    ]),
  );
  cache = { languages, catalogue };
  return catalogue;
}

export type { MessageKey };
