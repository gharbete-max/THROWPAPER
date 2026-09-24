import { describe, expect, it } from 'vitest';
import { LOCALE_CODES } from '@tp/i18n';
import { forms as formSchemas } from '@tp/shared';
import type { SubmissionRecord } from '../db/repositories/index.js';
import { createMemoryUploadStore } from '../uploads/private-store.js';
import { FINISHED_LOCALES, finishedHtml, finishedStrings } from './finished.js';
import {
  deriveFinishedKey,
  FINISHED_TOKEN_TTL_SECONDS,
  signFinishedToken,
  verifyFinishedToken,
} from './finished-token.js';
import { asciiFilename, contentDisposition, documentFilename, filenameStem } from './filename.js';

const SUBMISSION_ID = '44444444-4444-4444-8444-444444444444';
const key = deriveFinishedKey('document-secret-at-least-thirty-two-characters');

describe('the finished-document token', () => {
  it('verifies for the submission it was issued for', () => {
    const token = signFinishedToken(SUBMISSION_ID, key);
    expect(verifyFinishedToken(token, key)).toEqual({ ok: true, submissionId: SUBMISSION_ID });
  });

  it('cannot be pointed at another submission', () => {
    const token = signFinishedToken(SUBMISSION_ID, key);
    const other = token.replace(SUBMISSION_ID, '55555555-5555-4555-8555-555555555555');
    expect(verifyFinishedToken(other, key)).toEqual({ ok: false, reason: 'bad-signature' });
  });

  it('cannot have its expiry pushed back', () => {
    const token = signFinishedToken(SUBMISSION_ID, key);
    const [id, expires, mac] = token.split('.');
    const later = `${id}.${Number(expires) + 86_400}.${mac}`;
    expect(verifyFinishedToken(later, key)).toEqual({ ok: false, reason: 'bad-signature' });
  });

  it('expires after a day', () => {
    const issued = new Date('2030-01-01T00:00:00Z');
    const token = signFinishedToken(SUBMISSION_ID, key, issued);
    const justBefore = new Date(issued.getTime() + (FINISHED_TOKEN_TTL_SECONDS - 1) * 1000);
    const after = new Date(issued.getTime() + FINISHED_TOKEN_TTL_SECONDS * 1000);
    expect(verifyFinishedToken(token, key, justBefore).ok).toBe(true);
    expect(verifyFinishedToken(token, key, after)).toEqual({ ok: false, reason: 'expired' });
  });

  it('does not verify under a key derived for anything else', () => {
    const token = signFinishedToken(SUBMISSION_ID, key);
    const otherKey = deriveFinishedKey('another-secret-entirely-thirty-two-characters');
    expect(verifyFinishedToken(token, otherKey)).toEqual({ ok: false, reason: 'bad-signature' });
  });

  it.each(['', 'a.b.c', `${SUBMISSION_ID}.x.y`, `../../etc/passwd.1.${'a'.repeat(43)}`])(
    'refuses %j as malformed',
    (token) => {
      expect(verifyFinishedToken(token, key)).toEqual({ ok: false, reason: 'malformed' });
    },
  );
});

describe('document filenames', () => {
  it('keeps the title in its own script', () => {
    expect(documentFilename('Vårmötet 2026', 'K7M2QX')).toBe('Vårmötet-2026-K7M2QX.pdf');
    expect(documentFilename('Заявка', 'K7M2QX')).toBe('Заявка-K7M2QX.pdf');
  });

  it('never lets a title contribute a path or a reserved character', () => {
    const name = documentFilename('../../etc/passwd: "a" <b> | c? * d\\e', 'K7M2QX');
    expect(name).not.toMatch(/[/\\:"<>|?*]/);
    expect(name.startsWith('.')).toBe(false);
    expect(name.endsWith('-K7M2QX.pdf')).toBe(true);
  });

  it('falls back to the reference when the title leaves nothing', () => {
    expect(documentFilename('***', 'K7M2QX')).toBe('K7M2QX.pdf');
    expect(documentFilename('', 'K7M2QX')).toBe('K7M2QX.pdf');
  });

  it('caps a long title so the reference is never cut off', () => {
    const name = documentFilename('ö'.repeat(500), 'K7M2QX');
    expect([...filenameStem('ö'.repeat(500))]).toHaveLength(80);
    expect(name.endsWith('-K7M2QX.pdf')).toBe(true);
  });

  it('strips control characters, which would otherwise split a header', () => {
    expect(documentFilename('a\r\nContent-Type: text/html', 'R')).toBe(
      'a-Content-Type-text-html-R.pdf',
    );
  });

  it('gives every client a name: ASCII fallback and UTF-8 form', () => {
    const header = contentDisposition('Vårmötet-2026-K7M2QX.pdf');
    expect(header).toBe(
      `attachment; filename="Varmotet-2026-K7M2QX.pdf"; filename*=UTF-8''V%C3%A5rm%C3%B6tet-2026-K7M2QX.pdf`,
    );
    expect(asciiFilename('Заявка-K7M2QX.pdf')).toBe('K7M2QX.pdf');
    expect(contentDisposition("it's (1).pdf")).toContain("filename*=UTF-8''it%27s%20%281%29.pdf");
  });
});

describe('the finished document', () => {
  it('has its wording in every language the product speaks', () => {
    expect([...FINISHED_LOCALES].sort()).toEqual([...LOCALE_CODES].sort());
    for (const locale of FINISHED_LOCALES) {
      const words = finishedStrings(locale);
      for (const value of Object.values(words)) expect(value.trim()).not.toBe('');
      expect(words.entry).toContain('{n}');
      expect(words.sentTo).toContain('{organisation}');
      expect(words.identityConfirmed).toContain('{name}');
    }
  });

  const definition = formSchemas.FormDefinition.parse({
    ...formSchemas.emptyDefinition,
    fields: [
      {
        id: 'a',
        key: 'full_name',
        type: 'short_text',
        label: { 'sv-SE': 'Namn', 'en-GB': 'Name' },
        required: true,
      },
      {
        id: 'b',
        key: 'meal',
        type: 'single_select',
        label: { 'sv-SE': 'Måltid', 'en-GB': 'Meal' },
        options: [
          { value: 'veg', label: { 'sv-SE': 'Vegetariskt', 'en-GB': 'Vegetarian' } },
          { value: 'fish', label: { 'sv-SE': 'Fisk', 'en-GB': 'Fish' } },
        ],
      },
      {
        id: 'c',
        key: 'allergy_notes',
        type: 'long_text',
        label: { 'sv-SE': 'Allergier', 'en-GB': 'Allergies' },
        showWhen: {
          match: 'all',
          conditions: [{ fieldKey: 'meal', operator: 'equals', value: 'fish' }],
        },
      },
      {
        id: 'd',
        key: 'campaign',
        type: 'hidden',
        fromParameter: 'kampanj',
      },
      {
        id: 'e',
        key: 'bring_guest',
        type: 'yes_no',
        label: { 'sv-SE': 'Tar du med en gäst?', 'en-GB': 'Bringing a guest?' },
      },
      {
        id: 'f',
        key: 'phone',
        type: 'phone',
        label: { 'sv-SE': 'Telefon', 'en-GB': 'Phone' },
      },
    ],
  });

  function submission(data: Record<string, unknown>, locale = 'sv-SE'): SubmissionRecord {
    const at = new Date('2026-05-14T09:30:00Z');
    return {
      id: SUBMISSION_ID,
      organisationId: 'o',
      formId: 'f',
      formVersionId: 'v',
      eventId: null,
      reference: 'K7M2QX',
      status: 'complete',
      locale,
      email: null,
      data,
      resumeTokenHash: null,
      resumeExpiresAt: null,
      submittedAt: at,
      revokedAt: null,
      createdAt: at,
      updatedAt: at,
    };
  }

  const organisation = {
    name: 'Föreningen <Demo> & Co',
    supportedLocales: ['sv-SE', 'en-GB'],
    defaultLocale: 'sv-SE',
  };
  const locales = { supported: organisation.supportedLocales, default: 'sv-SE' };

  async function html(data: Record<string, unknown>, locale = 'sv-SE') {
    return finishedHtml(
      { uploadStore: createMemoryUploadStore() },
      {
        organisation,
        formTitle: { 'sv-SE': 'Anmälan', 'en-GB': 'Registration' },
        submission: submission(data, locale),
        definition,
      },
      locale === 'sv-SE' ? 'Anmälan' : 'Registration',
      locales,
    );
  }

  it('shows each question the person saw, answered in their language', async () => {
    const page = await html({ full_name: 'Åsa Öberg', meal: 'veg', bring_guest: true });
    expect(page).toContain('<h1>Anmälan</h1>');
    expect(page).toContain('K7M2QX');
    expect(page).toContain('Åsa Öberg');
    expect(page).toContain('Vegetariskt');
    expect(page).toContain('Ja');
    expect(page).toContain('Inte besvarad');
  });

  it('leaves out a question a condition hid, and every hidden field', async () => {
    const page = await html({
      full_name: 'Åsa',
      meal: 'veg',
      allergy_notes: 'should not appear',
      campaign: 'spring-mailout',
    });
    expect(page).not.toContain('Allergier');
    expect(page).not.toContain('should not appear');
    expect(page).not.toContain('spring-mailout');
    expect(page).not.toContain('campaign');
  });

  it('shows a conditional question once its condition holds', async () => {
    const page = await html({ full_name: 'Åsa', meal: 'fish', allergy_notes: 'Nötter' });
    expect(page).toContain('Allergier');
    expect(page).toContain('Nötter');
  });

  it('escapes every answer, so a form cannot inject into the page it is printed from', async () => {
    const page = await html({
      full_name: '<script>alert(1)</script><img src=x onerror=alert(2)>',
      phone: '" onmouseover="x',
    });
    expect(page).not.toContain('<script>alert');
    expect(page).not.toContain('<img src=x');
    expect(page).toContain('&lt;script&gt;');
    expect(page).toContain('&quot; onmouseover=&quot;x');
    expect(page).toContain('Föreningen &lt;Demo&gt; &amp; Co');
  });

  it('is written in the language the form was filled in', async () => {
    const page = await html({ full_name: 'Ann', meal: 'fish', bring_guest: false }, 'en-GB');
    expect(page).toContain('lang="en-GB"');
    expect(page).toContain('Fish');
    expect(page).toContain('No');
    expect(page).toContain('Reference');
  });

  it('shows an e-ID result as the name asserted, and a test one as a test', async () => {
    const base = submission({ full_name: 'Ann' }, 'en-GB');
    const render = (identity: SubmissionRecord['identity']) =>
      finishedHtml(
        { uploadStore: createMemoryUploadStore() },
        {
          organisation,
          formTitle: { 'en-GB': 'Registration' },
          submission: { ...base, identity },
          definition,
        },
        'Registration',
        locales,
      );
    const real = await render({
      method: 'eid:bankid-se',
      provider: 'broker',
      name: 'Ann Andersson',
      test: false,
      documentSha256: 'a'.repeat(64),
      confirmedAt: '2026-05-14T09:31:00Z',
    });
    expect(real).toContain('Confirmed with e-ID as Ann Andersson');
    const test = await render({
      method: 'console',
      provider: 'console',
      name: 'Test Person',
      test: true,
      documentSha256: 'a'.repeat(64),
      confirmedAt: '2026-05-14T09:31:00Z',
    });
    expect(test).toContain('This is not an identity check.');
    expect(test).not.toContain('Confirmed with e-ID');
  });

  it('claims nothing about signing, identity or validity (CLAUDE.md rule 8)', async () => {
    const page = (await html({ full_name: 'Ann' }, 'en-GB')).toLowerCase();
    for (const word of ['signed', 'verified', 'legally', 'binding', 'identity']) {
      expect(page).not.toContain(word);
    }
  });
});
