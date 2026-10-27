import { expect, test } from '@playwright/test';
import { db, openMoreTools, plantLoginToken, signInAs } from './support.js';

/**
 * Home — `docs/plan/EASY.md`, E1 (it replaced the room of ADR 0022): signing in lands on four big
 * coloured tiles, each a verb and one line. Spreadsheets and Presentation & planning are named once,
 * quietly, and must never pretend to be controls. Checked by keyboard, at 360 × 640 in German, and
 * on the server edition this suite runs, which sends through its mail provider and has no summary.
 */
const sql = db();

test.afterAll(async () => {
  await sql.end();
});

const HOME = /\/room$/;

test('signing in lands on home, with four tiles @smoke', async ({ page }) => {
  // Through the magic link's own landing screen, which sends a person to the app's `/`.
  const secret = await plantLoginToken(sql, 'admin@example.com');
  await page.addInitScript(() => window.localStorage.setItem('tp.locale', 'en-GB'));
  await page.goto(`/auth/callback?token=${secret}`);

  await expect(page).toHaveURL(HOME);
  await expect(
    page.getByRole('heading', { level: 1, name: 'What do you want to do?' }),
  ).toBeVisible();
  const tiles = page.locator('.home__tiles a');
  await expect(tiles).toHaveText([
    /Make or fill in forms/,
    /Scan a paper/,
    /Get something signed/,
    /Send a file/,
  ]);
  await expect(page.getByText('Not built yet')).toHaveCount(1);
  // The start-up intro plays once over a first arrival; the picture is of home after it.
  await expect(page.locator('.intro__stage')).toHaveCount(0, { timeout: 20_000 });
  if (process.env['HOME_SHOTS'])
    await page.screenshot({ path: `${process.env['HOME_SHOTS']}/home.png` });

  // An unknown address inside the app lands here too, not on the old events list.
  await page.goto('/nowhere-at-all');
  await expect(page).toHaveURL(HOME);
  // The old opened-Documents address still works.
  await page.goto('/room/documents');
  await expect(page).toHaveURL(HOME);
});

test('the placeholders are not controls, by role or by keyboard', async ({ page }) => {
  await signInAs(page, sql, 'admin@example.com', 'en-GB');
  await page.goto('/room');
  const later = page.locator('.home__later');
  await expect(later).toContainText('Spreadsheets');
  await expect(later).toContainText('Presentation & planning');
  expect(
    await later.locator(':is(a, button, input, select, textarea, [tabindex], [onclick])').count(),
    'a placeholder holds something a person could press',
  ).toBe(0);
  for (const name of ['Spreadsheets', 'Presentation & planning']) {
    await expect(page.getByRole('link', { name })).toHaveCount(0);
    await expect(page.getByRole('button', { name })).toHaveCount(0);
  }
});

test('the tiles are reached by keyboard and lead to the screens that do the work @smoke', async ({
  page,
}) => {
  await signInAs(page, sql, 'admin@example.com', 'en-GB');
  await page.goto('/room');

  const tile = (name: RegExp) => page.locator('.home__tiles').getByRole('link', { name });
  await tile(/Make or fill in forms/).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/forms$/);
  await page.getByRole('link', { name: 'Back to the room' }).first().click();
  await expect(page).toHaveURL(HOME);

  await tile(/Scan a paper/).click();
  await expect(page).toHaveURL(/\/scan$/);
  await expect(page.getByRole('heading', { name: 'Arrange pages' })).toBeVisible();
  // The paper door is one step on: Scan offers to make a form from a document instead.
  await openMoreTools(page);
  await page.getByRole('link', { name: 'Make a form from a document instead' }).click();
  await expect(page).toHaveURL(/\/forms\/new$/);
  await expect(page.getByRole('button', { name: /Start from paper/ })).toBeVisible();

  await page.goto('/room');
  await tile(/Get something signed/).click();
  await expect(page).toHaveURL(/\/signing$/);

  await page.goto('/room');
  await expect(tile(/Send a file/)).toHaveAttribute('href', '/send');

  // Arriving on home was the arrival: the intro does not play over a part one click later.
  await expect(page.locator('.intro__stage')).toHaveCount(0);
});

test('the rail is four coloured parts, and everything else is under More', async ({ page }) => {
  await signInAs(page, sql, 'admin@example.com', 'en-GB');
  await page.goto('/room');
  const rail = page.getByRole('navigation', { name: 'Sections' });
  await expect(rail.locator('.nav-link__chip')).toHaveCount(4);
  await expect(rail.getByRole('link', { name: 'People', exact: true })).toBeHidden();
});

test('at 360 × 640 in German, home fits without sideways scrolling', async ({ page }) => {
  await signInAs(page, sql, 'admin@example.com', 'de-DE');
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto('/room');
  await expect(page.getByRole('heading', { level: 1, name: 'Was möchten Sie tun?' })).toBeVisible();

  await expect(page.locator('.intro__stage')).toHaveCount(0, { timeout: 20_000 });
  if (process.env['HOME_SHOTS']) {
    await page.screenshot({ path: `${process.env['HOME_SHOTS']}/home-de-360.png` });
  }
  const fits = await page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  );
  expect(fits).toBe(true);
  for (const name of [
    /Formulare erstellen/,
    /Papier scannen/,
    /Etwas unterschreiben/,
    /Datei senden/,
  ]) {
    const tile = page.locator('.home__tiles').getByRole('link', { name });
    await tile.scrollIntoViewIfNeeded();
    const box = await tile.boundingBox();
    expect(box!.height, `${name} is a target a thumb can hit`).toBeGreaterThanOrEqual(44);
    expect(box!.x + box!.width).toBeLessThanOrEqual(360);
  }
});
