import { expect, test } from '@playwright/test';
import { db, deleteSubmission, seededForm, signInAs, uniqueEmail } from './support.js';

/**
 * The door, in a real browser.
 *
 * The registration itself is created through the public API rather than by driving the form again
 * — public-form.spec.ts already proves that path, and repeating it here would only make this
 * slower and more brittle. What matters here is what happens at the check-in screen.
 */
const sql = db();
let slug: string;
let eventId: string;
const created: string[] = [];

test.beforeAll(async () => {
  const form = await seededForm(sql);
  slug = form.slug;
  if (!form.eventId) throw new Error('The seeded form is not attached to an event.');
  eventId = form.eventId;
});

test.afterAll(async () => {
  for (const reference of created) await deleteSubmission(sql, reference);
  await sql.end();
});

async function register(request: import('@playwright/test').APIRequestContext): Promise<string> {
  const response = await request.post(`/api/public/forms/${slug}`, {
    data: {
      locale: 'sv-SE',
      values: {
        full_name: 'Göran Häggkvist',
        email: uniqueEmail('door'),
        meal: 'standard',
      },
    },
  });
  expect(response.status()).toBe(201);
  const reference = (await response.json()).reference as string;
  created.push(reference);
  return reference;
}

test('a reference admits once and reports already-arrived on the second attempt', async ({
  page,
  request,
}) => {
  const reference = await register(request);
  await signInAs(page, sql, 'operator@example.com');

  await page.goto(`/events/${eventId}/check-in`);
  await page.getByLabel(/Referens/).fill(reference);
  await page.getByRole('button', { name: 'Checka in' }).click();

  await expect(page.getByText('Välkommen')).toBeVisible();

  // The whole point of the phase: a second scan is not an error.
  await page.getByLabel(/Referens/).fill(reference);
  await page.getByRole('button', { name: 'Checka in' }).click();

  await expect(page.getByText('Redan incheckad')).toBeVisible();
  await expect(page.getByText(/Anlände/)).toBeVisible();

  // And exactly one row exists, whatever the screen said.
  const rows = await sql`
    select 1 from check_ins c
    join submissions s on s.id = c.submission_id
    where s.reference = ${reference}
  `;
  expect(rows).toHaveLength(1);
});

test('a reference nobody holds is refused', async ({ page }) => {
  await signInAs(page, sql, 'operator@example.com');

  await page.goto(`/events/${eventId}/check-in`);
  await page.getByLabel(/Referens/).fill('ZZZZ-ZZZZ');
  await page.getByRole('button', { name: 'Checka in' }).click();

  await expect(page.getByText('Hittades inte')).toBeVisible();
});

test('a revoked registration is refused at the door', async ({ page, request }) => {
  const reference = await register(request);
  await sql`update submissions set revoked_at = now() where reference = ${reference}`;

  await signInAs(page, sql, 'operator@example.com');
  await page.goto(`/events/${eventId}/check-in`);
  await page.getByLabel(/Referens/).fill(reference);
  await page.getByRole('button', { name: 'Checka in' }).click();

  await expect(page.getByText('Anmälan återkallad')).toBeVisible();
});

test('the attendance report counts arrivals and lists no-shows', async ({ page, request }) => {
  const arriving = await register(request);
  const notArriving = await register(request);

  await signInAs(page, sql, 'admin@example.com');

  await page.goto(`/events/${eventId}/check-in`);
  await page.getByLabel(/Referens/).fill(arriving);
  await page.getByRole('button', { name: 'Checka in' }).click();
  await expect(page.getByText('Välkommen')).toBeVisible();

  await page.goto(`/events/${eventId}/attendance`);

  // The seed ships 200 registrations, so assert on the row rather than the totals.
  await expect(page.getByRole('cell', { name: arriving })).toBeVisible();

  await page.getByRole('button', { name: 'Endast uteblivna' }).click();
  await expect(page.getByRole('cell', { name: notArriving })).toBeVisible();
  // The one who arrived is no longer a no-show.
  await expect(page.getByRole('cell', { name: arriving })).toHaveCount(0);
});

test('an operator can work the door but cannot revoke', async ({ page, request }) => {
  const reference = await register(request);
  await signInAs(page, sql, 'operator@example.com');

  await page.goto(`/events/${eventId}/attendance`);
  await expect(page.getByRole('cell', { name: reference })).toBeVisible();

  // Revoking is admin-only, so the control is not rendered for an operator at all.
  await expect(page.getByRole('button', { name: 'Arkivera' })).toHaveCount(0);
});
