import { expect, test } from '@playwright/test';
import { db, deleteSubmission, seededForm, uniqueEmail } from './support.js';

/**
 * The public half of the v0.1 loop, in a real browser against a real server.
 *
 * These are the things unit tests cannot reach: that the code-split route actually loads, that a
 * multi-page form keeps its state across a language switch in a real DOM, and that a submission
 * arrives in Postgres.
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

/** Pulls the reference out of the confirmation, failing loudly rather than returning undefined. */
function referenceIn(text: string | null): string {
  const found = text?.match(/[0-9A-Z]{4}-[0-9A-Z]{4}/)?.[0];
  if (!found) throw new Error(`No reference found in: ${text}`);
  return found;
}

/**
 * Pick a language on the public form.
 *
 * The switcher used to be a native `<select>` and these tests used `selectOption`. It is a
 * listbox now — a `<select>` cannot contain a flag, because an `<option>` renders text and
 * nothing else — so the language is chosen the way a visitor chooses it: open the control, click
 * the language by its own name.
 *
 * The endonym rather than the code, because that is what the control shows and what a person
 * would look for.
 */
const ENDONYM = { 'sv-SE': 'Svenska', 'en-GB': 'English' } as const;

async function chooseLanguage(page: import('@playwright/test').Page, locale: 'sv-SE' | 'en-GB') {
  await page.getByRole('button', { name: /^(Language|Språk):/ }).click();
  await page.getByRole('option', { name: ENDONYM[locale] }).click();
}

/** The form loads in the visitor's language; pin it so the assertions are deterministic. */
async function open(page: import('@playwright/test').Page, locale: 'sv-SE' | 'en-GB') {
  await page.goto(`/f/${slug}`);
  await chooseLanguage(page, locale);
}

/**
 * The submit button carries the label the operator wrote in the builder, not a generic string.
 * Writing this test is what surfaced that the setting was being collected and ignored.
 */
test('a visitor fills in the form across both pages and gets a reference', async ({ page }) => {
  const email = uniqueEmail();
  await open(page, 'sv-SE');

  await page.getByLabel(/Namn/).fill('Björn Öberg');
  await page.getByLabel(/E-post/).fill(email);
  await page.getByLabel(/Organisation/).fill('Sjöström & Co');
  await page.getByRole('button', { name: 'Nästa' }).click();

  // Page two only exists because of the page break in the definition.
  //
  // The meal question is rendered as cards, so the radio itself is clipped out of sight and only
  // the label is on screen. `check()` fails on it, and correctly: nobody clicks a 1px input. A
  // person clicks the card, which is what this does. The keyboard and screen-reader paths are
  // covered by the input still being focusable and named — see the unit tests.
  await page.getByText('Vegetariskt', { exact: true }).click();
  await expect(page.getByRole('radio', { name: 'Vegetariskt' })).toBeChecked();
  await page.getByRole('button', { name: 'Anmäl mig' }).click();

  await expect(page.getByText(/Din referens:/)).toBeVisible();
  const reference = referenceIn(await page.getByText(/Din referens:/).textContent());
  created.push(reference);

  // It reached the database, with the answers and the locale it was filled in.
  const [row] = await sql`
    select data, locale, status from submissions where reference = ${reference}
  `;
  expect(row?.['status']).toBe('complete');
  expect(row?.['locale']).toBe('sv-SE');
  expect((row?.['data'] as Record<string, unknown>)['full_name']).toBe('Björn Öberg');
});

/**
 * START-HERE lists this as an acceptance criterion in its own right: "a language dropdown on the
 * public form that survives a multi-page flow **without losing entered data**".
 */
test('switching language mid-flow keeps what has already been typed', async ({ page }) => {
  await open(page, 'sv-SE');

  await page.getByLabel(/Namn/).fill('Åsa Ångström');
  await page.getByLabel(/E-post/).fill(uniqueEmail());
  await chooseLanguage(page, 'en-GB');

  // The label changed; the answer did not.
  await expect(page.getByLabel(/Name/)).toHaveValue('Åsa Ångström');
  await expect(page.getByRole('button', { name: 'Next' })).toBeVisible();

  // And it survives the page change too.
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByLabel(/Name/)).toHaveValue('Åsa Ångström');
});

test('a required answer is refused before the page advances', async ({ page }) => {
  await open(page, 'sv-SE');

  await page.getByLabel(/E-post/).fill(uniqueEmail());
  await page.getByRole('button', { name: 'Nästa' }).click();

  // Still on page one, with the field complained about.
  await expect(page.getByText('Fältet är obligatoriskt.')).toBeVisible();
  await expect(page.getByLabel(/Namn/)).toBeVisible();
});

test('a malformed email is refused', async ({ page }) => {
  await open(page, 'en-GB');

  await page.getByLabel(/Name/).fill('Test Person');
  await page.getByLabel(/Email/).fill('not-an-address');
  await page.getByRole('button', { name: 'Next' }).click();

  await expect(page.getByText('Enter an email address.')).toBeVisible();
});

test('the same address cannot register twice', async ({ page }) => {
  const email = uniqueEmail('dupe');

  for (const attempt of [1, 2]) {
    await open(page, 'sv-SE');
    await page.getByLabel(/Namn/).fill(`Försök ${attempt}`);
    await page.getByLabel(/E-post/).fill(email);
    await page.getByRole('button', { name: 'Nästa' }).click();
    await page.getByText('Standard', { exact: true }).click();
    await page.getByRole('button', { name: 'Anmäl mig' }).click();

    if (attempt === 1) {
      await expect(page.getByText(/Din referens:/)).toBeVisible();
      created.push(referenceIn(await page.getByText(/Din referens:/).textContent()));
    } else {
      await expect(page.getByText('Den här adressen har redan anmälts.')).toBeVisible();
    }
  }
});

test('save and resume brings the answers back', async ({ page }) => {
  const email = uniqueEmail('resume');
  await open(page, 'sv-SE');

  await page.getByLabel(/Namn/).fill('Halvvägs Person');
  await page.getByLabel(/E-post/).fill(email);
  await page.getByRole('button', { name: 'Spara och fortsätt senare' }).click();

  const link = page.locator('input[readonly]');
  await expect(link).toBeVisible();
  const resumeUrl = await link.inputValue();
  expect(resumeUrl).toContain('resume=');

  // A different visit entirely — the link is the only thing carried over.
  await page.context().clearCookies();
  await page.goto(resumeUrl);

  await expect(page.getByLabel(/Namn/)).toHaveValue('Halvvägs Person');

  const [row] = await sql`
    select reference from submissions
    where email is null and status = 'partial'
    order by created_at desc limit 1
  `;
  if (row) created.push(String(row['reference']));
});
