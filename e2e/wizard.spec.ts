import { expect, test } from '@playwright/test';
import { db, plantLoginToken } from './support.js';

/**
 * The wizard, pressed rather than reasoned about.
 *
 * `wizard.test.ts` holds the tree to its invariants, which is where the four-press promise and the
 * deduplication rule live. What it cannot show is that pressing the buttons produces the form the
 * review screen promised — and the wizard is the one entry S3's loop deliberately walks past,
 * because that operator takes the manual route. So nothing in the browser touched it until here.
 *
 * The run below is the one the facet model exists for: a question answered with **two** options at
 * once. Before `docs/adr/0006`, this question carried a fourth option, "Both of those", whose
 * contributions were the other two copied out verbatim — an option nobody wanted, which existed
 * only because one answer per question could not say "these two".
 */
const sql = db();
const created: string[] = [];

test.afterAll(async () => {
  for (const id of created) {
    await sql`delete from form_versions where form_id = ${id}`;
    await sql`delete from forms where id = ${id}`;
  }
  await sql`delete from forms where slug like 'form-%' and published_version_id is null`;
  await sql.end();
});

test('a facet answered twice builds the form the review promised', async ({ page }) => {
  const secret = await plantLoginToken(sql, 'admin@example.com');
  await page.addInitScript(() => window.localStorage.setItem('tp.locale', 'sv-SE'));
  await page.goto(`/auth/callback?token=${secret}`);
  await expect(page.getByRole('heading', { name: 'Evenemang' })).toBeVisible();

  await page.goto('/forms');
  await page.getByRole('button', { name: 'Nytt formulär' }).first().click();

  // The sector: one press, and it moves on by itself.
  await page
    .getByRole('button', { name: /Anmälan/ })
    .first()
    .click();

  // The facet: a matrix. Both, and neither press ends the question.
  await page.getByRole('button', { name: /Specialkost/ }).click();
  await page.getByRole('button', { name: /gäster/ }).click();
  await expect(page.getByRole('button', { name: /Specialkost/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'Nästa' }).click();

  // The review is the promise. What the editor opens with has to match it.
  const summary = await page.locator('.wizard__summary').textContent();
  expect(summary).toContain('Måltid');
  expect(summary).toContain('Medföljande gäster');

  await page.getByRole('button', { name: /Öppna i redigeraren/ }).click();
  await expect(page).toHaveURL(/\/forms\/[0-9a-f-]{36}$/);
  const formId = page.url().split('/').pop()!;
  created.push(formId);

  const [row] = await sql`select draft_definition from forms where id = ${formId}`;
  const definition = row!['draft_definition'] as { fields?: { key: string }[] };
  expect((definition.fields ?? []).map((field) => field.key)).toEqual([
    'name',
    'email',
    'meal',
    'guests',
  ]);
});
