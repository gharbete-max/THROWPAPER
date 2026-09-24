import { readFile } from 'node:fs/promises';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { db, plantLoginToken, uniqueEmail } from './support.js';

/**
 * The optional e-ID step, through the real Forms and the real Sign (CONTRACT §5.6).
 *
 * The e2e Sign runs the development provider (`EID_PROVIDER=console`), so this drives the
 * provider path end to end: a form that offers the step, the person confirming, the finished
 * document saying so. The development provider confirms nobody, and every place it appears must
 * say that — which is most of what this spec checks.
 */
const sql = db();
const slug = `eid-${Date.now()}`;

test.afterAll(async () => {
  await sql`delete from forms where slug = ${slug}`;
  await sql.end();
});

async function adminToken(request: APIRequestContext): Promise<string> {
  const secret = await plantLoginToken(sql, 'admin@example.com');
  const response = await request.post('/api/v1/auth/token', { data: { token: secret } });
  expect(response.ok()).toBe(true);
  return ((await response.json()) as { accessToken: string }).accessToken;
}

test('a form that offers e-ID: the person confirms, and the document says it was a test', async ({
  page,
  request,
}) => {
  const token = await adminToken(request);
  const headers = { authorization: `Bearer ${token}` };
  const created = await request.post('/api/v1/forms', {
    headers,
    data: { slug, title: { 'sv-SE': 'Medlemsansökan', 'en-GB': 'Membership' } },
  });
  const formId = ((await created.json()) as { id: string }).id;
  const draft = await request.put(`/api/v1/forms/${formId}/draft`, {
    headers,
    data: {
      definition: {
        schemaVersion: 1,
        fields: [
          {
            id: 'f1',
            key: 'full_name',
            type: 'short_text',
            label: { 'sv-SE': 'Namn', 'en-GB': 'Name' },
            required: true,
          },
          {
            id: 'f2',
            key: 'email',
            type: 'email',
            label: { 'sv-SE': 'E-post', 'en-GB': 'Email' },
            required: true,
          },
        ],
        settings: { identity: 'optional' },
      },
    },
  });
  expect(draft.ok()).toBe(true);
  const published = await request.post(`/api/v1/forms/${formId}/publish`, {
    headers,
    data: { overrideIncompleteTranslations: true },
  });
  expect(published.ok()).toBe(true);

  await page.goto(`/f/${slug}`);
  await page.getByRole('button', { name: /^(Language|Språk):/ }).click();
  await page.getByRole('option', { name: 'Svenska' }).click();
  await page.getByLabel(/Namn/).fill('Åsa Lindqvist');
  await page.getByLabel(/E-post/).fill(uniqueEmail('eid'));
  await page.getByRole('button', { name: /Skicka|Slutför/ }).click();

  // The form is finished before the step appears, and the step says it is optional — and a test.
  await expect(page.getByText(/Din referens:/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Bekräfta vem du är (valfritt)' })).toBeVisible();
  await expect(page.getByText(/Testläge: här används en utvecklingsleverantör/)).toBeVisible();

  await page.getByRole('button', { name: 'Bekräfta med e-legitimation' }).click();
  await expect(
    page.getByText(/Testbekräftelse sparad\. Den är ingen identitetskontroll/),
  ).toBeVisible();

  // The document, fetched again, says so too — and never "confirmed".
  await expect(page.getByRole('heading', { name: 'Ditt dokument är klart' })).toBeVisible();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Ladda ner PDF' }).click();
  const bytes = await readFile((await (await downloading).path())!);
  const doc = await getDocument({ data: new Uint8Array(bytes), useSystemFonts: false }).promise;
  const content = await (await doc.getPage(1)).getTextContent();
  const text = content.items.map((item) => ('str' in item ? item.str : '')).join(' ');
  expect(text.replace(/\s+/g, '')).toContain('Endasttest');
  expect(text).not.toMatch(/Bekräftad med e-legitimation som/);

  // Recorded on the submission, as a test.
  const [row] = await sql`
    select s.identity from submissions s join forms f on f.id = s.form_id where f.slug = ${slug}
  `;
  expect(row?.['identity']).toMatchObject({ method: 'console', test: true });
});
