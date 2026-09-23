import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { forms as formSchemas } from '@tp/shared';
import { db, seededForm } from './support.js';

/**
 * The signature pad, in a real browser: that what is drawn or typed reaches the server as a PNG
 * **carrying its own strokes** (`packages/shared/src/forms/signature-vector.ts`).
 *
 * The unit tests prove the format, the server's refusal of anything outside it, and the renderer.
 * What only a browser can prove is the middle: that `canvas.toBlob` plus the embedding actually
 * produce bytes the server reads back — the step where a vector could silently go missing and
 * every signature still look fine on screen.
 *
 * It reads the stored file back from the server's own upload store rather than the request,
 * because that is the artefact everything downstream uses — and because Playwright does not expose
 * a multipart body. That needs the server on this machine, so it does not run against
 * `E2E_BASE_URL`.
 */
test.skip(!!process.env['E2E_BASE_URL'], 'Reads the upload store on the local disk');

/** Where `server.ts` puts private uploads, resolved from the API's working directory. */
const UPLOAD_DIR = resolve(
  'apps/api-forms',
  process.env['UPLOAD_DIR'] ?? join(process.env['DOCUMENT_DIR'] ?? '.documents', 'uploads'),
);
const sql = db();
const slug = `e2e-signature-${Date.now().toString(36)}`;
let formId: string;

test.beforeAll(async () => {
  const { organisationId } = await seededForm(sql);
  const definition = formSchemas.FormDefinition.parse({
    schemaVersion: 1,
    fields: [
      {
        id: 's1',
        key: 'signed_by',
        type: 'signature',
        label: { 'sv-SE': 'Underskrift', 'en-GB': 'Signature' },
      },
    ],
  });

  const [form] = await sql`
    insert into forms (organisation_id, slug, title, status, draft_definition)
    values (${organisationId}, ${slug}, ${sql.json({ 'sv-SE': 'Avtal', 'en-GB': 'Agreement' })},
            'published', ${sql.json(definition)})
    returning id
  `;
  formId = String(form!['id']);
  const [version] = await sql`
    insert into form_versions (form_id, version, definition, published_at)
    values (${formId}, 1, ${sql.json(definition)}, now())
    returning id
  `;
  await sql`
    update forms set published_version = 1, published_version_id = ${String(version!['id'])}
    where id = ${formId}
  `;
});

test.afterAll(async () => {
  await sql`delete from form_uploads where form_id = ${formId}`;
  await sql`update forms set published_version_id = null where id = ${formId}`;
  await sql`delete from form_versions where form_id = ${formId}`;
  await sql`delete from forms where id = ${formId}`;
  await sql.end();
});

/** Applies the signature and returns the bytes the server stored for it. */
async function applySignature(page: Page): Promise<Buffer> {
  const upload = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' && response.url().includes('/uploads?field=signed_by'),
  );
  await page.getByRole('button', { name: 'Use this signature' }).click();
  const response = await upload;
  expect(response.status()).toBe(201);
  await expect(page.getByText('Signed', { exact: true })).toBeVisible();
  const { key } = (await response.json()) as { key: string };
  return readFile(join(UPLOAD_DIR, key));
}

test('a drawn signature is uploaded with its strokes', async ({ page }) => {
  await page.goto(`/f/${slug}`);
  await page.getByRole('button', { name: /^(Language|Språk):/ }).click();
  await page.getByRole('option', { name: 'English' }).click();

  const pad = page.locator('canvas.signature__pad');
  const box = (await pad.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.1, box.y + box.height * 0.6);
  await page.mouse.down();
  for (let step = 1; step <= 12; step += 1) {
    await page.mouse.move(
      box.x + box.width * (0.1 + step * 0.05),
      box.y + box.height * (0.6 - 0.3 * Math.sin(step / 2)),
    );
  }
  await page.mouse.up();

  const read = formSchemas.readSignatureVector(await applySignature(page));
  expect(read.ok).toBe(true);
  if (!read.ok || !read.vector) throw new Error('No vector in the uploaded signature');
  expect(read.vector.kind).toBe('drawn');
  if (read.vector.kind !== 'drawn') return;
  expect(read.vector.paths).toHaveLength(1);
  expect(read.vector.paths[0]).toMatch(/^M [\d.]+ [\d.]+ Q /);
});

test('a typed signature is uploaded with its text', async ({ page }) => {
  await page.goto(`/f/${slug}`);
  await page.getByRole('button', { name: /^(Language|Språk):/ }).click();
  await page.getByRole('option', { name: 'English' }).click();

  await page.getByLabel('Or type your name').fill('Björn Öberg');

  const read = formSchemas.readSignatureVector(await applySignature(page));
  expect(read).toMatchObject({ ok: true, vector: { kind: 'typed', text: 'Björn Öberg' } });
});
