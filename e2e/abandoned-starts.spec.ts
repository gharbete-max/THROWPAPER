import { expect, test } from '@playwright/test';
import { forms as formSchemas } from '@tp/shared';
import { db, signInAs } from './support.js';

/**
 * A start that is never answered leaves no draft behind (the guided builder waits for the first
 * answer to make the form), and the ones an earlier build left are offered for the bin, after a
 * question, once they are a day old.
 */
const sql = db();
const planted: string[] = [];

test.afterAll(async () => {
  for (const slug of planted) await sql`delete from forms where slug = ${slug}`;
  await sql`delete from forms where slug like 'form-e2eabandon%'`;
  await sql.end();
});

const countFor = async (email: string) => {
  const [row] = await sql`
    select count(*)::int as n from forms
    where owner_user_id = (select id from users where email = ${email} limit 1)`;
  return Number(row!['n']);
};

test('opening "Start from questions" and walking away makes no form; the first answer makes one @smoke', async ({
  page,
}) => {
  await signInAs(page, sql, 'admin@example.com', 'en-GB');
  const before = await countFor('admin@example.com');

  await page.goto('/forms');
  await page.getByRole('button', { name: 'New form' }).first().click();
  await page.getByRole('button', { name: /Start from questions/ }).click();
  await expect(page).toHaveURL(/\/forms\/[0-9a-f-]{36}\/guided$/);
  const formId = page.url().split('/').at(-2)!;
  await expect(page.getByRole('heading', { name: 'What is this form for?' })).toBeVisible();
  // Give an autosave every chance to have happened, then leave.
  await page.waitForTimeout(1500);
  expect(await countFor('admin@example.com')).toBe(before);
  await page.goto('/forms');
  await expect(page.getByRole('heading', { name: 'Forms', level: 1 })).toBeVisible();
  expect(await countFor('admin@example.com')).toBe(before);

  // Reloading an unanswered start is still the blank beginning, not an error.
  await page.getByRole('button', { name: 'New form' }).first().click();
  await page.getByRole('button', { name: /Start from questions/ }).click();
  await expect(page.getByRole('heading', { name: 'What is this form for?' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'What is this form for?' })).toBeVisible();
  expect(await countFor('admin@example.com')).toBe(before);
  expect(formId).toMatch(/^[0-9a-f-]{36}$/);

  // The first answer makes the form, at the address the page already had.
  await page.goto('/forms');
  await page.getByRole('button', { name: 'New form' }).first().click();
  await page.getByRole('button', { name: /Start from questions/ }).click();
  await expect(page).toHaveURL(/\/forms\/[0-9a-f-]{36}\/guided$/);
  const answered = page.url().split('/').at(-2)!;
  await page.getByRole('button', { name: 'Signing people up' }).click();
  await expect.poll(() => countFor('admin@example.com')).toBe(before + 1);
  const [row] = await sql`select id from forms where id = ${answered}`;
  expect(row).toBeTruthy();
  planted.push(
    ...(await sql`select slug from forms where id = ${answered}`).map((r) => String(r['slug'])),
  );
});

test('offers the empty drafts that are over a day old for the bin, and asks first', async ({
  page,
}) => {
  await signInAs(page, sql, 'admin@example.com', 'en-GB');
  const [admin] =
    await sql`select id, organisation_id from users where email = 'admin@example.com' limit 1`;
  const empty = formSchemas.emptyDefinition;
  // Others may be there already (earlier runs, other specs): the count goes up by exactly one.
  await page.goto('/forms');
  const notice = page.getByRole('status').filter({ hasText: 'never answered' });
  const leftovers = await sql`
    select count(*)::int as n from forms
    where owner_user_id = ${String(admin!['id'])} and deleted_at is null and slug ~ '^form-[0-9a-z]+$'
      and status = 'draft' and published_version is null and event_id is null
      and updated_at < now() - interval '1 day' and draft_definition = ${sql.json(empty as never)}`;
  const others = Number(leftovers[0]!['n']);
  await sql`
    insert into forms (organisation_id, slug, title, status, draft_definition, owner_user_id, created_at, updated_at)
    values (${String(admin!['organisation_id'])}, 'form-e2eabandon1', ${sql.json({ 'en-GB': 'Untitled form' })}, 'draft',
            ${sql.json(empty as never)}, ${String(admin!['id'])}, now() - interval '3 days', now() - interval '3 days')`;
  await page.reload();
  await expect(notice).toContainText(`${others + 1} empty draft`);

  // Declining the question changes nothing.
  await notice.getByRole('button', { name: 'Move to bin' }).click();
  await page.getByRole('button', { name: 'Cancel' }).click();
  expect(
    (await sql`select deleted_at from forms where slug = 'form-e2eabandon1'`)[0]!['deleted_at'],
  ).toBeNull();

  await notice.getByRole('button', { name: 'Move to bin' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Move to bin' }).click();
  await expect(notice).toHaveCount(0);
  expect(
    (await sql`select deleted_at from forms where slug = 'form-e2eabandon1'`)[0]!['deleted_at'],
  ).not.toBeNull();
});
