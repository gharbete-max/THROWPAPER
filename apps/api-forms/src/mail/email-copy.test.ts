import { describe, expect, it } from 'vitest';
import { LOCALE_CODES } from '@tp/i18n';
import { defaultTokens } from '@tp/tokens';
import { EMAIL_COPY_LOCALES } from './send-job.js';
import { renderConfirmation } from '../email/templates.js';

/**
 * A transactional email is the one part of this product that arrives when nobody is looking.
 *
 * The copy table held two languages — Swedish and English — and fell back to Swedish. So a French
 * respondent filling in a French form received a Swedish confirmation, and nothing anywhere said
 * so: no test, no warning, and no way for the operator to find out short of a reply asking what
 * the email meant.
 *
 * Holding the table against the locale registry is the whole fix. A thirteenth language now fails
 * the build instead of quietly sending Swedish to somebody who never asked for it.
 */
describe('transactional email copy', () => {
  it('covers every language the product ships in', () => {
    const missing = LOCALE_CODES.filter((code) => !EMAIL_COPY_LOCALES.includes(code));
    expect(missing, `no email copy for: ${missing.join(', ')}`).toEqual([]);
  });

  it('carries no language the registry does not offer', () => {
    const extra = EMAIL_COPY_LOCALES.filter((code) => !LOCALE_CODES.includes(code));
    expect(extra, `email copy for unknown locale: ${extra.join(', ')}`).toEqual([]);
  });

  /**
   * `lang` is not cosmetic: a screen reader picks a voice from it, and a client decides whether to
   * offer a translation. Both templates hard-coded `lang="sv"` while their content arrived already
   * translated, so a Japanese email was announced in Swedish.
   */
  it('declares the language the email is actually written in', async () => {
    const html = await renderConfirmation(defaultTokens, {
      lang: 'ja-JP',
      heading: 'お申し込みを受け付けました',
      intro: '',
      eventName: '',
      when: '',
      where: '',
      referenceLabel: '受付番号',
      reference: 'ABC123',
      attachmentNote: '',
      footer: '',
      webVersionLabel: '',
      webVersionUrl: 'https://example.test/r/ABC123',
    });

    expect(html).toContain('lang="ja-JP"');
    expect(html).not.toContain('lang="sv"');
  });
});
