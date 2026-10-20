import { expect, test, type Page } from '@playwright/test';
import { db, signInAs } from './support.js';
import { fakeBridge } from './fake-model.js';

/**
 * The design pass (`docs/plan/DESIGN-PASS.md`): empty states with their photograph, one filled
 * button where there was a row of them, the model cards, the template covers, and the promise that
 * none of it reaches for another origin. Phone-width checks run in German, the longest words.
 */
const sql = db();
test.afterAll(async () => {
  await sql.end();
});

/**
 * By a planted refresh token, not the magic link: the link's callback is rate-limited to 20 a quarter
 * of an hour for the whole suite, and every extra sign-in here once took it past that for the specs
 * that come after.
 */
async function signIn(page: Page, locale: 'en-GB' | 'de-DE' = 'en-GB') {
  await signInAs(page, sql, 'admin@example.com', locale);
}
test('Scan: a photograph with its alt text, one filled button, nothing from another origin', async ({
  page,
}) => {
  const foreign: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (!['localhost', '127.0.0.1'].includes(url.hostname) && url.protocol.startsWith('http')) {
      foreign.push(request.url());
    }
  });
  await signIn(page);
  await page.goto('/scan');

  const photo = page.getByRole('img', { name: 'A white paper crane' });
  await expect(photo).toBeVisible();
  await expect(photo).toHaveAttribute('width', '1120');
  await expect(photo).toHaveAttribute('height', '400');
  await expect(photo).toHaveAttribute('loading', 'lazy');
  await expect(photo).toHaveAttribute('decoding', 'async');
  expect(await photo.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1120);
  await expect(
    page.getByText('PDFs, photos and Word files go in; one tidy PDF comes out.'),
  ).toBeVisible();

  // One filled button on the screen: adding is the primary action until there is a document.
  await expect(page.locator('main .button:not(.button--quiet)')).toHaveCount(1);

  for (const path of ['/send', '/signing', '/forms']) await page.goto(path);
  expect(foreign).toEqual([]);
});

test('reduced motion removes the empty state’s fade', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await signIn(page);
  await page.goto('/scan');
  await expect(page.locator('.empty--media')).toBeVisible();
  expect(
    await page.locator('.empty--media').evaluate((el) => getComputedStyle(el).animationName),
  ).toBe('none');
});

test('Send: the three ways are a choice, not three buttons', async ({ page }) => {
  await signIn(page);
  await page.goto('/send');
  const group = page.getByRole('radiogroup');
  await expect(group.getByRole('radio')).toHaveCount(3);
  await expect(group.locator('.button')).toHaveCount(0);
  await expect(group.getByRole('radio', { name: 'One document' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await group.getByRole('radio', { name: 'One each, from a list' }).click();
  await expect(group.getByRole('radio', { name: 'One each, from a list' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
});

test('the models are cards with their tier and memory as chips', async ({ page }) => {
  await page.addInitScript(fakeBridge);
  await signIn(page);
  await page.goto('/ai-setup');
  const model = page.locator('[data-model]').first();
  await expect(model.locator('.badge--tier')).toHaveText('Full');
  await expect(model.locator('.badge--ram')).toHaveText('10.0 GB RAM');
  // The sentence still says it in words, for a screen reader.
  await expect(model).toContainText('Needs about 10.0 GB of memory');
});

test('the template gallery has a drawing on every card', async ({ page }) => {
  await signIn(page);
  await page.goto('/forms');
  await page.getByRole('button', { name: 'New form' }).first().click();
  await page.locator('.doors__myself button').click();
  const cards = page.locator('label.template');
  await expect(cards.first()).toBeVisible();
  expect(await cards.count()).toBeGreaterThan(4);
  await expect(page.locator('label.template .template__cover')).toHaveCount(await cards.count());
});

test('360 px in German: nothing runs off the side and the bottom bar cuts on the right', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.addInitScript(fakeBridge);
  await signIn(page, 'de-DE');
  for (const path of ['/scan', '/send', '/summary', '/forms']) {
    await page.goto(path);
    await expect(page.locator('main h1').first()).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `${path} is wider than the screen`).toBeLessThanOrEqual(0);
  }
  const labels = page.locator('.sidebar .nav-link__label');
  expect(await labels.count()).toBeGreaterThan(4);
  const cut = await labels.evaluateAll((spans) =>
    spans.every((span) => getComputedStyle(span).textOverflow === 'ellipsis'),
  );
  expect(cut).toBe(true);
});
