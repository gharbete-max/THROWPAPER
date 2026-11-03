import { expect, test } from '@playwright/test';
import { db, signInAs } from './support.js';

/**
 * The chat at the foot of the form editor (`docs/plan/EASY.md`, E4): the editor is white in every
 * theme, the chat exists only where the desktop has a text model, and what it proposes reaches the
 * form only when accepted, as one Undo. The server edition this suite runs has no model, so the
 * desktop is stood in for by a `window.loppaAi` that answers one draft.
 */
const sql = db();
const created: string[] = [];

test.afterAll(async () => {
  for (const id of created) {
    await sql`delete from form_versions where form_id = ${id}`;
    await sql`delete from forms where id = ${id}`;
  }
  await sql.end();
});

async function newForm(page: import('@playwright/test').Page, stamp: string) {
  await page.goto('/forms?new=manual');
  await page.getByLabel('Title', { exact: true }).fill(`Chat ${stamp}`);
  await page.getByLabel('Link address').fill(`chat-${stamp}`);
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page).toHaveURL(/\/forms\/[0-9a-f-]{36}$/);
  created.push(page.url().split('/').pop()!);
}

test('without a model there is no chat bar, and the editor is white even in a dark theme', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await signInAs(page, sql, 'admin@example.com', 'en-GB');
  await newForm(page, `a${Date.now().toString(36)}`);
  await expect(page.getByRole('group', { name: 'Add to the page' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Ask Loppa' })).toHaveCount(0);
  const colours = await page.locator('.eb').evaluate((el) => {
    const style = getComputedStyle(el);
    return { background: style.backgroundColor, ink: style.color };
  });
  expect(colours.background).toBe('rgb(255, 255, 255)');
  expect(colours.ink).toBe('rgb(26, 26, 26)');
});

test('with a model, the chat proposes questions that are added only when accepted @smoke', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const listeners = new Set<(event: unknown) => void>();
    const draft = JSON.stringify({
      title: 'Ignored',
      fields: [
        { label: 'Phone number', type: 'phone', required: true },
        { label: 'T-shirt size', type: 'single_select', options: ['S', 'M', 'L'] },
      ],
    });
    const asked: unknown[] = [];
    (window as unknown as { __asked: unknown[] }).__asked = asked;
    (window as unknown as { loppaAi: unknown }).loppaAi = {
      status: () =>
        Promise.resolve({
          models: [{ available: true, capabilities: ['text'], state: 'installed' }],
        }),
      run: (id: string, task: unknown) => {
        asked.push(task);
        setTimeout(() => {
          for (const l of listeners) l({ id, kind: 'text', mode: 'replace', text: draft });
          for (const l of listeners) l({ id, kind: 'done', warnings: [], seconds: 1 });
        }, 200);
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
  await newForm(page, `b${Date.now().toString(36)}`);

  const chat = page.getByRole('region', { name: 'Ask Loppa' });
  const rows = page.locator('.builder__list > li');
  await expect(rows).toHaveCount(0);

  // A request about wording a person writes is never sent to the model.
  await chat.getByRole('textbox', { name: 'Ask Loppa' }).fill('a liability waiver');
  await chat.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(chat.getByText(/wording a person must write/)).toBeVisible();
  expect(
    await page.evaluate(() => (window as unknown as { __asked: unknown[] }).__asked.length),
  ).toBe(0);

  // An ordinary one is: two proposals, nothing on the page until Add.
  await chat.getByRole('textbox', { name: 'Ask Loppa' }).fill('phone number and t-shirt size');
  await chat.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(chat.getByText('I proposed 2 questions. Tick the ones you want.')).toBeVisible();
  await expect(rows).toHaveCount(0);

  // One is unticked; the other is added, and one Undo takes it away again.
  await chat.getByLabel('T-shirt size').uncheck();
  await chat.getByRole('button', { name: 'Add 1' }).click();
  await expect(rows).toHaveCount(1);
  await expect(page.getByText('Phone number').first()).toBeVisible();
  await page.getByRole('button', { name: /^Undo/ }).click();
  await expect(rows).toHaveCount(0);
});
