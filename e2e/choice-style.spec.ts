import { expect, test } from '@playwright/test';
import { forms as formSchemas } from '@tp/shared';
import { contrastRatio } from '@tp/tokens';
import { db, seededForm } from './support.js';

/**
 * An author's choice style, measured in a real browser on the published form.
 *
 * The unit tests prove the schema has no way under the floor and the stylesheet uses the derived
 * edge. What only a browser can show is that it all arrives: the classes on the fieldset, the
 * token variables on the page, and the numbers a respondent's phone actually renders — the tap
 * target, the shape, and the contrast of the edge that marks what they chose.
 */
const sql = db();
const slug = `e2e-choice-style-${Date.now().toString(36)}`;
let formId: string;

test.beforeAll(async () => {
  const { organisationId } = await seededForm(sql);
  const definition = formSchemas.FormDefinition.parse({
    schemaVersion: 1,
    fields: [
      {
        id: 'c1',
        key: 'meal',
        type: 'single_select',
        label: { 'sv-SE': 'Måltid', 'en-GB': 'Meal' },
        appearance: 'buttons',
        style: { shape: 'pill', size: 'large', accent: 'accent', columns: '2' },
        options: [
          { value: 'veg', label: { 'sv-SE': 'Vegetariskt', 'en-GB': 'Vegetarian' } },
          { value: 'fish', label: { 'sv-SE': 'Fisk', 'en-GB': 'Fish' } },
        ],
      },
    ],
  });

  const [form] = await sql`
    insert into forms (organisation_id, slug, title, status, draft_definition)
    values (${organisationId}, ${slug}, ${sql.json({ 'sv-SE': 'Stil', 'en-GB': 'Style' })},
            'published', ${sql.json(definition)})
    returning id
  `;
  formId = String(form!['id']);
  const [version] = await sql`
    insert into form_versions (form_id, version, definition, published_at)
    values (${formId}, 1, ${sql.json(definition)}, now())
    returning id
  `;
  await sql`
    update forms set published_version = 1, published_version_id = ${String(version!['id'])}
    where id = ${formId}
  `;
});

test.afterAll(async () => {
  await sql`update forms set published_version_id = null where id = ${formId}`;
  await sql`delete from form_versions where form_id = ${formId}`;
  await sql`delete from forms where id = ${formId}`;
  await sql.end();
});

/** `rgb(1, 2, 3)` → `#010203`, so the product's own contrast function can measure it. */
function hex(rgb: string): string {
  const [r, g, b] = (rgb.match(/\d+(\.\d+)?/g) ?? []).map(Number);
  return `#${[r, g, b]
    .map((n) =>
      Math.round(n ?? 0)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

test('a styled choice is large, pill-shaped, and marks the chosen answer at 3:1', async ({
  page,
}) => {
  await page.goto(`/f/${slug}`);
  await page.getByRole('button', { name: /^(Language|Språk):/ }).click();
  await page.getByRole('option', { name: 'English' }).click();
  const option = page.locator('.choice__option', { hasText: 'Vegetarian' });
  await expect(option).toBeVisible();

  // The fieldset carries what the author chose, and the respondent's target only grew.
  await expect(page.locator('fieldset.choice')).toHaveClass(/choice--shape-pill/);
  const box = (await option.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(56);
  expect(await option.evaluate((el) => getComputedStyle(el).borderTopLeftRadius)).toBe('999px');

  // Chosen: the edge is the derived accent, and it reads against the page it sits on.
  await option.click();
  await expect(page.getByRole('radio', { name: 'Vegetarian' })).toBeChecked();
  const {
    edge,
    token,
    page: ground,
  } = await option.evaluate((el) => {
    const root = getComputedStyle(document.documentElement);
    return {
      edge: getComputedStyle(el).borderTopColor,
      token: root.getPropertyValue('--tp-colour-accent-edge').trim(),
      page: getComputedStyle(document.body).backgroundColor,
    };
  });
  expect(token, 'the accent edge token reaches the page').not.toBe('');
  expect(hex(edge)).toBe(token.toLowerCase());
  expect(contrastRatio(hex(edge), hex(ground)) ?? 0).toBeGreaterThanOrEqual(3);
});
