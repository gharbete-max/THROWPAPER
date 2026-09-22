import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LOCALE_CODES } from '@tp/i18n';
import { messages } from '../lib/messages/all.js';

/**
 * The confirmation screen keeps the form's name and says what happens next.
 *
 * It said "Thank you." and a reference, and dropped the title the moment the form was sent — so
 * the one screen somebody might screenshot did not say what they had registered for, and nothing
 * told them a mail or a card was coming. Both facts come from the server's submit response
 * (`confirmationTo`, `admissionCard`), so the screen states only what was actually queued.
 */
const SOURCE = readFileSync(new URL('./PublicForm.tsx', import.meta.url), 'utf8');

describe('the confirmation screen', () => {
  it('keeps the form title as the heading after sending', () => {
    // The title used to be gated on `phase !== 'done'`.
    expect(SOURCE).not.toMatch(/formTitle && phase !== 'done'/);
    expect(SOURCE).toMatch(/\{formTitle && <h1 className="public__title">/);
  });

  it('says what is coming from what the server said it queued', () => {
    expect(SOURCE).toContain('body.confirmationTo');
    expect(SOURCE).toContain('body.admissionCard');
    expect(SOURCE).toMatch(
      /coming\.card \? 'public\.confirmationWithCard' : 'public\.confirmation'/,
    );
  });

  it('says it in every language', () => {
    for (const key of ['public.confirmation', 'public.confirmationWithCard'] as const) {
      const translations = messages[key] as Record<string, string> | undefined;
      expect(translations, `${key} is in no catalogue at all`).toBeTruthy();
      for (const locale of LOCALE_CODES) {
        const text = translations?.[locale];
        expect(text, `${locale} is missing ${key}`).toContain('{email}');
        if (locale !== 'en-GB') {
          expect(text, `${locale}'s ${key} is still the English string`).not.toBe(
            translations?.['en-GB'],
          );
        }
      }
    }
  });
});
