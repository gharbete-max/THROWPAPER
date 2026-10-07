import { expect, test, type Page } from '@playwright/test';
import { db, plantLoginToken, signInAs } from './support.js';

/**
 * The room — phase 2 of `docs/plan/DOCUMENTS.md`, ADR 0022.
 *
 * Signing in lands in an empty dark grey room with three cootie catchers. Documents is built and
 * opens into Forms, Scan, Sign and Send around the centre; Spreadsheets and Presentation & planning
 * are placeholders that must never pretend to be controls. Checked by keyboard, under reduced
 * motion, at 360 × 640 in German, and on the server edition this suite runs, which has no Send and
 * no summary.
 */
const sql = db();

test.afterAll(async () => {
  await sql.end();
});

const ROOM = /\/room$/;
const OPENED = /\/room\/documents$/;

/** Every element the keyboard reaches, in order, until focus comes round again. */
async function tabStops(page: Page): Promise<string[]> {
  const stops: string[] = [];
  for (let step = 0; step < 30; step += 1) {
    await page.keyboard.press('Tab');
    const stop = await page.evaluate(() => {
      const active = document.activeElement;
      if (!active || active === document.body) return null;
      const idle = active.closest('.catcher--idle') !== null;
      return `${idle ? 'IDLE ' : ''}${active.tagName}:${(active.textContent ?? '').trim()}`;
    });
    if (stop === null || stops.includes(stop)) break;
    stops.push(stop);
  }
  return stops;
}

test('signing in lands in the room, with three named catchers', async ({ page }) => {
  // Through the magic link's own landing screen, which sends a person to the app's `/`.
  const secret = await plantLoginToken(sql, 'admin@example.com');
  await page.addInitScript(() => window.localStorage.setItem('tp.locale', 'en-GB'));
  await page.goto(`/auth/callback?token=${secret}`);

  await expect(page).toHaveURL(ROOM);
  await expect(page.getByRole('link', { name: 'Documents' })).toBeVisible();
  await expect(page.getByText('Spreadsheets', { exact: true })).toBeVisible();
  await expect(page.getByText('Presentation & planning', { exact: true })).toBeVisible();
  await expect(page.getByText('Not built yet')).toHaveCount(2);

  // An unknown address inside the app lands here too, not on the old events list.
  await page.goto('/nowhere-at-all');
  await expect(page).toHaveURL(ROOM);
});

test('the placeholders are not controls, by role or by keyboard', async ({ page }) => {
  await signInAs(page, sql, 'admin@example.com', 'en-GB');
  await page.goto('/room');
  await expect(page.getByRole('link', { name: 'Documents' })).toBeVisible();

  for (const name of ['Spreadsheets', 'Presentation & planning']) {
    await expect(page.getByRole('link', { name })).toHaveCount(0);
    await expect(page.getByRole('button', { name })).toHaveCount(0);
  }
  const reachable = await page
    .locator('.catcher--idle :is(a, button, input, select, textarea, [tabindex], [onclick])')
    .count();
  expect(reachable, 'a placeholder holds something a person could press').toBe(0);

  const stops = await tabStops(page);
  expect(stops.some((stop) => stop.startsWith('A:Documents'))).toBe(true);
  expect(stops.filter((stop) => stop.startsWith('IDLE'))).toEqual([]);
});

test('Documents opens by keyboard into four parts around the centre, and Escape closes it', async ({
  page,
}) => {
  await signInAs(page, sql, 'admin@example.com', 'en-GB');
  await page.goto('/room');

  const documents = page.getByRole('link', { name: 'Documents' });
  await documents.focus();
  await page.keyboard.press('Enter');

  await expect(page).toHaveURL(OPENED);
  await expect(page.getByRole('heading', { level: 2, name: 'Documents' })).toBeVisible();
  // Focus moves to the first part, and the opening is said aloud.
  await expect(page.getByRole('link', { name: 'Forms' })).toBeFocused();
  await expect(page.locator('.room__floor > [aria-live="polite"]')).toHaveText('Documents is open');

  await expect(page.getByRole('link', { name: 'Scan' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sign' })).toBeVisible();
  // The server edition has no To send and no summary, and says so rather than offering either.
  await expect(page.getByRole('link', { name: 'Send' })).toHaveCount(0);
  await expect(page.locator('.room__part--send')).toContainText('Not in this edition');
  await expect(page.locator('.room__centre')).toContainText('Summary and translation');
  await expect(page.locator('.room__centre')).toContainText('Not in this edition');

  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(ROOM);
  await expect(page.getByRole('link', { name: 'Documents' })).toBeFocused();

  // Back in the browser closes it too: the opened catcher is an address.
  await page.getByRole('link', { name: 'Documents' }).click();
  await expect(page).toHaveURL(OPENED);
  await page.goBack();
  await expect(page).toHaveURL(ROOM);
});

test('the parts lead to the screens that do the work, and every screen leads back', async ({
  page,
}) => {
  await signInAs(page, sql, 'admin@example.com', 'en-GB');
  await page.goto('/room/documents');

  await page.getByRole('link', { name: 'Forms' }).click();
  await expect(page).toHaveURL(/\/forms$/);
  await page.getByRole('link', { name: 'Back to the room' }).first().click();
  await expect(page).toHaveURL(ROOM);

  await page.goto('/room/documents');
  await page.getByRole('link', { name: 'Scan' }).click();
  await expect(page).toHaveURL(/\/forms\?new$/);
  // Scan lands with the doors open, on the paper door.
  await expect(page.getByRole('button', { name: /Start from paper/ })).toBeVisible();

  await page.goto('/room/documents');
  await page.getByRole('link', { name: 'Sign' }).click();
  await expect(page).toHaveURL(/\/signing$/);

  // Arriving in the room was the arrival: the intro does not play over a part one click later.
  await expect(page.locator('.intro__stage')).toHaveCount(0);
});

test('the float can be paused, and nothing moves under reduced motion', async ({ page }) => {
  await signInAs(page, sql, 'admin@example.com', 'en-GB');
  await page.goto('/room');

  const running = () =>
    page.evaluate(
      () =>
        document.getAnimations().filter((animation) => animation.playState === 'running').length,
    );
  await expect.poll(running).toBeGreaterThan(0);

  const pause = page.getByRole('button', { name: 'Pause the motion' });
  await pause.click();
  await expect(page.getByRole('button', { name: 'Play the motion' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect.poll(running).toBe(0);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload();
  await expect(page.getByRole('link', { name: 'Documents' })).toBeVisible();
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
  // Nothing moves, so there is nothing to pause.
  await expect(page.getByRole('button', { name: 'Pause the motion' })).toBeHidden();

  await page.getByRole('link', { name: 'Documents' }).click();
  await expect(page).toHaveURL(OPENED);
  await expect(page.getByRole('link', { name: 'Forms' })).toBeVisible();
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
});

test('at 360 × 640 in German, the room and the opened catcher fit without sideways scrolling', async ({
  page,
}) => {
  await signInAs(page, sql, 'admin@example.com', 'de-DE');
  await page.setViewportSize({ width: 360, height: 640 });

  const fits = () =>
    page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    );

  await page.goto('/room');
  await expect(page.getByText('Präsentation & Planung', { exact: true })).toBeVisible();
  expect(await fits()).toBe(true);

  await page.getByRole('link', { name: 'Dokumente' }).click();
  await expect(page).toHaveURL(OPENED);
  for (const name of ['Formulare', 'Scannen', 'Unterschreiben']) {
    const part = page.getByRole('link', { name });
    await expect(part).toBeInViewport({ ratio: 1 });
    const box = await part.boundingBox();
    expect(box!.height, `${name} is a target a thumb can hit`).toBeGreaterThanOrEqual(44);
  }
  await expect(page.locator('.room__centre')).toBeInViewport({ ratio: 1 });
  expect(await fits()).toBe(true);
});
