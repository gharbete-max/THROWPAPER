import { expect, test, type Locator, type Page } from '@playwright/test';
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

/**
 * Moves focus with Tab alone — Shift+Tab when the target is above, as a person would — until
 * `target` has it, and fails rather than loop.
 */
async function tabTo(page: Page, target: Locator, max = 120) {
  await expect(target).toBeVisible();
  for (let presses = 0; presses < max; presses += 1) {
    const where = await target.evaluate((el) => {
      const at = document.activeElement;
      if (el === at) return 'here';
      if (!at || at === document.body) return 'after';
      return at.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING ? 'after' : 'before';
    });
    if (where === 'here') return;
    await page.keyboard.press(where === 'after' ? 'Tab' : 'Shift+Tab');
  }
  throw new Error(`Tab never reached ${target.toString()}`);
}

/** "New form", then "Start from questions", each reached by Tab and pressed with Enter. */
async function startFromQuestionsByKeys(page: Page): Promise<string> {
  await page.goto('/forms');
  await tabTo(page, page.getByRole('button', { name: 'New form' }).first());
  await page.keyboard.press('Enter');
  await tabTo(page, page.getByRole('button', { name: /Start from questions/ }));
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(GUIDED);
  const formId = GUIDED.exec(page.url())![1]!;
  created.push(formId);
  await question(page, 'What is this form for?');
  return formId;
}

/**
 * Past the guess (S11): after "Signing people up" the engine asks what tells it most — first
 * whether it is on a set date, then whether people learn something — and two "Not sure" end it.
 */
async function notSureTwice(page: Page) {
  for (const ask of ['Is it for something on a set date?', 'Will people learn something there?']) {
    await question(page, ask);
    // Exactly: the trail's crumb for an answered question says "Not sure" too.
    await page.getByRole('button', { name: 'Not sure', exact: true }).click();
  }
  await nameTheForm(page);
}

/** "What is your form called?" (S13): an example name, kept as it is. */
async function nameTheForm(page: Page) {
  await question(page, 'What is your form called?');
  await page.getByRole('button', { name: 'Summer party', exact: true }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
}

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
  await notSureTwice(page);
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
  await notSureTwice(page);
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

test('the paper door opens the review screen for a new form (S10)', async ({ page }) => {
  await signInAs(page, sql, 'admin@example.com', 'en-GB');
  await page.goto('/forms');
  await page.getByRole('button', { name: 'New form' }).first().click();
  await page.getByRole('button', { name: /Start from paper/ }).click();
  await expect(page).toHaveURL(/\/forms\/[0-9a-f-]{36}\/import$/);
  created.push(page.url().split('/').at(-2)!);
  await expect(page.getByLabel('PDF, Word document or photograph', { exact: true })).toBeAttached();
  // A photograph still has the editor's paper import, open on arrival there.
  await page.getByRole('link', { name: 'Open the editor' }).click();
  await expect(page).toHaveURL(/\/forms\/[0-9a-f-]{36}$/);
  await expect(page.getByLabel('PDF, Word document or photographs')).toBeAttached();
});

test('not happy with the preview: edited in place, reverted, reconciled, and never written over', async ({
  page,
}) => {
  // Acceptance S3, `docs/plan/PREDICTIVE-BUILDER.md`.
  await signInAs(page, sql, 'admin@example.com', 'en-GB');
  const formId = await startFromQuestions(page);
  for (const [ask, pick] of [
    ['What is this form for?', /Signing people up/],
    // Exactly "Not sure": the trail's crumb for the first says it too.
    ['Is it for something on a set date?', /^Not sure$/],
    ['Will people learn something there?', /^Not sure$/],
  ] as const) {
    await question(page, ask);
    await page.getByRole('button', { name: pick }).click();
  }
  await nameTheForm(page);
  await question(page, 'Should this look like your organisation?');
  await page.getByRole('button', { name: /Decide later/ }).click();
  await question(page, 'What do you want to ask?');
  await page.getByRole('button', { name: 'Which day suits you?' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: /Yes, it's needed/ }).click();
  await page.getByRole('button', { name: 'Yes', exact: true }).click();
  await page.getByRole('button', { name: /One answer only/ }).click();
  await page.getByPlaceholder(/Or type it/).fill('3');
  await page.getByPlaceholder(/Or type it/).press('Enter');
  await page.getByRole('button', { name: 'Pill', exact: true }).click();
  await question(page, 'Where should they sit?');

  const control = page.locator('.preview-moment__frame fieldset.choice');
  await expect(control).toHaveClass(/choice--shape-pill/);

  // The one sentence under the preview opens inline editing.
  await page
    .getByRole('button', { name: 'Not completely happy with the preview? Click it to edit.' })
    .click();
  const panel = page.getByRole('group', { name: 'Change it here' });
  await panel.getByRole('button', { name: 'Joined in one bar' }).click();
  await expect(control).toHaveClass(/choice--shape-segmented/);
  await panel.getByRole('button', { name: 'Larger' }).click();
  await expect(control).toHaveClass(/choice--size-large/);
  // The handle snaps: there is no size past the largest.
  await expect(panel.getByRole('button', { name: 'Larger' })).toBeDisabled();
  await panel.getByRole('button', { name: 'Accent' }).click();
  await expect(control).toHaveClass(/choice--accent-accent/);

  // An answer renamed in place, then moved — by its keyboard twin, then by drag.
  await panel.getByLabel('Answer 1').fill('Saturday');
  await panel.getByLabel('Answer 1').press('Enter');
  await expect(control).toContainText('Saturday');
  await panel.getByRole('button', { name: 'Move down' }).first().click();
  await expect(control.locator('.choice__option').nth(1)).toContainText('Saturday');
  const grips = panel.getByRole('button', { name: 'Drag to move' });
  // Centred first, at once (the page scrolls smoothly, and a box measured mid-scroll is wrong):
  // dragged near the window's edge, dnd-kit scrolls the page as the pointer moves, as far as the
  // time allows, and the drop lands wherever that leaves it.
  await grips
    .nth(1)
    .evaluate((grip) => grip.scrollIntoView({ block: 'center', behavior: 'instant' }));
  const from = (await grips.nth(2).boundingBox())!;
  const to = (await grips.nth(0).boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2, from.y - 10, { steps: 5 });
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 4, { steps: 10 });
  await page.mouse.up();
  // dnd-kit swallows every click for 50 ms after a drop: its pointer sensor takes its capturing
  // click listener off on a 50 ms timer. No person is that quick; a test runner is, and "Revert to
  // guided" below went unheard. A timer of the page's own, set now, fires after that one.
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 50)));
  await expect(control.locator('.choice__option').nth(2)).toContainText('Saturday');

  // Changed by hand, with its way back — and the way back is itself undone by Back.
  await expect(page.getByText('changed by hand', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Revert to guided' }).click();
  await expect(control).toHaveClass(/choice--shape-pill/);
  await expect(page.getByText('changed by hand', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(control).toHaveClass(/choice--shape-segmented/);
  await expect(page.getByText('changed by hand', { exact: true })).toBeVisible();

  // The next answer would change the question: the conversation asks instead of writing over it.
  await question(page, 'Where should they sit?');
  await page.getByRole('button', { name: /Under the question, full width/ }).click();
  await question(page, 'You changed this by hand. Keep your version, or use the guided one?');
  await page.getByRole('button', { name: 'Show both' }).click();
  await expect(page.getByText('Yours', { exact: true })).toBeVisible();
  await expect(page.getByText('Guided', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Keep mine' }).click();
  await expect(page.getByRole('button', { name: 'Continue' })).toBeVisible();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();

  const [field] = (await draftOf(formId)).fields.slice(1);
  expect(field).toMatchObject({ style: { shape: 'segmented', size: 'large', accent: 'accent' } });
  expect(field!.options).toHaveLength(3);

  // Leaving for the classic editor, renaming the question there, and coming back.
  await page.getByRole('button', { name: 'Build it myself' }).click();
  await expect(page).toHaveURL(new RegExp(`/forms/${formId}$`));
  await page
    .getByRole('button', { name: /Which day suits you\?/ })
    .first()
    .click();
  await page.getByLabel('Label').first().fill('Which day suits you best?');
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await page.goto(`/forms/${formId}/guided`);
  await expect(
    page.getByText('This form was changed in the editor.', { exact: false }),
  ).toBeVisible();
  await expect(page.locator('.preview-moment__frame')).toContainText('Which day suits you best?');
  await expect(page.getByText('changed by hand', { exact: true })).toBeVisible();
  expect(Object.values((await draftOf(formId)).fields[1]!.label)).toContain(
    'Which day suits you best?',
  );
});

test('acceptance S3 by keyboard alone: edited in place, reverted, and asked before anything is written over', async ({
  page,
}) => {
  await signInAs(page, sql, 'admin@example.com', 'en-GB');
  const formId = await startFromQuestionsByKeys(page);
  await page.keyboard.press('1');
  await pastTheGuessByKeys(page);
  await question(page, 'Should this look like your organisation?');
  await page.keyboard.press('2');
  await question(page, 'What do you want to ask?');
  await page.keyboard.type('Which day suits you?');
  await page.keyboard.press('Enter');
  for (const ask of [
    'Must everyone answer this?',
    'Do you want buttons?',
    'One answer or several?',
  ]) {
    await question(page, ask);
    await page.keyboard.press('1');
  }
  await question(page, 'How many options?');
  await page.keyboard.press('Tab');
  await page.keyboard.type('3');
  await page.keyboard.press('Enter');
  await question(page, 'What shape?');
  await page.keyboard.press('1');
  await question(page, 'Where should they sit?');

  // E opens inline editing, and every gesture in it has a key: the shape, the size and the colour
  // are buttons; an answer's words are its box; a drag is Move up and Move down (#44).
  const control = page.locator('.preview-moment__frame fieldset.choice');
  await expect(control).toHaveClass(/choice--shape-pill/);
  await page.keyboard.press('e');
  const panel = page.getByRole('group', { name: 'Change it here' });
  await expect(panel).toBeVisible();
  const press = async (target: Locator) => {
    await tabTo(page, target);
    await page.keyboard.press('Enter');
  };
  await press(panel.getByRole('button', { name: 'Joined in one bar' }));
  await expect(control).toHaveClass(/choice--shape-segmented/);
  await press(panel.getByRole('button', { name: 'Larger' }));
  await expect(control).toHaveClass(/choice--size-large/);
  await press(panel.getByRole('button', { name: 'Accent' }));
  await expect(control).toHaveClass(/choice--accent-accent/);

  await tabTo(page, panel.getByLabel('Answer 1'));
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type('Saturday');
  await page.keyboard.press('Enter');
  await expect(control).toContainText('Saturday');
  await press(panel.getByRole('button', { name: 'Move down' }).first());
  await expect(control.locator('.choice__option').nth(1)).toContainText('Saturday');
  await press(panel.getByRole('button', { name: 'Move down' }).nth(1));
  await expect(control.locator('.choice__option').nth(2)).toContainText('Saturday');

  // Changed by hand, with its way back — and the way back undone by Back.
  await expect(page.getByText('changed by hand', { exact: true })).toBeVisible();
  await press(page.getByRole('button', { name: 'Revert to guided' }));
  await expect(control).toHaveClass(/choice--shape-pill/);
  await expect(page.getByText('changed by hand', { exact: true })).toHaveCount(0);
  await press(page.getByRole('button', { name: 'Back' }));
  await expect(control).toHaveClass(/choice--shape-segmented/);
  await expect(page.getByText('changed by hand', { exact: true })).toBeVisible();

  // The next answer would change the question: asked, never written over.
  await question(page, 'Where should they sit?');
  await press(page.getByRole('button', { name: /Under the question, full width/ }));
  await question(page, 'You changed this by hand. Keep your version, or use the guided one?');
  await press(page.getByRole('button', { name: 'Keep mine' }));
  await expect(page.getByRole('button', { name: 'Continue' })).toBeVisible();
  await expect
    .poll(async () => (await draftOf(formId)).fields[1])
    .toMatchObject({ style: { shape: 'segmented', size: 'large', accent: 'accent' } });
  expect((await draftOf(formId)).fields[1]!.options).toHaveLength(3);
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
    const heading = await page.locator('#conversation-question').textContent();
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
    // Past the guess by its third answer, "Not sure" (S11).
    await step('Is it for something on a set date?', '3');
    await step('Will people learn something there?', '3');
    await nameTheFormByKeys(page);
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
    await pastTheGuessByKeys(page);
    await question(page, 'Should this look like your organisation?');
    await page.keyboard.press('1');

    // The demo organisation has a brand kit, so the colours are not asked: where the logo goes
    // always is. The colours are pressed at this size in "the colours are the organisation's".
    const logo = page.getByRole('heading', { name: 'Where should your logo go?' });
    await expect(logo).toBeVisible();
    await answersFit(page);
    await page.keyboard.press('1');
    await expect(page.getByRole('button', { name: 'Continue' })).toBeFocused();
  });

  /**
   * `CAVEATS.md` #36 (`rtl-and-long-strings`), `docs/plan/POLISH.md` S13b: the whole flow, once in
   * German — the longest of the twelve catalogues — and once mirrored, right to left. At every
   * question: nothing wider than the phone, every answer on the first screen, and no words cut —
   * no element that clips what overflows it holding more than it shows, nothing off either edge.
   */
  test.describe('long and mirrored (#36)', () => {
    /** Words that do not fit where they are: clipped by their box, or off the screen. */
    async function nothingCut(page: Page) {
      const cut = await page.evaluate(() => {
        const found: string[] = [];
        for (const el of Array.from(document.querySelectorAll<HTMLElement>('main *'))) {
          const own = Array.from(el.childNodes)
            .filter((node) => node.nodeType === Node.TEXT_NODE)
            .map((node) => node.textContent?.trim() ?? '')
            .join(' ')
            .trim();
          if (own === '') continue;
          const style = getComputedStyle(el);
          const box = el.getBoundingClientRect();
          // Hidden, or the one-pixel box words for a screen reader live in.
          if (style.visibility === 'hidden' || box.width <= 2 || box.height <= 2) continue;
          const clipsAcross =
            /hidden|clip/.test(style.overflowX) || style.textOverflow === 'ellipsis';
          const clipsBelow = /hidden|clip/.test(style.overflowY);
          if (clipsAcross && el.scrollWidth > el.clientWidth + 1) found.push(`cut across: ${own}`);
          if (clipsBelow && el.scrollHeight > el.clientHeight + 1) found.push(`cut below: ${own}`);
          // Inside a strip that scrolls sideways — the trail — words out of view are scrolled to,
          // not cut: the strip itself must be on the screen.
          let scroller: HTMLElement | null = el.parentElement;
          while (scroller && !/auto|scroll/.test(getComputedStyle(scroller).overflowX)) {
            scroller = scroller.parentElement;
          }
          const edges = (scroller ?? el).getBoundingClientRect();
          if (edges.right > innerWidth + 1 || edges.left < -1) found.push(`off the screen: ${own}`);
        }
        return found;
      });
      const heading = await page.locator('#conversation-question').textContent();
      expect(cut, `at "${heading}"`).toEqual([]);
    }

    /**
     * Right to left: each card reads from its right — its key first, then its words, which start
     * at the right of the space they have.
     */
    async function mirrored(page: Page) {
      const wrong = await page.evaluate(() =>
        Array.from(document.querySelectorAll<HTMLElement>('[data-answer]')).flatMap((card) => {
          const words = card.querySelector('strong');
          const space = card.querySelector('.conversation__card-text') ?? words?.parentElement;
          if (!words || !space) return [];
          const range = document.createRange();
          range.selectNodeContents(words);
          const text = range.getBoundingClientRect();
          const room = space.getBoundingClientRect();
          const key = card.querySelector('.conversation__key')?.getBoundingClientRect();
          const fromRight = room.right - text.right <= text.left - room.left + 1;
          const keyFirst = !key || key.left >= text.right - 1;
          return getComputedStyle(card).direction === 'rtl' && fromRight && keyFirst
            ? []
            : [words.textContent];
        }),
      );
      expect(wrong).toEqual([]);
    }

    /**
     * The chain, by keys, checked at every question: the purpose, the guess, the name, the brand
     * and the logo, a question with buttons — its inline editing open — and one for comments.
     */
    async function wholeFlow(
      page: Page,
      words: { name: string; ask: string; more: string },
      check?: (page: Page) => Promise<void>,
    ) {
      // The question's own heading: a preview of the form has the form's.
      const heading = page.locator('#conversation-question');
      const at = async (checked = true) => {
        // At rest: the next question slides in, and is measured once it has arrived.
        await page.waitForFunction(() =>
          document
            .getAnimations()
            .every(
              (animation) =>
                animation.playState !== 'running' ||
                animation.effect?.getTiming().iterations === Infinity,
            ),
        );
        await answersFit(page);
        await nothingCut(page);
        if (check && checked) await check(page);
      };
      const step = async (key: string, checked = true) => {
        await at(checked);
        const before = await heading.textContent();
        await page.keyboard.press(key);
        await expect(heading).not.toHaveText(before ?? '');
      };
      const type = async (text: string) => {
        await at(false);
        const before = await heading.textContent();
        await page.keyboard.type(text);
        await page.keyboard.press('Enter');
        await expect(heading).not.toHaveText(before ?? '');
      };
      await step('1'); // what it is for
      await step('3'); // the guess, not sure
      await step('3');
      await type(words.name);
      await step('1'); // the organisation's look
      await step('1'); // the logo's place
      await step('Enter', false); // the masthead previewed: Continue
      await type(words.ask);
      await step('1'); // needed
      await step('1'); // buttons
      await step('1'); // one answer
      await at(false); // how many: a number, no cards
      await page.keyboard.press('Tab');
      await page.keyboard.type('4');
      await page.keyboard.press('Enter');
      await step('1'); // the shape
      // The inline editing panel, the densest thing in the flow, open at "Where should they sit?":
      // nothing in it cut, though it pushes the answers down. Then the placement, by Tab and Enter,
      // as focus may be in the panel's box for the question's words.
      await page.keyboard.press('e');
      await expect(page.locator('.inline-edit')).toBeVisible();
      await nothingCut(page);
      if (check) await check(page);
      const placing = await heading.textContent();
      await tabTo(page, page.locator('[data-answer="0"]'));
      await page.keyboard.press('Enter');
      await expect(heading).not.toHaveText(placing ?? '');
      await step('Enter', false); // the preview: Continue
      await step('1'); // another question
      await type(words.more);
      await step('2'); // optional
      await step('2'); // no buttons
      await step('2'); // a few sentences
      await step('2'); // that's everything
      await at();
    }

    test('in German, the longest of the twelve', async ({ page }) => {
      await signInAs(page, sql, 'admin@example.com', 'de-DE');
      await page.goto('/forms');
      await page.getByRole('button', { name: 'Neues Formular' }).first().click();
      await page.getByRole('button', { name: /Mit Fragen beginnen/ }).click();
      await expect(page).toHaveURL(GUIDED);
      created.push(GUIDED.exec(page.url())![1]!);
      await wholeFlow(page, {
        name: 'Sommerfest des Fördervereins',
        ask: 'Welcher Tag passt Ihnen am besten?',
        more: 'Anmerkungen und Wünsche',
      });
    });

    /**
     * The next question arrives from where the page reads on: frozen at its first frame, it sits
     * to the right of its place on an English page, and to the left on a mirrored one.
     */
    test('the next question arrives from where the page reads on', async ({ browser }) => {
      const arrivesFrom = async (mirror: boolean) => {
        const page = await browser.newPage({ viewport: { width: 360, height: 640 } });
        if (mirror) {
          await page.addInitScript(() => {
            document.addEventListener('DOMContentLoaded', () =>
              document.documentElement.setAttribute('dir', 'rtl'),
            );
          });
        }
        await signInAs(page, sql, 'admin@example.com', 'en-GB');
        await startFromQuestions(page);
        const x = await page.evaluate(async () => {
          document.querySelector<HTMLElement>('[data-answer="0"]')!.click();
          await new Promise((done) => requestAnimationFrame(done));
          const node = document.querySelector('.conversation__node--on');
          const arriving = node?.getAnimations()[0];
          if (!node || !arriving) return null;
          arriving.pause();
          arriving.currentTime = 0;
          const offset = new DOMMatrix(getComputedStyle(node).transform).m41;
          arriving.finish();
          return offset;
        });
        await page.close();
        return x;
      };
      expect(await arrivesFrom(false)).toBeGreaterThan(0);
      expect(await arrivesFrom(true)).toBeLessThan(0);
    });

    test('mirrored, right to left', async ({ page }) => {
      // Once the page's own markup is parsed, so its `<html>` is the one mirrored.
      await page.addInitScript(() => {
        document.addEventListener('DOMContentLoaded', () =>
          document.documentElement.setAttribute('dir', 'rtl'),
        );
      });
      await signInAs(page, sql, 'admin@example.com', 'en-GB');
      await startFromQuestions(page);
      expect(await page.evaluate(() => getComputedStyle(document.body).direction)).toBe('rtl');
      await wholeFlow(
        page,
        { name: 'Summer party', ask: 'Which day suits you?', more: 'Comments' },
        mirrored,
      );
    });
  });

  /**
   * Owner question 8. "Which colours should your form use?" can take effect only through the brand
   * kit, which is the whole organisation's: an administrator is asked before it changes, and
   * nobody else is asked at all. The colours are asked only when there is no kit, and the demo
   * organisation has one, so these take it away and put it back.
   */
  test.describe("the colours are the organisation's (owner question 8)", () => {
    type Kit = {
      organisation_id: string;
      tokens: Parameters<typeof sql.json>[0];
      updated_by: string | null;
    };
    let kits: Kit[] = [];
    test.beforeAll(async () => {
      kits = await sql<Kit[]>`select organisation_id, tokens, updated_by from brand_kits`;
    });
    test.beforeEach(async () => {
      await sql`delete from brand_kits`;
    });
    test.afterAll(async () => {
      await sql`delete from brand_kits`;
      for (const kit of kits) {
        await sql`insert into brand_kits (organisation_id, tokens, updated_by)
          values (${kit.organisation_id}, ${sql.json(kit.tokens)}, ${kit.updated_by})`;
      }
    });

    const theKit = async () =>
      (await sql`select tokens from brand_kits`).map((row) => row['tokens']);
    const notice = (page: Page) => page.locator('.conversation__notice');

    test('an administrator is asked first, Cancel changes nothing, and Enter makes the first kit', async ({
      page,
    }) => {
      await signInAs(page, sql, 'admin@example.com', 'en-GB');
      await startFromQuestions(page);
      await page.keyboard.press('1');
      await pastTheGuessByKeys(page);
      await question(page, 'Should this look like your organisation?');
      await page.keyboard.press('1');
      await question(page, 'Which colours should your form use?');
      await answersFit(page);

      // Garden, by its digit: asked about, and nothing changed yet.
      await page.keyboard.press('2');
      await expect(
        notice(page).getByText(
          "Use these colours for all your organisation's forms? (changes your brand kit)",
        ),
      ).toBeVisible();
      const use = notice(page).getByRole('button', { name: 'Use these colours' });
      await expect(use).toBeFocused();
      await expect(use).toBeInViewport();
      await notice(page).getByRole('button', { name: 'Cancel' }).click();
      await expect(notice(page)).toHaveCount(0);
      await question(page, 'Which colours should your form use?');
      expect(await theKit()).toEqual([]);

      // Again, and Escape: cancelled, still asking, the kit untouched.
      await page.keyboard.press('2');
      await expect(use).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(notice(page)).toHaveCount(0);
      await question(page, 'Which colours should your form use?');
      expect(await theKit()).toEqual([]);

      // Again, and Enter: the organisation's first kit, in Garden's colours, and on to the logo.
      await page.keyboard.press('2');
      await expect(use).toBeFocused();
      await page.keyboard.press('Enter');
      await question(page, 'Where should your logo go?');
      await expect(
        page.getByText("Done. Your organisation's forms now use these colours."),
      ).toBeVisible();
      const [kit] = (await theKit()) as { colour: { primary: string }; radius: string }[];
      expect(kit).toMatchObject({ colour: { primary: '#2f6b4f' }, radius: '14px' });
    });

    test('anyone else is never asked, and the trail says why', async ({ page }) => {
      await signInAs(page, sql, 'operator@example.com', 'en-GB');
      await startFromQuestions(page);
      await page.keyboard.press('1');
      await pastTheGuessByKeys(page);
      await question(page, 'Should this look like your organisation?');
      await page.keyboard.press('1');
      await question(page, 'Where should your logo go?');
      await expect(
        page.locator('.conversation__skipped', {
          hasText: "Your organisation's colours are set by an administrator.",
        }),
      ).toBeVisible();
      expect(await theKit()).toEqual([]);
    });
  });
});

/** Past the guess by keyboard: its third answer, "Not sure", twice; then the form's name. */
async function pastTheGuessByKeys(page: Page) {
  for (const ask of ['Is it for something on a set date?', 'Will people learn something there?']) {
    await question(page, ask);
    await page.keyboard.press('3');
  }
  await nameTheFormByKeys(page);
}

/** "What is your form called?" by keyboard: focus is in the box, the name typed, Enter. */
async function nameTheFormByKeys(page: Page) {
  await question(page, 'What is your form called?');
  await expect(page.getByRole('textbox', { name: 'What is your form called?' })).toBeFocused();
  await page.keyboard.type('Summer party');
  await page.keyboard.press('Enter');
}

/** S6 — to "Do you want buttons?" about a new question, "Which day suits you?". */
async function toButtons(page: Page) {
  await page.getByRole('button', { name: /Signing people up/ }).click();
  await notSureTwice(page);
  await page.getByRole('button', { name: /Decide later/ }).click();
  await page.getByRole('button', { name: 'Which day suits you?' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: /Yes, it's needed/ }).click();
  await question(page, 'Do you want buttons?');
}

const type = async (page: Page, text: string) => {
  const box = page.getByPlaceholder(/Or type it/);
  await box.fill(text);
  await box.press('Enter');
};

const trailOf = (page: Page) => page.getByRole('navigation', { name: 'Your answers so far' });

test('one sentence answers several questions, each undone on its own (S6, T5)', async ({
  page,
}) => {
  await signInAs(page, sql, 'admin@example.com', 'en-GB');
  const formId = await startFromQuestions(page);
  await toButtons(page);

  // The demo sentence: buttons, how many, what shape and where — "one answer or several?" was not
  // said, so that is where the conversation is.
  await type(page, 'three buttons, pill shape, side by side');
  await question(page, 'One answer or several?');
  await expect(page.getByText('read that as “Yes · 3 · Pill · Side by side”')).toBeVisible();
  await expect(trailOf(page)).toContainText('Side by side');
  await page.screenshot({ path: 'test-results/s6-several.png', fullPage: true });

  // Back undoes one answer — the last — and the conversation is still where it was.
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await question(page, 'One answer or several?');
  await expect(trailOf(page)).not.toContainText('Side by side');
  await expect(trailOf(page)).toContainText('Pill');

  // How many and what shape were said: not asked again. Where they sit was taken back: asked.
  await page.getByRole('button', { name: /Several answers allowed/ }).click();
  await question(page, 'Where should they sit?');
  await page.getByRole('button', { name: /Side by side/ }).click();
  await expect(page.locator('.conversation__preview')).toBeVisible();

  await expect
    .poll(async () => (await draftOf(formId)).fields[1])
    .toMatchObject({
      type: 'multi_select',
      appearance: 'buttons',
      style: { shape: 'pill', columns: 'auto' },
      options: [{}, {}, {}],
    });
});

test('a pasted list is the options, and a guess waits to be confirmed (S6, T6 and T7)', async ({
  page,
}) => {
  await signInAs(page, sql, 'admin@example.com', 'en-GB');
  const formId = await startFromQuestions(page);
  await toButtons(page);
  await page.getByRole('button', { name: 'Yes', exact: true }).click();
  await question(page, 'One answer or several?');

  // About the shape, not about how many answers: asked before anything happens.
  await type(page, 'pills');
  await expect(page.getByText('Did you mean “What shape?” — Pill?')).toBeVisible();
  await page.screenshot({ path: 'test-results/s6-guess.png', fullPage: true });
  await page
    .locator('.conversation__notice')
    .getByRole('button', { name: 'Yes', exact: true })
    .click();
  await question(page, 'One answer or several?');
  await expect(page.getByText('read that as “Pill”')).toBeVisible();
  // Answered ahead of its turn, the shape shows at once.
  await expect(page.locator('.conversation__preview')).toBeVisible();
  await page.getByRole('button', { name: /One answer only/ }).click();

  // A numbered list, pasted: its lines are the options, the markers are not their labels.
  await question(page, 'How many options?');
  await type(page, '1. Red\n2. Green\n3. Blue');
  // The shape was answered already: on to where they sit, and then the preview, with the list.
  await question(page, 'Where should they sit?');
  await page.getByRole('button', { name: /Side by side/ }).click();
  await expect(page.locator('.conversation__preview')).toContainText('Green');

  await expect.poll(async () => (await draftOf(formId)).fields[1]?.options?.length).toBe(3);
  const { fields } = await draftOf(formId);
  expect(fields[1]).toMatchObject({ style: { shape: 'pill' } });
  expect(JSON.stringify(fields[1]!.options)).toContain('"Red"');
});

test('a phrase it did not understand can be taught — with consent — and removed (S6, T8)', async ({
  page,
}) => {
  await sql`delete from builder_aliases where phrase = 'blobby'`;
  await signInAs(page, sql, 'admin@example.com', 'en-GB');
  await startFromQuestions(page);
  await toButtons(page);
  await page.getByRole('button', { name: 'Yes', exact: true }).click();
  await page.getByRole('button', { name: /One answer only/ }).click();
  await type(page, '3');
  await question(page, 'What shape?');

  // Two misses in a row: no third open question — every question of the group, to pick from.
  await type(page, 'qwrtz');
  await expect(page.getByText('I did not understand that.')).toBeVisible();
  await type(page, 'blobby');
  await expect(page.getByText(/Everything you can set here is listed below/)).toBeVisible();
  await expect(page.locator('#conversation-way-out')).toBeVisible();

  // Picked from the menu; then — and only then — the offer to remember the words.
  await page
    .locator('.conversation__notice')
    .getByRole('button', { name: 'Pill', exact: true })
    .click();
  await question(page, 'Where should they sit?');
  await expect(page.getByText('Remember “blobby” as a way to say “Pill”?')).toBeVisible();
  await page.screenshot({ path: 'test-results/s6-remember.png', fullPage: true });
  await page.getByRole('button', { name: 'Remember', exact: true }).click();
  await expect(page.getByText('Remembered. “blobby” now means “Pill”.')).toBeVisible();

  // Now it is read, exactly, like any other way of saying it.
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await question(page, 'What shape?');
  await type(page, 'blobby');
  await question(page, 'Where should they sit?');
  await expect(page.getByText('read that as “Pill”')).toBeVisible();

  // An administrator sees it, and removes it — after saying yes.
  await page.goto('/forms/phrases');
  await expect(page.getByRole('heading', { name: 'Learned phrases' })).toBeVisible();
  await expect(page.locator('.phrases__row')).toContainText('“What shape?”: Pill');
  await page.screenshot({ path: 'test-results/s6-phrases.png', fullPage: true });
  await page.getByRole('button', { name: 'Delete “blobby”' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Yes, continue' }).click();
  await expect(page.getByText(/Nothing learned yet/)).toBeVisible();
  const [row] = await sql`select count(*)::int as n from builder_aliases where phrase = 'blobby'`;
  expect(row!['n']).toBe(0);
});

/**
 * S11 — the guess (`docs/plan/BELIEF.md`). Somebody collecting proxies for an association's
 * meeting, answering whatever the engine asks in the order it asks: it guesses the proxy form,
 * says why, and "Right" adds the template's questions, shown whole before the brand.
 */
const AS_A_PROXY: Record<string, RegExp> = {
  'Will you answer each person yourself?': /^\s*\d?\s*No$/,
  'Must people sign it?': /^\s*\d?\s*Yes$/,
  "Does someone act on another person's behalf?": /^\s*\d?\s*Yes$/,
  'Is it for something on a set date?': /^\s*\d?\s*Yes$/,
  "Is it for an association's meeting?": /^\s*\d?\s*Yes$/,
};

async function toTheGuess(page: Page) {
  await page.getByRole('button', { name: /Collecting information/ }).click();
  const heading = page.getByRole('heading', { level: 1 });
  for (let asked = 0; asked < 6; asked += 1) {
    await expect(heading).not.toHaveText('What is this form for?');
    const text = (await heading.textContent())?.trim() ?? '';
    if (text.startsWith('This looks like')) return;
    const answer = AS_A_PROXY[text];
    expect(answer, `asked "${text}"`).toBeDefined();
    await page.getByRole('button', { name: answer! }).click();
    await expect(heading).not.toHaveText(text);
  }
}

test('the guess: a proxy form, why, and "Right" adds its questions (S11)', async ({ page }) => {
  await signInAs(page, sql, 'admin@example.com', 'en-GB');
  const formId = await startFromQuestions(page);
  await toTheGuess(page);
  await question(page, 'This looks like Proxy form. Right?');

  // The reasoning is one press away.
  await page.getByText('Why this guess?').click();
  await expect(
    page
      .locator('.conversation__why')
      .getByText("Does someone act on another person's behalf? Yes"),
  ).toBeVisible();

  await page.getByRole('button', { name: /Right/ }).click();
  await question(page, "Here's how it looks.");
  await expect(page.locator('.conversation__preview')).toContainText('Which meeting');

  // Every question it added can be changed in place.
  await page.getByRole('button', { name: /Not completely happy with the preview/ }).click();
  await page.getByRole('button', { name: 'Which meeting' }).click();
  await expect(page.getByRole('group', { name: 'Change it here' })).toBeVisible();

  await page.getByRole('button', { name: 'Continue' }).click();
  // The form's name, then the brand: only the gaps are left, as the form has its questions.
  await nameTheForm(page);
  await question(page, 'Should this look like your organisation?');
  await page.getByRole('button', { name: /Decide later/ }).click();
  await question(page, 'Add another question?');

  const { fields } = await draftOf(formId);
  const keys = fields.map((f) => (f as unknown as { key: string }).key);
  // The template's questions, in its order: its own name questions, not the conversation's starter.
  expect(keys[0]).toBe('authorisation_wording');
  expect(keys).toContain('meeting');
  expect(keys).not.toContain('name');
  expect(new Set(keys).size).toBe(keys.length);
});

test('the guess: "Right" without the catalogue says why, and changes nothing (S11)', async ({
  page,
}) => {
  // The catalogue does not load: the guess still guesses, but has nothing to add from.
  await page.route('**/v1/form-templates', (route) => route.abort());
  await signInAs(page, sql, 'admin@example.com', 'en-GB');
  const formId = await startFromQuestions(page);
  await toTheGuess(page);
  await question(page, 'This looks like Proxy form. Right?');
  await page.getByRole('button', { name: /Right/ }).click();
  await expect(page.getByText(/^The template could not be loaded/)).toBeVisible();
  // No step was taken: still the guess, and the draft still only the conversation's starter.
  await question(page, 'This looks like Proxy form. Right?');
  await expect
    .poll(async () => (await draftOf(formId)).fields.map((f) => (f as { key?: string }).key))
    .toEqual(['name']);
});

test('the guess: "No" goes on without it, and Back takes it back (S11)', async ({ page }) => {
  await signInAs(page, sql, 'admin@example.com', 'en-GB');
  await startFromQuestions(page);
  await toTheGuess(page);
  await question(page, 'This looks like Proxy form. Right?');
  await page.getByRole('button', { name: /^\s*\d?\s*No$/ }).click();
  // What answers alike but for that one is already sure enough: it is asked about next (#119).
  await question(page, 'This looks like Power of attorney. Right?');
  await expect(page.getByRole('heading', { level: 1 })).not.toHaveText(/Proxy form/);
  await page.getByRole('button', { name: 'Back' }).click();
  await question(page, 'This looks like Proxy form. Right?');
});
