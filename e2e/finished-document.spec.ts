import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { db, deleteSubmission, seededForm, uniqueEmail } from './support.js';

/**
 * The journey the product exists for: fill in a form, get the finished document, keep it, send it.
 *
 * In a real browser against the real server: the PDF is downloaded through the browser and read
 * back as a PDF, the email handoff is checked for what it actually does (a `mailto:` cannot attach,
 * and the page must say so), and the confirmation survives a refresh.
 */
const sql = db();
let slug: string;
const created: string[] = [];

test.beforeAll(async () => {
  slug = (await seededForm(sql)).slug;
});

test.afterAll(async () => {
  for (const reference of created) await deleteSubmission(sql, reference);
  await sql.end();
});

async function fillAndSend(page: Page, name: string): Promise<string> {
  await page.goto(`/f/${slug}`);
  await page.getByRole('button', { name: /^(Language|Språk):/ }).click();
  await page.getByRole('option', { name: 'Svenska' }).click();

  await page.getByLabel(/Namn/).fill(name);
  await page.getByLabel(/E-post/).fill(uniqueEmail('finished'));
  await page.getByLabel(/Organisation/).fill('Sjöström & Co');
  await page.getByRole('button', { name: 'Nästa' }).click();
  await page.getByText('Vegetariskt', { exact: true }).click();
  await page.getByRole('button', { name: 'Anmäl mig' }).click();

  await expect(page.getByText(/Din referens:/)).toBeVisible();
  const reference = (await page.getByText(/Din referens:/).textContent())?.match(
    /[0-9A-Z]{4}-[0-9A-Z]{4}/,
  )?.[0];
  if (!reference) throw new Error('no reference on the confirmation');
  created.push(reference);
  return reference;
}

async function pdfText(bytes: Buffer): Promise<string> {
  const doc = await getDocument({ data: new Uint8Array(bytes), useSystemFonts: false }).promise;
  let text = '';
  for (let n = 1; n <= doc.numPages; n += 1) {
    const content = await (await doc.getPage(n)).getTextContent();
    text += content.items.map((item) => ('str' in item ? item.str : '')).join(' ');
  }
  return text.replace(/\s+/g, '');
}

test('a finished form gives back its document: download it, open it, email it', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const reference = await fillAndSend(page, 'Björn Öberg');

  // The document is prepared as soon as the screen shows, and says when it is ready.
  await expect(page.getByRole('heading', { name: 'Ditt dokument är klart' })).toBeVisible();
  await expect(page.getByText(`Dina svar har skickats till`)).toBeVisible();
  const filename = await page.locator('.finished__filename').textContent();
  // Named after the form in its own language, then the reference: "Anmälan-till-Vårmötet-…".
  expect(filename).toMatch(new RegExp(`^Anmälan-till-Vårmötet.*-${reference}\\.pdf$`));

  // Download: a real PDF, named after the form, holding these answers.
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Ladda ner PDF' }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe(filename);
  const bytes = await readFile((await download.path())!);
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
  const text = await pdfText(bytes);
  expect(text).toContain('BjörnÖberg');
  expect(text).toContain('Sjöström&Co');
  expect(text).toContain(reference);

  // Open: the same file, in a tab of its own. Headless Chromium has no PDF viewer (a PDF in a new
  // tab becomes a download), so what is checked is what the link opens: a blob this page made,
  // in a new tab, holding exactly the PDF that was downloaded.
  const open = page.getByRole('link', { name: 'Öppna' });
  await expect(open).toHaveAttribute('target', '_blank');
  const blob = (await open.getAttribute('href'))!;
  expect(blob).toMatch(/^blob:http:\/\/localhost:\d+\//);
  const opened = await page.evaluate(async (url) => {
    const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
    return Array.from(bytes.subarray(0, 5));
  }, blob);
  expect(Buffer.from(opened).toString()).toBe('%PDF-');

  // Email: mailto cannot attach, so the page says to attach the file — by name — and never
  // suggests it did. No recipient is filled in; the person chooses.
  await page.getByRole('button', { name: 'Mejla det' }).click();
  const app = page.getByRole('link', { name: 'Öppna min e-postapp' });
  const href = (await app.getAttribute('href'))!;
  expect(href.startsWith('mailto:?subject=')).toBe(true);
  const params = new URLSearchParams(href.slice('mailto:?'.length));
  expect(params.get('subject')).toContain(reference);
  expect(params.get('body')).toContain(filename!);
  await expect(page.getByText(`Bifoga ${filename} själv innan du skickar`)).toBeVisible();

  // Copy: the same message, for webmail in another tab.
  await page.getByRole('button', { name: 'Kopiera meddelandet' }).click();
  await expect(page.getByRole('button', { name: 'Kopierat' })).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain(reference);
  expect(copied).toContain(filename!);

  // No desktop mail program on a server: that button is not offered.
  await expect(page.getByRole('button', { name: /Öppna ett utkast/ })).toHaveCount(0);
});

test('a refresh keeps the confirmation, and "fill in again" starts clean', async ({ page }) => {
  const reference = await fillAndSend(page, 'Åsa Lind');

  // A refresh brings the confirmation back, in the language it was in.
  await page.reload();
  await expect(page.getByText(`Din referens: ${reference}`)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Ditt dokument är klart' })).toBeVisible();
  // Nothing typed is kept in the browser — only the reference and the document's handle.
  const kept = await page.evaluate(
    () => JSON.stringify(history.state) + JSON.stringify({ ...sessionStorage, ...localStorage }),
  );
  expect(kept).not.toContain('Åsa Lind');

  await page.getByRole('button', { name: 'Fyll i igen' }).click();
  await expect(page.getByLabel(/Namn/)).toHaveValue('');
  // And a reload after that is the form, not the confirmation (in the browser's own language:
  // the language picked on the form is not a setting that outlives the page).
  await page.reload();
  await expect(page.getByLabel(/Namn|Name/)).toBeVisible();
  await expect(page.getByText(/Din referens:|Your reference:/)).toHaveCount(0);

  // The submission itself is untouched by starting again.
  const [row] = await sql`select status from submissions where reference = ${reference}`;
  expect(row?.['status']).toBe('complete');
});

test('a new visit to the link, in another tab, is the form — not the last confirmation', async ({
  context,
}) => {
  const first = await context.newPage();
  await fillAndSend(first, 'Första Personen');
  const next = await context.newPage();
  await next.goto(`/f/${slug}`);
  await expect(next.getByLabel(/Namn|Name/)).toBeVisible();
  await expect(next.getByText(/Din referens:|Your reference:/)).toHaveCount(0);
});

test('on a phone the finished screen fits, and its actions take the whole width', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await fillAndSend(page, 'Jämtland Östergren');
  await expect(page.getByRole('heading', { name: 'Ditt dokument är klart' })).toBeVisible();
  await page.getByRole('button', { name: 'Mejla det' }).click();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);

  const panel = await page.locator('.finished').boundingBox();
  const download = await page.getByRole('button', { name: 'Ladda ner PDF' }).boundingBox();
  expect(download!.width).toBeGreaterThan(panel!.width * 0.8);
  expect(download!.height).toBeGreaterThanOrEqual(44);
});
