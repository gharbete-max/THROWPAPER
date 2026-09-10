import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The page announces the language it is actually written in.
 *
 * Two things set `<html lang>` and they disagree by design. `SessionProvider` follows the
 * *interface* locale, which is correct for every screen an operator sees. `PublicForm` carries its
 * own locale, deliberately — "the visitor's language has nothing to do with whoever built the
 * form" — and it is the one screen anonymous members of the public actually reach.
 *
 * Nothing reconciled them, so the form was served in English under `lang="ru-RU"` whenever a
 * previous session on that browser had left another language in `localStorage`. It is invisible:
 * the page looks perfect and only a screen reader can tell, by pronouncing English words with
 * Russian phonetics.
 *
 * `useAnnounceLocale` already existed for the identical defect one layer down — the demo banner
 * standing in the session's language over somebody else's form — so the document language is set
 * from the same place rather than from a second call inside the screen, which would race the
 * session's effect and win or lose on mount order.
 *
 * Asserted against the source because the property is about *which module owns the write*. Both
 * arrangements produce a correct `lang` in a happy-path render; only one of them still does when
 * the session's locale changes underneath, and a DOM test of the good case cannot see that.
 */
const DEMO = readFileSync(new URL('./demo.tsx', import.meta.url), 'utf8');
const PUBLIC_FORM = readFileSync(new URL('../screens/PublicForm.tsx', import.meta.url), 'utf8');

describe('a screen that does not follow the session locale', () => {
  it('sets the document language where it announces itself', () => {
    const hook = DEMO.slice(DEMO.indexOf('export function useAnnounceLocale'));
    expect(hook).toContain('syncDocumentLanguage');
  });

  /**
   * Restored, not left behind. The session's effect keys on its own `resolved`, which does not
   * change while somebody fills in a form — so it never fires to correct the attribute, and
   * without this the whole app stays in the respondent's language after leaving the form.
   */
  it('puts the previous language back when the screen goes', () => {
    const hook = DEMO.slice(DEMO.indexOf('export function useAnnounceLocale'));
    const cleanup = hook.slice(hook.indexOf('return () =>'));
    expect(cleanup).toContain('syncDocumentLanguage(previous)');
  });

  /**
   * The public form announces the locale it resolved, not the one it was asked for. `resolved` is
   * the language after the fallback chain — a form offering only Swedish and English, asked for
   * Russian, renders English and must say so.
   */
  it('announces the resolved locale from the public form', () => {
    expect(PUBLIC_FORM).toContain('useAnnounceLocale(resolved)');
  });

  /** One writer per concern: the screen must not reach for the document itself. */
  it('never lets the public form write the attribute directly', () => {
    expect(PUBLIC_FORM).not.toContain('documentElement.lang');
    expect(PUBLIC_FORM).not.toContain('syncDocumentLanguage');
  });
});
