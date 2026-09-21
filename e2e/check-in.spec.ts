import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
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
  // Typed in, so the field takes focus back: the next reference can be typed straight away.
  await expect(page.getByLabel(/Referens/)).toBeFocused();

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

test('the door names the event it is working', async ({ page }) => {
  const [event] = await sql`select name from events where id = ${eventId}`;
  const name = String((event?.['name'] as Record<string, string>)['sv-SE']);
  expect(name).not.toBe('undefined');

  await signInAs(page, sql, 'operator@example.com');
  await page.goto(`/events/${eventId}/check-in`);

  // In the heading, so the first thing read is which queue this is.
  await expect(page.getByRole('heading', { level: 1 })).toContainText(name);
});

test('a wrong event id is not a door', async ({ page }) => {
  await signInAs(page, sql, 'operator@example.com');
  await page.goto(`/events/${randomUUID()}/check-in`);

  await expect(page.getByText('Det finns inget evenemang på den adressen.')).toBeVisible();
  // Nothing to scan into: a screen that can only ever say "not found" must not offer a field.
  await expect(page.getByLabel(/Referens/)).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Evenemang' })).toBeVisible();
});

test('the verdict panel keeps its height at phone width', async ({ page, request }) => {
  const reference = await register(request);
  await signInAs(page, sql, 'operator@example.com');
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`/events/${eventId}/check-in`);

  // The fixed height exists so the layout does not move at the moment of judgement. The idle
  // prompt is the one text long enough to wrap, and at 375 it once pushed the panel taller than
  // the verdict that replaced it — the exact jump the fixed height was meant to remove.
  const verdict = page.locator('.verdict');
  await expect(verdict).toContainText('Skanna ett kort');
  const idle = (await verdict.boundingBox())?.height;

  await page.getByLabel(/Referens/).fill(reference);
  await page.getByRole('button', { name: 'Checka in' }).click();
  await expect(verdict).toContainText('Välkommen');
  const admitted = (await verdict.boundingBox())?.height;

  // "Already checked in" carries one line more (when they arrived) and must fit the same panel.
  await page.getByLabel(/Referens/).fill(reference);
  await page.getByRole('button', { name: 'Checka in' }).click();
  await expect(verdict).toContainText('Redan incheckad');
  const already = (await verdict.boundingBox())?.height;

  expect(idle).toBeGreaterThan(0);
  expect(admitted).toBe(idle);
  expect(already).toBe(idle);
});

test('each undo is named after its arrival', async ({ page, request }) => {
  const reference = await register(request);
  await signInAs(page, sql, 'operator@example.com');
  await page.goto(`/events/${eventId}/check-in`);
  await page.getByLabel(/Referens/).fill(reference);
  await page.getByRole('button', { name: 'Checka in' }).click();
  await expect(page.getByText('Välkommen')).toBeVisible();

  // The accessible name carries the person, so five undo buttons are five different buttons.
  const undo = page.getByRole('button', { name: /Ångra.*Göran Häggkvist/ });
  await expect(undo).toBeVisible();
  // And the count is one sentence, not a number with a label a paragraph cannot carry.
  await expect(page.getByText(/^\d+ av \d+ incheckade$/)).toBeAttached();
});
