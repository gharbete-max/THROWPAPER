import { expect, test } from '@playwright/test';
import { db, signInAs } from './support.js';

/**
 * New form starts with "What do you want to make?" (`docs/plan/EASY.md`): typed words lead to a
 * template or to another part of the app, and an AI switch appears only where the desktop has a
 * text model. The server edition this suite runs has no model, so the switch is checked with a
 * stand-in `window.loppaAi` that answers one draft.
 */
const sql = db();

test.afterAll(async () => {
  await sql.end();
});

const SHOTS = process.env['ASK_SHOTS'];

async function ask(page: import('@playwright/test').Page, words: string) {
  await page.goto('/forms');
  await page.getByRole('button', { name: 'New form' }).first().click();
  await page.getByLabel('What do you want to make?').fill(words);
  await page.getByRole('button', { name: 'Go' }).click();
}

test('"PoA" leads to the power of attorney template in two presses @smoke', async ({ page }) => {
  await signInAs(page, sql, 'admin@example.com', 'en-GB');
  await ask(page, 'make a PoA');
  await expect(page.getByText('That sounds like “Power of attorney”.')).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/ask-keyword.png` });
  await page.getByRole('button', { name: 'Use “Power of attorney”' }).click();
  await expect(page).toHaveURL(/\/forms\/[0-9a-f-]{36}$/);
});

test('one tap on a picture card makes the form, and "Something else" is the blank page', async ({
  page,
}) => {
  await signInAs(page, sql, 'admin@example.com', 'en-GB');
  await page.goto('/forms/new');
  await expect(page.locator('.ask__card')).toHaveCount(8);
  await page.getByRole('button', { name: 'Feedback' }).click();
  await expect(page).toHaveURL(/\/forms\/[0-9a-f-]{36}$/);
  await expect(page.locator('.builder__list > li').first()).toBeVisible();

  await page.goto('/forms/new');
  await page.getByRole('button', { name: 'Something else' }).click();
  await expect(page).toHaveURL(/\/forms\?new=manual/);
});

test('"contract" leads to Sign, and nonsense falls back to the questions', async ({ page }) => {
  await signInAs(page, sql, 'admin@example.com', 'en-GB');
  await ask(page, 'contract');
  await page.getByRole('button', { name: 'Open Sign' }).click();
  await expect(page).toHaveURL(/\/signing$/);

  await ask(page, 'zxqv');
  await expect(page.getByText(/I don't know that one yet/)).toBeVisible();
  await page.getByRole('button', { name: 'Ask me questions' }).click();
  await expect(page).toHaveURL(/\/guided$/);
});

test('there is no AI switch where there is no model', async ({ page }) => {
  await signInAs(page, sql, 'admin@example.com', 'en-GB');
  await page.goto('/forms');
  await page.getByRole('button', { name: 'New form' }).first().click();
  await expect(page.getByLabel('What do you want to make?')).toBeVisible();
  await expect(page.getByRole('switch')).toHaveCount(0);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/ask-empty.png` });
});

test('with a model, the AI switch drafts a form that is saved only when used', async ({ page }) => {
  await page.addInitScript(() => {
    const listeners = new Set<(event: unknown) => void>();
    const draft = JSON.stringify({
      title: 'Football camp',
      fields: [
        { label: 'Child’s name', type: 'short_text', required: true },
        { label: 'Age group', type: 'single_select', options: ['6–8', '9–12'] },
        { label: 'Parent’s email', type: 'email', required: true },
      ],
    });
    (window as unknown as { loppaAi: unknown }).loppaAi = {
      status: () =>
        Promise.resolve({
          models: [{ available: true, capabilities: ['text'], state: 'installed' }],
        }),
      run: (id: string) => {
        setTimeout(() => {
          for (const l of listeners) l({ id, kind: 'text', mode: 'replace', text: draft });
          for (const l of listeners) l({ id, kind: 'done', warnings: [], seconds: 1 });
        }, 300);
        return Promise.resolve({ ok: true, id });
      },
      cancel: () => Promise.resolve(),
      onEvent: (listener: (event: unknown) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
  });
  await signInAs(page, sql, 'admin@example.com', 'en-GB');
  await page.goto('/forms');
  const before = await page.locator('table tbody tr, .form-row, li.form').count();
  await page.getByRole('button', { name: 'New form' }).first().click();
  await page.getByRole('switch', { name: 'Let the AI draft it' }).check();
  await page.getByLabel('What do you want to make?').fill('sign-up for a football camp');
  await page.getByRole('button', { name: 'Go' }).click();
  await expect(page.getByText(/Here is a draft with 3 questions/)).toBeVisible();
  await expect(page.getByText('Age group')).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/ask-ai.png` });
  expect(await page.locator('table tbody tr, .form-row, li.form').count()).toBe(before);
  await page.getByRole('button', { name: 'Use this form' }).click();
  await expect(page).toHaveURL(/\/forms\/[0-9a-f-]{36}$/);
  await expect(page.getByText('Age group').first()).toBeVisible();
});
