import { expect, test, type Page } from '@playwright/test';
import { db, signInAs } from './support.js';

/**
 * The guided builder, pressed — `docs/plan/PREDICTIVE-BUILDER.md`, acceptance S2 ("the buttons
 * chain"), without the editor: New form → Start from questions → buttons, one number typed, and
 * the form the draft holds is the one the answers described. Then the same chain by keyboard
 * alone on a 360 × 640 screen, where every node's answers must be on screen without scrolling
 * (`CAVEATS.md` #37); and a reload in the middle, which must come back to the same question.
 *
 * This replaces `wizard.spec.ts`: the wizard it pressed is what "Start from questions" replaced.
 */
const sql = db();
const created: string[] = [];

test.afterAll(async () => {
  for (const id of created) {
    await sql`delete from builder_sessions where form_id = ${id}`;
    await sql`delete from forms where id = ${id}`;
  }
  await sql.end();
});

const GUIDED = /\/forms\/([0-9a-f-]{36})\/guided$/;

async function startFromQuestions(page: Page): Promise<string> {
  await page.goto('/forms');
  await page.getByRole('button', { name: 'New form' }).first().click();
  await page.getByRole('button', { name: /Start from questions/ }).click();
  await expect(page).toHaveURL(GUIDED);
  const formId = GUIDED.exec(page.url())![1]!;
  created.push(formId);
  await expect(page.getByRole('heading', { name: 'What is this form for?' })).toBeVisible();
  return formId;
}

const question = (page: Page, text: string) =>
  expect(page.getByRole('heading', { level: 1, name: text })).toBeVisible();

async function draftOf(formId: string) {
  const [row] = await sql`select draft_definition from forms where id = ${formId}`;
  return row!['draft_definition'] as {
    fields: {
      type: string;
      label: Record<string, string>;
      required: boolean;
      appearance?: string;
      options?: unknown[];
      style?: { shape?: string; columns?: string };
    }[];
  };
}

test('the buttons chain builds the form it describes, without the editor', async ({ page }) => {
  await signInAs(page, sql, 'admin@example.com', 'en-GB');
  const formId = await startFromQuestions(page);

  await page.getByRole('button', { name: /Signing people up/ }).click();
  await question(page, 'Should this look like your organisation?');
  await page.getByRole('button', { name: /Decide later/ }).click();

  // The question's own words: an example chip puts them in the box, to keep or edit.
  await question(page, 'What do you want to ask?');
  await page.getByRole('button', { name: 'Which day suits you?' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();

  await question(page, 'Must everyone answer this?');
  await page.getByRole('button', { name: /Yes, it's needed/ }).click();
  await question(page, 'Do you want buttons?');
  await page.getByRole('button', { name: 'Yes', exact: true }).click();
  await question(page, 'One answer or several?');
  await page.getByRole('button', { name: /One answer only/ }).click();

  // The number typed, read by the ladder, and said back with a way to change it.
  await question(page, 'How many options?');
  await page.getByPlaceholder(/Or type it/).fill('four');
  await page.getByPlaceholder(/Or type it/).press('Enter');
  await question(page, 'What shape?');
  await expect(page.getByText('read that as “4”')).toBeVisible();
  await expect(page.locator('.conversation__preview')).toHaveCount(0);

  await page.getByRole('button', { name: 'Pill', exact: true }).click();
  // The control appears once its shape is answered: the real one, with the question typed above.
  await question(page, 'Where should they sit?');
  await expect(page.locator('.conversation__preview')).toContainText('Which day suits you?');
  await page.getByRole('button', { name: /Under the question, full width/ }).click();

  await expect(page.locator('.conversation__preview')).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  await question(page, 'Add another question?');
  await page.getByRole('button', { name: /No, that's everything/ }).click();
  await question(page, 'Your form is ready.');

  // The trail says every answer, and each is a way back.
  const trail = page.getByRole('navigation', { name: 'Your answers so far' });
  await expect(trail).toContainText('Signing people up');
  await expect(trail).toContainText('Which day suits you?');

  await page.getByRole('button', { name: /Open it in the editor/ }).click();
  await expect(page).toHaveURL(new RegExp(`/forms/${formId}$`));

  // "Signing people up" starts the form with a name; the chain added its question after it.
  const { fields } = await draftOf(formId);
  expect(fields.map((f) => f.type)).toEqual(['short_text', 'single_select']);
  const field = fields[1]!;
  expect(Object.values(field.label)).toContain('Which day suits you?');
  expect(field).toMatchObject({
    type: 'single_select',
    required: true,
    appearance: 'buttons',
    style: { shape: 'pill', columns: '1' },
  });
  expect(field.options).toHaveLength(4);
});

test('a reload comes back to the same question, with Back still there', async ({ page }) => {
  await signInAs(page, sql, 'admin@example.com', 'en-GB');
  await startFromQuestions(page);
  await page.getByRole('button', { name: /Signing people up/ }).click();
  await page.getByRole('button', { name: /Decide later/ }).click();
  await question(page, 'What do you want to ask?');
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();

  await page.reload();
  await question(page, 'What do you want to ask?');
  await expect(page.getByRole('navigation', { name: 'Your answers so far' })).toContainText(
    'Decide later',
  );
  await page.getByRole('button', { name: 'Back' }).click();
  await question(page, 'Should this look like your organisation?');
  // Focus returns to the answer that was chosen.
  await expect(page.getByRole('button', { name: /Decide later/ })).toBeFocused();
});

test('the paper door opens a new form in the editor, its paper import already open', async ({
  page,
}) => {
  await signInAs(page, sql, 'admin@example.com', 'en-GB');
  await page.goto('/forms');
  await page.getByRole('button', { name: 'New form' }).first().click();
  await page.getByRole('button', { name: /Start from paper/ }).click();
  // The address is the form's own: the door's `?paper` is read once and dropped.
  await expect(page).toHaveURL(/\/forms\/[0-9a-f-]{36}$/);
  created.push(page.url().split('/').pop()!);
  await expect(page.getByLabel('PDF or photographs')).toBeAttached();
});

test.describe('on a small phone, by keyboard alone', () => {
  test.use({ viewport: { width: 360, height: 640 } });

  /** Every answer card is on the first screen: nothing to scroll to, and nothing under a bar. */
  async function answersFit(page: Page) {
    const { bottom, floor, wide } = await page.evaluate(() => {
      const answers = Array.from(document.querySelectorAll('[data-answer]'));
      const bar = document.querySelector('.sidebar')?.getBoundingClientRect();
      // On a phone the sections are a bar along the bottom, over the page.
      const barTop = bar && bar.top > window.innerHeight / 2 ? bar.top : window.innerHeight;
      return {
        bottom: Math.max(0, ...answers.map((a) => a.getBoundingClientRect().bottom + scrollY)),
        floor: Math.min(window.innerHeight, barTop),
        // Nothing sideways either: a screen wider than the phone hides answers off its edge.
        wide: document.documentElement.scrollWidth > window.innerWidth,
      };
    });
    const heading = await page.getByRole('heading', { level: 1 }).textContent();
    expect(wide, `"${heading}" is wider than the screen`).toBe(false);
    expect(bottom, `the answers to "${heading}" end below the first screen`).toBeLessThanOrEqual(
      floor,
    );
  }

  test('the chain, pressed with digits, Escape and Enter', async ({ page }) => {
    await signInAs(page, sql, 'admin@example.com', 'en-GB');
    const formId = await startFromQuestions(page);

    const step = async (ask: string, key: string) => {
      await question(page, ask);
      await answersFit(page);
      await page.keyboard.press(key);
    };

    await step('What is this form for?', '1');
    await step('Should this look like your organisation?', '2');
    await question(page, 'What do you want to ask?');
    // Focus is in the box already; Enter answers.
    await expect(page.getByRole('textbox', { name: 'What do you want to ask?' })).toBeFocused();
    await page.keyboard.type('Which day suits you?');
    await page.keyboard.press('Enter');
    await step('Must everyone answer this?', '1');
    await step('Do you want buttons?', '1');
    await question(page, 'One answer or several?');

    // Escape is back one step, and focus returns to the answer given there; Enter gives it again.
    await page.keyboard.press('Escape');
    await question(page, 'Do you want buttons?');
    await expect(page.getByRole('button', { name: 'Yes', exact: true })).toBeFocused();
    await page.keyboard.press('Enter');

    await step('One answer or several?', '1');
    await question(page, 'How many options?');
    // No cards here: focus is on Continue, and the number is typed in the box after it.
    await expect(page.getByRole('button', { name: 'Continue' })).toBeFocused();
    await page.keyboard.press('Tab');
    await page.keyboard.type('4');
    await page.keyboard.press('Enter');
    await step('What shape?', '1');
    await step('Where should they sit?', '1');
    // The preview moment: Continue has focus.
    await expect(page.getByRole('button', { name: 'Continue' })).toBeFocused();
    await page.keyboard.press('Enter');
    await step('Add another question?', '2');
    await step('Your form is ready.', '1');
    await expect(page).toHaveURL(new RegExp(`/forms/${formId}$`));

    const { fields } = await draftOf(formId);
    expect(fields).toHaveLength(2);
    expect(fields[1]).toMatchObject({ type: 'single_select', options: { length: 4 } });
  });

  test('the brand questions fit too', async ({ page }) => {
    await signInAs(page, sql, 'admin@example.com', 'en-GB');
    await startFromQuestions(page);
    await page.keyboard.press('1');
    await question(page, 'Should this look like your organisation?');
    await page.keyboard.press('1');

    // The colours are asked only when there is no brand kit to use; where the logo goes, always.
    const colours = page.getByRole('heading', { name: 'Which colours should your form use?' });
    const logo = page.getByRole('heading', { name: 'Where should your logo go?' });
    await expect(colours.or(logo)).toBeVisible();
    if (await colours.isVisible()) {
      await answersFit(page);
      await page.keyboard.press('1');
    }
    await expect(logo).toBeVisible();
    await answersFit(page);
    await page.keyboard.press('1');
    await expect(page.getByRole('button', { name: 'Continue' })).toBeFocused();
  });
});
