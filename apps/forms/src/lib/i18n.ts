import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { createTranslator, resolveChain, type LocaleConfig, type Translator } from '@tp/i18n';
import { useSession } from './session.js';
import {
  catalogueVersion,
  currentMessages,
  loadCatalogue,
  subscribeToCatalogues,
} from './messages/index.js';

/**
 * Translator bound to the current session's locale and the organisation's fallback chain.
 *
 * The catalogue for a language is downloaded on demand — twelve of them in the entry chunk was
 * 240 kB that a respondent reading one form in one language paid for. So this hook asks for the
 * languages it needs, subscribes to their arrival, and re-renders once when they land.
 *
 * The **whole chain** is requested, not just the resolved locale: a Norwegian reader falls back
 * to Danish before English, and a chain with a hole in it silently skips to the end of it.
 *
 * Until they arrive `t()` answers from whatever is loaded, which always includes English. On a
 * cold load in another language that is a brief moment of English rather than a blank screen —
 * the same trade the fallback chain already makes for a half-translated form.
 */
export function useT(): Translator {
  // The **interface** list, not the organisation's content list — see `session.tsx`. Resolving
  // against the organisation's would mean an operator could not read the app in a language their
  // customer happens not to publish forms in.
  const { interfaceLocales, locale } = useSession();
  return useTranslator(interfaceLocales, locale);
}

/**
 * The same thing, for the two places that have a locale but no session.
 *
 * The public form is rendered for anonymous visitors and the demo banner appears before sign-in;
 * both used to build their own translator over the whole catalogue. With the languages split they
 * also have to ask for theirs, and a second copy of that logic is a second place to forget it.
 */
export function useTranslator(locales: LocaleConfig, locale: string): Translator {
  const version = useSyncExternalStore(subscribeToCatalogues, catalogueVersion, catalogueVersion);

  const chain = useMemo(() => resolveChain(locales, locale), [locales, locale]);

  useEffect(() => {
    for (const wanted of chain) void loadCatalogue(wanted);
  }, [chain]);

  return useMemo(
    () => createTranslator(locales, currentMessages(), locale),
    // `version` is the dependency that matters: the catalogue itself is module state, so nothing
    // else in this list changes when a language arrives.
    [locales, locale, version],
  );
}

export function formatDateTime(locale: string, value: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value),
  );
}

/** `datetime-local` inputs need a value with no zone; the API always speaks UTC ISO strings. */
export function toLocalInput(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export function fromLocalInput(value: string): string | null {
  if (!value) return null;
  return new Date(value).toISOString();
}
