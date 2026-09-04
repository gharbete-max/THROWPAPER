import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LOCALE_CODES } from '@tp/i18n';
// The aggregate, not the lazy loader: the app fetches one catalogue, a test needs all twelve.
import { messages } from '../lib/messages/all.js';

/**
 * What a respondent is told when the send fails.
 *
 * This is the least forgiving screen in the product: a stranger, on a phone, on a venue's wifi, at
 * the end of a form they have no reason to fill in twice. Both network paths through `submit` were
 * silent — `try` with a `finally` and no `catch`, so a rejected `fetch` un-greyed the button and
 * said nothing at all — and one path was worse than silent:
 *
 *   setRejected(String(body.reason ?? 'closed'))
 *
 * A 500 carries no `reason`, so a fault at our end told the visitor the form had closed while they
 * were filling it in. That is false, and it is the specific falsehood that makes somebody give up
 * instead of pressing the button again, which is what would have worked.
 *
 * The answers survive all of it — nothing here clears `values` — so every message says so.
 */
const SOURCE = readFileSync(new URL('./PublicForm.tsx', import.meta.url), 'utf8');

describe('a submission that does not arrive', () => {
  it('catches a rejected fetch rather than letting it escape', () => {
    // `finally` alone restores the button and reports nothing.
    expect(SOURCE).toContain("setRejected('offline')");
    expect(SOURCE).not.toMatch(/}\s*finally\s*{\s*setBusy\(false\);\s*}\s*}\s*$/);
  });

  it('survives a body that will not parse', () => {
    // A gateway timing out in front of the API answers with an HTML page.
    expect(SOURCE).toContain('response.json().catch(');
  });

  it('does not call a server fault a closed form', () => {
    expect(SOURCE).toContain('response.status >= 500');
    expect(SOURCE).toContain("setRejected('error')");
  });

  it('announces the failure, which arrives after a button press', () => {
    expect(SOURCE).toContain('role="alert"');
  });

  /**
   * The gap this codebase keeps producing: a message added in English and nowhere else. It has
   * already happened to the confirmation email and to the admission card, in both cases found by a
   * test like this one rather than by anybody reading the other eleven files.
   */
  it('says it in every language', () => {
    for (const key of ['public.rejected.offline', 'public.rejected.error'] as const) {
      const translations = messages[key] as Record<string, string> | undefined;
      expect(translations, `${key} is in no catalogue at all`).toBeTruthy();

      for (const locale of LOCALE_CODES) {
        const text = translations?.[locale];
        expect(text, `${locale} is missing ${key}`).toBeTruthy();
        if (locale !== 'en-GB') {
          expect(text, `${locale}'s ${key} is still the English string`).not.toBe(
            translations?.['en-GB'],
          );
        }
      }
    }
  });
});
