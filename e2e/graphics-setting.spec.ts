import { expect, test } from '@playwright/test';
import { db, signInAs } from './support.js';
import { fakeBridge } from './fake-model.js';

/**
 * "Use the graphics card (faster, optional)" in the model list (ADR 0025, docs/plan/VISION-TUNING.md
 * §5): off by default, a confirmation that names the host, the file and the size before anything is
 * fetched, a remembered failure said in plain words, and "not available yet" on a Mac. The shell is
 * the same fake as the rest of the summary centre's tests, with the three graphics calls added.
 */
const sql = db();
test.afterAll(async () => {
  await sql.end();
});

interface Seed {
  support?: 'available' | 'later';
  present?: boolean;
  enabled?: boolean;
  failure?: string | null;
  ranOn?: string | null;
  device?: string | null;
}

/** Stands alone: it is serialised into the page. */
function graphicsFake(seed: Seed) {
  const w = window as unknown as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const ai = w.loppaAi;
  const base = ai.status.bind(ai);
  const listeners: Array<(event: unknown) => void> = [];
  const baseOn = ai.onEvent;
  ai.onEvent = (listener: (event: unknown) => void) => {
    listeners.push(listener);
    return baseOn(listener);
  };
  const g = {
    support: 'available',
    enabled: false,
    present: false,
    consent: {
      host: 'github.com',
      files: ['llama-b11741-bin-win-vulkan-x64.zip'],
      totalBytes: 32359614,
    },
    folder: 'C:\\Users\\me\\AppData\\Roaming\\Loppa\\models\\runtime-vulkan',
    failure: null,
    ranOn: null,
    device: null,
    ...seed,
  };
  const calls = { use: [] as boolean[], install: [] as unknown[], cleared: 0 };
  w.__graphics = calls;
  const status = async () => ({
    ...(await base()),
    graphics: { ...g, consent: g.present ? null : g.consent },
  });
  ai.status = status;
  ai.useGraphics = async (on: boolean) => {
    calls.use.push(on);
    if (!on || g.present) g.enabled = on;
    return status();
  };
  ai.installGraphics = async (consent: unknown) => {
    calls.install.push(consent);
    g.present = true;
    g.enabled = true;
    // the shell says so when the program is in place, as the real coordinator does
    setTimeout(async () => {
      const done = {
        id: 'graphics:install',
        kind: 'installed',
        modelId: 'graphics',
        status: await status(),
      };
      listeners.forEach((l) => l(done));
    }, 20);
    return { ok: true, id: 'graphics:install' };
  };
  ai.clearGraphicsFailure = async () => {
    calls.cleared += 1;
    g.failure = null;
    return status();
  };
}

const NAME = 'Use the graphics card (faster, optional)';

async function open(page: import('@playwright/test').Page, seed: Seed = {}) {
  await page.addInitScript(fakeBridge);
  await page.addInitScript(graphicsFake, seed);
  await signInAs(page, sql, 'admin@example.com', 'en-GB');
  await page.goto('/summary');
  await expect(page.getByRole('heading', { name: 'AI models on this computer' })).toBeVisible();
}

test('the setting is off by default; turning it on asks first, naming host, file and size', async ({
  page,
}) => {
  await open(page);
  const box = page.getByRole('checkbox', { name: NAME });
  await expect(box).not.toBeChecked();
  await expect(page.getByText('Off unless you turn it on.')).toBeVisible();
  await expect(page.getByText('runtime-vulkan', { exact: false })).toBeVisible();

  await box.click();
  const dialog = page.getByRole('dialog', { name: 'Confirm' });
  await expect(dialog).toContainText('github.com');
  await expect(dialog).toContainText('llama-b11741-bin-win-vulkan-x64.zip');
  await expect(dialog).toContainText('32 MB');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(box).not.toBeChecked();
  expect(
    await page.evaluate(
      () => (window as never as { __graphics: { install: unknown[] } }).__graphics.install.length,
    ),
  ).toBe(0);

  await box.click();
  await dialog.getByRole('button', { name: 'Download' }).click();
  await expect(box).toBeChecked();
  expect(
    await page.evaluate(
      () => (window as never as { __graphics: { install: unknown[] } }).__graphics.install.length,
    ),
  ).toBe(1);
});

test('with the program already there, it turns on and off with no download and no question', async ({
  page,
}) => {
  await open(page, { present: true });
  const box = page.getByRole('checkbox', { name: NAME });
  await box.check();
  await expect(box).toBeChecked();
  await expect(page.getByRole('dialog')).toBeHidden();
  await box.uncheck();
  await expect(box).not.toBeChecked();
});

test('a failed card is said in plain words, the processor is named, and one button tries again', async ({
  page,
}) => {
  await open(page, { present: true, enabled: true, failure: 'start-failed', ranOn: 'processor' });
  await expect(
    page.getByText('The graphics card could not be used; using the processor.'),
  ).toBeVisible();
  await expect(page.getByText('Running on: the processor')).toBeVisible();
  await page.getByRole('button', { name: 'Try the graphics card again' }).click();
  await expect(page.getByText('The graphics card could not be used')).toBeHidden();
});

test('names the card when the program says it ran on one', async ({ page }) => {
  await open(page, {
    present: true,
    enabled: true,
    ranOn: 'graphics',
    device: 'NVIDIA GeForce RTX 4070',
  });
  await expect(
    page.getByText('Running on: the graphics card (NVIDIA GeForce RTX 4070)'),
  ).toBeVisible();
});

test('on a Mac it says it is not available yet and cannot be turned on', async ({ page }) => {
  await open(page, { support: 'later' });
  await expect(page.getByRole('checkbox', { name: NAME })).toBeDisabled();
  await expect(page.getByText('Not available yet on this computer.')).toBeVisible();
});
