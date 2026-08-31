import { useMemo } from 'react';
import { createTranslator, type Translator } from '@tp/i18n';
import { useSession } from './session.js';
import { messages } from './messages.js';

/** Translator bound to the current session's locale and the organisation's fallback chain. */
export function useT(): Translator {
  const { locales, locale } = useSession();
  return useMemo(() => createTranslator(locales, messages, locale), [locales, locale]);
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
