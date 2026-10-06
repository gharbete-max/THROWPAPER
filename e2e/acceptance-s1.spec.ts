import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { db, deleteSubmission, signInAs } from './support.js';

/**
 * Acceptance S1 — `docs/plan/PREDICTIVE-BUILDER.md`, built in S13a (`docs/plan/POLISH.md`):
 *
 * > From an empty workspace, clicking only (no typing except the form's own labels), a user
 * > produces a published form with: a heading, a logo, a required name field, a single-choice
 * > question with 4 options rendered as pills in the brand colour, an optional comments paragraph
 * > field, and a consent checkbox.
 *
 * The heading is the form's name, its public page's `h1`; the logo is the brand kit's, chosen as a
 * file on the Brand kit screen (a click, no typing); the consent's words are the person's own,
 * typed as the question (rule 8). Once by pointer, and once by keyboard alone. The published form is
 * then filled in: the box must be ticked before it goes.
 */
const sql = db();
const forms: string[] = [];
const references: string[] = [];
const LOGO = readFileSync(resolve('apps/forms/public/icon-192.png'));
const CONSENT = 'I agree that Demo AB keeps my answers until the party is over.';

type Kit = {
  organisation_id: string;
  tokens: Parameters<typeof sql.json>[0];
  updated_by: string | null;
};
let kits: Kit[] = [];

/** The demo's kit as it was — no logo — so each journey starts where a new workspace does. */
async function restoreKits() {
  await sql`delete from brand_kits`;
  for (const kit of kits) {
    await sql`insert into brand_kits (organisation_id, tokens, updated_by)
      values (${kit.organisation_id}, ${sql.json(kit.tokens)}, ${kit.updated_by})`;
  }
}

test.beforeAll(async () => {
  kits = await sql<Kit[]>`select organisation_id, tokens, updated_by from brand_kits`;
});
test.beforeEach(restoreKits);

test.afterAll(async () => {
  for (const reference of references) await deleteSubmission(sql, reference);
  for (const id of forms) {
    await sql`delete from builder_sessions where form_id = ${id}`;
    await sql`update forms set published_version_id = null where id = ${id}`;
    await sql`delete from form_versions where form_id = ${id}`;
    await sql`delete from forms where id = ${id}`;
  }
  // The logo chosen here is this file's, not the demo's.
  await restoreKits();
  await sql.end();
});

test.use({ viewport: { width: 1280, height: 1000 } });

const question = (page: Page, text: string) =>
  expect(page.getByRole('heading', { level: 1, name: text })).toBeVisible();

type Drafted = {
  type: string;
  required?: boolean;
  appearance?: string;
  options?: unknown[];
  style?: { shape?: string; accent?: string };
  label?: Record<string, string>;
};
async function draftOf(
  formId: string,
): Promise<{ title: Record<string, string>; fields: Drafted[] }> {
  const [row] = await sql`select title, draft_definition from forms where id = ${formId}`;
  return {
    title: row!['title'] as Record<string, string>,
    fields: (row!['draft_definition'] as { fields: Drafted[] }).fields,
  };
}

/** What S1 asks for, in the draft: four questions, made as the answers said — once saved. */
async function expectTheDraft(formId: string) {
  // The autosave runs after the step: the last answer is on screen before it is in the database.
  await expect
    .poll(async () => {
      const { title, fields } = await draftOf(formId);
      return [Object.values(title), fields.map((f) => [f.type, f.required, f.appearance ?? null])];
    })
    .toEqual([
      ['Summer party'],
      [
        ['short_text', true, null],
        ['single_select', true, 'buttons'],
        ['long_text', false, null],
        ['yes_no', true, 'checkbox'],
      ],
    ]);
  const { fields } = await draftOf(formId);
  expect(fields[1]).toMatchObject({ style: { shape: 'pill', accent: 'primary' } });
  expect(fields[1]!.options).toHaveLength(4);
  expect(Object.values(fields[3]!.label!)).toContain(CONSENT);
}

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
      // FOLLOWING: the target comes after what has focus now.
      return at.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING ? 'after' : 'before';
    });
    if (where === 'here') return;
    await page.keyboard.press(where === 'after' ? 'Tab' : 'Shift+Tab');
  }
  throw new Error(`Tab never reached ${target.toString()}`);
}

/** The published form, as a visitor meets it: everything S1 names is there. */
async function expectThePublishedForm(visitor: Page) {
  await expect(visitor.getByRole('heading', { level: 1, name: 'Summer party' })).toBeVisible();
  // The brand kit's logo, beside the title where "Where should your logo go?" put it.
  const logo = visitor.locator('.masthead--header-left img.brand-mark');
  await expect(logo).toBeVisible();
  expect(await logo.evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);

  await expect(visitor.getByRole('textbox', { name: /^(Name|Namn) \*$/ })).toHaveAttribute(
    'required',
    '',
  );

  const choice = visitor.locator('fieldset.choice');
  await expect(choice).toHaveClass(/choice--buttons/);
  await expect(choice).toHaveClass(/choice--shape-pill/);
  await expect(choice).toHaveClass(/choice--accent-primary/);
  await expect(choice.getByRole('radio')).toHaveCount(4);

  const comments = visitor.getByRole('textbox', { name: 'Comments' });
  expect(await comments.evaluate((el) => el.tagName)).toBe('TEXTAREA');
  await expect(comments).not.toHaveAttribute('required', '');

  const box = visitor.getByRole('checkbox', { name: `${CONSENT} *` });
  await expect(box).toHaveAttribute('required', '');
  await expect(box).not.toBeChecked();
}

/** A chosen pill is edged in the brand's own colour, its primary, as the accent says. */
async function expectTheBrandColour(option: Locator) {
  const { edge, token } = await option.evaluate((el) => ({
    edge: getComputedStyle(el).borderTopColor,
    token: getComputedStyle(document.documentElement)
      .getPropertyValue('--tp-colour-primary-edge')
      .trim()
      .toLowerCase(),
  }));
  const [r, g, b] = (edge.match(/\d+/g) ?? []).map(Number);
  const hex = `#${[r, g, b].map((n) => (n ?? 0).toString(16).padStart(2, '0')).join('')}`;
  expect(token, 'the brand edge token reaches the page').not.toBe('');
  expect(hex).toBe(token);
}

/** Sent, its reference kept to clean up. */
async function sent(visitor: Page) {
  const said = visitor.getByText(/Your reference:|Din referens:/);
  await expect(said).toBeVisible();
  const reference = (await said.textContent())?.match(/[0-9A-Z]{4}-[0-9A-Z]{4}/)?.[0];
  if (!reference) throw new Error('no reference');
  references.push(reference);
}

const slugOf = async (formId: string) =>
  ((await sql`select slug from forms where id = ${formId}`)[0]!['slug'] as string) ?? '';

test('acceptance S1: a published form, by clicking alone', async ({ page, browser }) => {
  test.setTimeout(180_000);
  await signInAs(page, sql, 'admin@example.com', 'en-GB');

  // ── The logo: a file chosen on the Brand kit screen ───────────────────────────────────────
  await page.goto('/brand');
  await page.getByLabel(/Add an image|Replace the image/).setInputFiles({
    name: 'logo.png',
    mimeType: 'image/png',
    buffer: LOGO,
  });
  await expect(page.locator('.image-picker__preview img')).toBeVisible();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();

  // ── The conversation ──────────────────────────────────────────────────────────────────────
  await page.goto('/forms');
  await page.getByRole('button', { name: 'New form' }).first().click();
  await page.getByRole('button', { name: /Start from questions/ }).click();
  await expect(page).toHaveURL(/\/forms\/[0-9a-f-]{36}\/guided$/);
  const formId = page.url().split('/').at(-2)!;
  forms.push(formId);

  /** An answer card — not the trail's crumb for an earlier answer that says the same. */
  const pick = async (ask: string, answer: string | RegExp) => {
    await question(page, ask);
    await page
      .getByRole('button', { name: answer, ...(typeof answer === 'string' ? { exact: true } : {}) })
      .and(page.locator('[data-answer]'))
      .click();
  };
  const write = async (ask: string, words: string) => {
    await question(page, ask);
    await page.getByRole('textbox', { name: ask }).fill(words);
    await page.getByRole('button', { name: 'Continue' }).click();
  };

  await pick('What is this form for?', /Signing people up/);
  await pick('Is it for something on a set date?', 'Not sure');
  await pick('Will people learn something there?', 'Not sure');
  await write('What is your form called?', 'Summer party');
  await pick('Should this look like your organisation?', /Yes, use our colours and logo/);
  await pick('Where should your logo go?', /Top left, beside the title/);
  // The masthead as it will be: the logo, beside the form's own name.
  await expect(page.locator('.conversation__preview')).toContainText('Summer party');
  await page.getByRole('button', { name: 'Continue' }).click();

  // A question with four pills.
  await question(page, 'What do you want to ask?');
  await page.getByRole('button', { name: 'Which day suits you?' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await pick('Must everyone answer this?', /Yes, it's needed/);
  await pick('Do you want buttons?', 'Yes');
  await pick('One answer or several?', /One answer only/);
  await question(page, 'How many options?');
  await page.getByRole('button', { name: 'More' }).click();
  await expect(page.locator('.conversation__number')).toHaveText('4');
  await page.getByRole('button', { name: 'Continue' }).click();
  await pick('What shape?', 'Pill');
  await pick('Where should they sit?', /Under the question, full width/);
  await page.getByRole('button', { name: 'Continue' }).click();

  // Comments: a few sentences, optional.
  await pick('Add another question?', /Yes, ask something else/);
  await write('What do you want to ask?', 'Comments');
  await pick('Must everyone answer this?', /No, it's optional/);
  await pick('Do you want buttons?', /No buttons/);
  await pick('How should people answer?', /A few sentences/);

  // The consent: the person's own words, a box to tick, needed.
  await pick('Add another question?', /Yes, ask something else/);
  await write('What do you want to ask?', CONSENT);
  await pick('Must everyone answer this?', /Yes, it's needed/);
  await pick('Do you want buttons?', /No buttons/);
  await pick('How should people answer?', /A box to tick/);
  await pick('Add another question?', /No, that's everything/);

  await question(page, 'Your form is ready.');
  await expectTheDraft(formId);

  // ── Published, with its confirmation ──────────────────────────────────────────────────────
  await page.getByRole('button', { name: /Open it in the editor/ }).click();
  await expect(page).toHaveURL(new RegExp(`/forms/${formId}$`));
  await page.getByRole('button', { name: 'Publish' }).first().click();
  const anyway = page.getByRole('dialog').getByRole('button', { name: 'Publish', exact: true });
  const published = page.getByText(/Version 1/).first();
  await expect(anyway.or(published).first()).toBeVisible({ timeout: 15_000 });
  if (await anyway.isVisible()) await anyway.click();
  await expect(published).toBeVisible({ timeout: 15_000 });

  // ── As a visitor meets it ─────────────────────────────────────────────────────────────────
  const visitor = await browser.newPage();
  await visitor.goto(`/f/${await slugOf(formId)}`);
  await expectThePublishedForm(visitor);
  await visitor.getByRole('textbox', { name: /^(Name|Namn) \*$/ }).fill('Åsa Öberg');
  const second = visitor.locator('.choice__option').nth(1);
  await second.click();
  await expectTheBrandColour(second);
  await visitor.getByRole('textbox', { name: 'Comments' }).fill('See you there.');

  // Not ticked, it does not go: the box is what is missing.
  const box = visitor.getByRole('checkbox', { name: `${CONSENT} *` });
  await visitor.getByRole('button', { name: /Complete|Skicka/ }).click();
  expect(await box.evaluate((el) => (el as HTMLInputElement).validity.valueMissing)).toBe(true);
  await expect(visitor.getByText(/Your reference:|Din referens:/)).toHaveCount(0);
  await box.check();
  await visitor.getByRole('button', { name: /Complete|Skicka/ }).click();
  await sent(visitor);
  await visitor.close();
});

test('acceptance S1 by keyboard alone', async ({ page, browser }) => {
  test.setTimeout(180_000);
  await signInAs(page, sql, 'admin@example.com', 'en-GB');

  // ── The logo: the file input reached by Tab, its chooser opened by Space ──────────────────
  await page.goto('/brand');
  const picker = page.getByLabel(/Add an image|Replace the image/);
  await tabTo(page, picker);
  const choosing = page.waitForEvent('filechooser');
  await page.keyboard.press('Space');
  await (await choosing).setFiles({ name: 'logo.png', mimeType: 'image/png', buffer: LOGO });
  await expect(page.locator('.image-picker__preview img')).toBeVisible();
  const save = page.getByRole('button', { name: 'Save', exact: true });
  await tabTo(page, save);
  await page.keyboard.press('Enter');
  await expect(save).toBeDisabled();

  // ── New form, by Tab and Enter ────────────────────────────────────────────────────────────
  await page.goto('/forms');
  await tabTo(page, page.getByRole('button', { name: 'New form' }).first());
  await page.keyboard.press('Enter');
  await tabTo(page, page.getByRole('button', { name: /Start from questions/ }));
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/forms\/[0-9a-f-]{36}\/guided$/);
  const formId = page.url().split('/').at(-2)!;
  forms.push(formId);

  /** A card by its digit. */
  const key = async (ask: string, digit: string) => {
    await question(page, ask);
    await page.keyboard.press(digit);
  };
  /** A text answer: focus is in the box already, Enter answers. */
  const type = async (ask: string, words: string) => {
    await question(page, ask);
    await expect(page.getByRole('textbox', { name: ask })).toBeFocused();
    await page.keyboard.type(words);
    await page.keyboard.press('Enter');
  };
  /** A preview moment: Continue has focus. */
  const onward = async () => {
    await expect(page.getByRole('button', { name: 'Continue' })).toBeFocused();
    await page.keyboard.press('Enter');
  };

  await key('What is this form for?', '1');
  await key('Is it for something on a set date?', '3');
  await key('Will people learn something there?', '3');
  await type('What is your form called?', 'Summer party');
  await key('Should this look like your organisation?', '1');
  await key('Where should your logo go?', '1');
  await onward();

  await type('What do you want to ask?', 'Which day suits you?');
  await key('Must everyone answer this?', '1');
  await key('Do you want buttons?', '1');
  await key('One answer or several?', '1');
  await question(page, 'How many options?');
  // Focus is on Continue; the number is typed in the box after it.
  await expect(page.getByRole('button', { name: 'Continue' })).toBeFocused();
  await page.keyboard.press('Tab');
  await page.keyboard.type('4');
  await page.keyboard.press('Enter');
  await key('What shape?', '1');
  await key('Where should they sit?', '1');
  await onward();

  await key('Add another question?', '1');
  await type('What do you want to ask?', 'Comments');
  await key('Must everyone answer this?', '2');
  await key('Do you want buttons?', '2');
  await key('How should people answer?', '2');

  await key('Add another question?', '1');
  await type('What do you want to ask?', CONSENT);
  await key('Must everyone answer this?', '1');
  await key('Do you want buttons?', '2');
  await key('How should people answer?', '3');
  await key('Add another question?', '2');

  await question(page, 'Your form is ready.');
  await expectTheDraft(formId);
  await page.keyboard.press('1');
  await expect(page).toHaveURL(new RegExp(`/forms/${formId}$`));

  // ── Published: Tab to Publish, Enter, and Enter on the confirmation if it asks ────────────
  await tabTo(page, page.getByRole('button', { name: 'Publish' }).first());
  await page.keyboard.press('Enter');
  const anyway = page.getByRole('dialog').getByRole('button', { name: 'Publish', exact: true });
  const published = page.getByText(/Version 1/).first();
  await expect(anyway.or(published).first()).toBeVisible({ timeout: 15_000 });
  if (await anyway.isVisible()) {
    await tabTo(page, anyway);
    await page.keyboard.press('Enter');
  }
  await expect(published).toBeVisible({ timeout: 15_000 });

  // ── Filled in by keyboard ─────────────────────────────────────────────────────────────────
  const visitor = await browser.newPage();
  await visitor.goto(`/f/${await slugOf(formId)}`);
  await expectThePublishedForm(visitor);
  await tabTo(visitor, visitor.getByRole('textbox', { name: /^(Name|Namn) \*$/ }));
  await visitor.keyboard.type('Åsa Öberg');
  // Into the pills: the first is focused; an arrow chooses the next, as radios do.
  await visitor.keyboard.press('Tab');
  await visitor.keyboard.press('ArrowDown');
  await expect(visitor.getByRole('radio').nth(1)).toBeChecked();
  await expectTheBrandColour(visitor.locator('.choice__option').nth(1));
  await tabTo(visitor, visitor.getByRole('textbox', { name: 'Comments' }));
  await visitor.keyboard.type('See you there.');

  const box = visitor.getByRole('checkbox', { name: `${CONSENT} *` });
  const send = visitor.getByRole('button', { name: /Complete|Skicka/ });
  await tabTo(visitor, send);
  await visitor.keyboard.press('Enter');
  expect(await box.evaluate((el) => (el as HTMLInputElement).validity.valueMissing)).toBe(true);
  await expect(visitor.getByText(/Your reference:|Din referens:/)).toHaveCount(0);
  await tabTo(visitor, box);
  await visitor.keyboard.press('Space');
  await expect(box).toBeChecked();
  await tabTo(visitor, send);
  await visitor.keyboard.press('Enter');
  await sent(visitor);
  await visitor.close();
});
