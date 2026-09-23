import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { db, deleteSubmission, seededForm, signInAs, uniqueEmail } from './support.js';

/**
 * The door, in a real browser.
 *
 * The registration itself is created through the public API rather than by driving the form again
 * — public-form.spec.ts already proves that path, and repeating it here would only make this
 * slower and more brittle. What matters here is what happens at the check-in screen.
 */
const sql = db();
let eventId: string;
let formId: string;
const created: string[] = [];

test.beforeAll(async () => {
  const form = await seededForm(sql);
  formId = form.formId;
  if (!form.eventId) throw new Error('The seeded form is not attached to an event.');
  eventId = form.eventId;
});

test.afterAll(async () => {
  for (const reference of created) await deleteSubmission(sql, reference);
  await sql.end();
});

/**
 * A registration for the door to admit, written straight into the database.
 *
 * It used to go through the public submit endpoint, which is what public-form.spec.ts proves,
 * and which is rate-limited to ten a minute per address — a fair limit for a stranger and a hard
 * one for a test suite: the door specs and the public specs together were the eleventh visitor
 * in a minute, and the public spec then failed on a 429. The door does not care where the row
 * came from; only that it is there.
 */
async function register(): Promise<string> {
  const reference = `E2E${Date.now().toString(36).slice(-4).toUpperCase()}${Math.random()
    .toString(36)
    .slice(2, 6)
    .toUpperCase()}`;
  const [row] = await sql`
    insert into submissions
      (organisation_id, form_id, form_version_id, event_id, reference, status, locale, email, data, submitted_at)
    select organisation_id, form_id, form_version_id, event_id, ${reference}, 'complete', 'sv-SE',
      ${uniqueEmail('door')}, ${sql.json({ full_name: 'Göran Häggkvist', email: 'door@example.com', meal: 'standard' })}, now()
    from submissions where form_id = ${formId} limit 1
    returning reference
  `;
  if (!row) throw new Error('No seeded submission to copy — run pnpm db:seed first.');
  created.push(reference);
  return reference;
}

test('a reference admits once and reports already-arrived on the second attempt', async ({
  page,
}) => {
  const reference = await register();
  await signInAs(page, sql, 'operator@example.com');

  await page.goto(`/events/${eventId}/check-in`);
  await page.getByLabel(/Referens/).fill(reference);
  await page.getByRole('button', { name: 'Checka in' }).click();

  await expect(page.getByText('Välkommen')).toBeVisible();
  // Typed in, so the field takes focus back: the next reference can be typed straight away.
  await expect(page.getByLabel(/Referens/)).toBeFocused();

  // The whole point of the phase: a second scan is not an error.
  await page.getByLabel(/Referens/).fill(reference);
  await page.getByRole('button', { name: 'Checka in' }).click();

  await expect(page.getByText('Redan incheckad')).toBeVisible();
  await expect(page.getByText(/Anlände/)).toBeVisible();

  // And exactly one row exists, whatever the screen said.
  const rows = await sql`
    select 1 from check_ins c
    join submissions s on s.id = c.submission_id
    where s.reference = ${reference}
  `;
  expect(rows).toHaveLength(1);
});

test('a reference nobody holds is refused', async ({ page }) => {
  await signInAs(page, sql, 'operator@example.com');

  await page.goto(`/events/${eventId}/check-in`);
  await page.getByLabel(/Referens/).fill('ZZZZ-ZZZZ');
  await page.getByRole('button', { name: 'Checka in' }).click();

  await expect(page.getByText('Hittades inte')).toBeVisible();
  // The field is cleared for the next scan, so the verdict has to say what was refused: a typo
  // and the wrong queue look identical otherwise.
  await expect(page.locator('.verdict')).toContainText('ZZZZ-ZZZZ');
});

test('a revoked registration is refused at the door', async ({ page }) => {
  const reference = await register();
  await sql`update submissions set revoked_at = now() where reference = ${reference}`;

  await signInAs(page, sql, 'operator@example.com');
  await page.goto(`/events/${eventId}/check-in`);
  await page.getByLabel(/Referens/).fill(reference);
  await page.getByRole('button', { name: 'Checka in' }).click();

  await expect(page.getByText('Anmälan återkallad')).toBeVisible();
});

test('the attendance report counts arrivals and lists no-shows', async ({ page }) => {
  const arriving = await register();
  const notArriving = await register();

  await signInAs(page, sql, 'admin@example.com');

  await page.goto(`/events/${eventId}/check-in`);
  await page.getByLabel(/Referens/).fill(arriving);
  await page.getByRole('button', { name: 'Checka in' }).click();
  await expect(page.getByText('Välkommen')).toBeVisible();

  await page.goto(`/events/${eventId}/attendance`);

  // The seed ships 200 registrations, so assert on the row rather than the totals.
  await expect(page.getByRole('cell', { name: arriving })).toBeVisible();

  await page.getByRole('button', { name: 'Endast uteblivna' }).click();
  await expect(page.getByRole('cell', { name: notArriving })).toBeVisible();
  // The one who arrived is no longer a no-show.
  await expect(page.getByRole('cell', { name: arriving })).toHaveCount(0);
});

test('an operator can work the door but cannot revoke', async ({ page }) => {
  const reference = await register();
  await signInAs(page, sql, 'operator@example.com');

  await page.goto(`/events/${eventId}/attendance`);
  await expect(page.getByRole('cell', { name: reference })).toBeVisible();

  // Revoking is admin-only, so the control is not rendered for an operator at all.
  await expect(page.getByRole('button', { name: 'Arkivera' })).toHaveCount(0);
});

test('the door names the event it is working', async ({ page }) => {
  const [event] = await sql`select name from events where id = ${eventId}`;
  const name = String((event?.['name'] as Record<string, string>)['sv-SE']);
  expect(name).not.toBe('undefined');

  await signInAs(page, sql, 'operator@example.com');
  await page.goto(`/events/${eventId}/check-in`);

  // In the heading, so the first thing read is which queue this is.
  await expect(page.getByRole('heading', { level: 1 })).toContainText(name);
});

test('a wrong event id is not a door', async ({ page }) => {
  await signInAs(page, sql, 'operator@example.com');
  await page.goto(`/events/${randomUUID()}/check-in`);

  await expect(page.getByText('Det finns inget evenemang på den adressen.')).toBeVisible();
  // Nothing to scan into: a screen that can only ever say "not found" must not offer a field.
  await expect(page.getByLabel(/Referens/)).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Evenemang' })).toBeVisible();
});

test('the verdict panel keeps its height at phone width', async ({ page }) => {
  const reference = await register();
  await signInAs(page, sql, 'operator@example.com');
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`/events/${eventId}/check-in`);

  // The fixed height exists so the layout does not move at the moment of judgement. The idle
  // prompt is the one text long enough to wrap, and at 375 it once pushed the panel taller than
  // the verdict that replaced it — the exact jump the fixed height was meant to remove.
  const verdict = page.locator('.verdict');
  await expect(verdict).toContainText('Skanna ett kort');
  const idle = (await verdict.boundingBox())?.height;

  await page.getByLabel(/Referens/).fill(reference);
  await page.getByRole('button', { name: 'Checka in' }).click();
  await expect(verdict).toContainText('Välkommen');
  const admitted = (await verdict.boundingBox())?.height;

  // "Already checked in" carries one line more (when they arrived) and must fit the same panel.
  await page.getByLabel(/Referens/).fill(reference);
  await page.getByRole('button', { name: 'Checka in' }).click();
  await expect(verdict).toContainText('Redan incheckad');
  const already = (await verdict.boundingBox())?.height;

  expect(idle).toBeGreaterThan(0);
  expect(admitted).toBe(idle);
  expect(already).toBe(idle);
});

test('each undo is named after its arrival', async ({ page }) => {
  const reference = await register();
  await signInAs(page, sql, 'operator@example.com');
  await page.goto(`/events/${eventId}/check-in`);
  await page.getByLabel(/Referens/).fill(reference);
  await page.getByRole('button', { name: 'Checka in' }).click();
  await expect(page.getByText('Välkommen')).toBeVisible();

  // The accessible name carries the person, so five undo buttons are five different buttons.
  const undo = page.getByRole('button', { name: /Ångra.*Göran Häggkvist/ });
  await expect(undo).toBeVisible();
  // And the count is one sentence, not a number with a label a paragraph cannot carry.
  await expect(page.getByText(/^\d+ av \d+ incheckade$/)).toBeAttached();

  // And pressing it takes the arrival back — from a browser, with the headers a browser sends.
  await undo.click();
  await page.getByRole('dialog').getByRole('button', { name: 'Ångra' }).click();
  await expect(page.getByText('Incheckning ångrad')).toBeVisible();
  await expect(undo).toHaveCount(0);
  const rows = await sql`
    select 1 from check_ins c
    join submissions s on s.id = c.submission_id
    where s.reference = ${reference}
  `;
  expect(rows).toHaveLength(0);
});

/** WCAG contrast of an element's text against the nearest painted background, in the page. */
async function contrastOf(
  page: import('@playwright/test').Page,
  selector: string,
): Promise<number> {
  return page.evaluate((sel) => {
    const element = document.querySelector(sel) as HTMLElement;
    const parse = (value: string) =>
      value
        .match(/[\d.]+/g)!
        .slice(0, 3)
        .map(Number) as [number, number, number];
    const luminance = ([r, g, b]: [number, number, number]) => {
      const channel = (c: number) => {
        const v = c / 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    };
    let node: HTMLElement | null = element;
    let background = 'rgba(0, 0, 0, 0)';
    while (node && /rgba\(0, 0, 0, 0\)|transparent/.test(background)) {
      background = getComputedStyle(node).backgroundColor;
      node = node.parentElement;
    }
    const style = getComputedStyle(element);
    const opacity = Number(style.opacity);
    const fg = parse(style.color);
    const bg = parse(background);
    // Composite the text over its background at the element's opacity, as the eye does.
    const seen = fg.map((c, i) => c * opacity + bg[i]! * (1 - opacity)) as [number, number, number];
    const [l1, l2] = [luminance(seen), luminance(bg)].sort((a, b) => b - a) as [number, number];
    return (l1 + 0.05) / (l2 + 0.05);
  }, selector);
}

test("the door is set at arm's length, and reads at it", async ({ page }) => {
  const reference = await register();
  await signInAs(page, sql, 'operator@example.com');

  // Rows 1 and 5 at desktop width: the door's own sizes, not the form kit's.
  await page.goto(`/events/${eventId}/check-in`);
  const fontSize = (selector: string) =>
    page.locator(selector).evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize));
  expect(await fontSize('.checkin__input')).toBeCloseTo(31.25, 0);
  expect((await page.locator('.door__check').boundingBox())!.height).toBeGreaterThanOrEqual(55);

  await page.getByLabel(/Referens/).fill(reference);
  await page.getByRole('button', { name: 'Checka in' }).click();
  await expect(page.getByText('Välkommen')).toBeVisible();
  expect(await fontSize('.door__recent h2')).toBeCloseTo(14.31, 0);

  // Already checked in: the panel is warning-coloured and the meta line must still read.
  await page.getByLabel(/Referens/).fill(reference);
  await page.getByRole('button', { name: 'Checka in' }).click();
  await expect(page.getByText('Redan incheckad')).toBeVisible();
  expect(await contrastOf(page, '.verdict__meta')).toBeGreaterThanOrEqual(4.5);

  // Row 4 at phone width: the leave link on one line, the title on its own row beneath.
  await page.setViewportSize({ width: 375, height: 812 });
  await page.reload();
  await expect(page.locator('.verdict')).toContainText('Skanna ett kort');
  expect(await fontSize('.checkin__input')).toBeCloseTo(25, 0);
  const leave = page.getByRole('link', { name: /Lämna entrén/ });
  const box = (await leave.boundingBox())!;
  expect(box.height).toBeLessThanOrEqual(44);
  expect(await leave.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  const title = (await page.getByRole('heading', { level: 1 }).boundingBox())!;
  expect(title.y).toBeGreaterThanOrEqual(box.y + box.height);
});

test('an undo that fails says so, and the arrival stands', async ({ page }) => {
  const reference = await register();
  await signInAs(page, sql, 'operator@example.com');
  await page.goto(`/events/${eventId}/check-in`);
  await page.getByLabel(/Referens/).fill(reference);
  await page.getByRole('button', { name: 'Checka in' }).click();
  await expect(page.getByText('Välkommen')).toBeVisible();

  // The server is unreachable for exactly this request.
  await page.route(/\/check-ins\//, (route) =>
    route.request().method() === 'DELETE' ? route.fulfill({ status: 500 }) : route.continue(),
  );
  const undo = page.getByRole('button', { name: /Ångra.*Göran Häggkvist/ });
  await undo.click();
  await page.getByRole('dialog').getByRole('button', { name: 'Ångra' }).click();

  // Not silence: the verdict names the failure and the person, and the row is still there.
  await expect(page.locator('.verdict')).toContainText('Det gick inte');
  await expect(page.locator('.verdict')).toContainText('Göran Häggkvist');
  await expect(undo).toBeVisible();
});

test('a Responses row on a phone gives the name its own line', async ({ page }) => {
  await signInAs(page, sql, 'admin@example.com');
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/responses');
  const row = page.locator('.inbox__link').first();
  await expect(row).toBeVisible();
  const who = (await row.locator('.inbox__who').boundingBox())!;
  const form = (await row.locator('.inbox__form').boundingBox())!;
  // The form's title sits beneath the name, not beside it eating its width.
  expect(form.y).toBeGreaterThanOrEqual(who.y + who.height - 1);
  // No badge on a finished response: the mark is for the exception.
  await expect(page.locator('.inbox__status .badge').first()).toHaveCount(0);
});

test('the recent-arrival row gives the name the room, at 375', async ({ page }) => {
  /*
   * The row used to carry a full medium date — "12 okt. 2026 14:03" — in an `auto` column that
   * held about 118px, and the name got what was left: roughly ten characters before the ellipsis.
   * Every arrival in this list happened today, and the person on the door is looking at who just
   * came in, so the row shows the time in a column sized in `ch`.
   */
  const reference = await register();
  await signInAs(page, sql, 'operator@example.com');
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`/events/${eventId}/check-in`);

  await page.getByLabel(/Referens/).fill(reference);
  await page.getByRole('button', { name: 'Checka in' }).click();
  await expect(page.getByText('Välkommen')).toBeVisible();

  // The time, not a date clipped to fit. A 6ch column holds either; only one of them reads.
  await expect(page.locator('.door__row .door__when').first()).toHaveText(/^\d{1,2}[:.]\d{2}$/);

  const who = page.locator('.door__row .door__who').first();
  await expect(who).toHaveText('Göran Häggkvist');
  expect(
    await who.evaluate((el) => el.scrollWidth <= el.clientWidth),
    'the name is ellipsised at 375',
  ).toBe(true);
});

test('a server fault is not a verdict about the card', async ({ page }) => {
  /*
   * The route answers 200 with a verdict for every outcome it has, not-found included — so
   * anything the client throws on is a fault, not an answer. It used to render "Hittades inte",
   * which tells the person on the door to turn away somebody who is on the list.
   */
  const reference = await register();
  await signInAs(page, sql, 'operator@example.com');
  await page.goto(`/events/${eventId}/check-in`);

  await page.route('**/v1/events/*/check-ins', (route) =>
    route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"boom"}' }),
  );

  await page.getByLabel(/Referens/).fill(reference);
  await page.getByRole('button', { name: 'Checka in' }).click();

  const verdict = page.locator('.verdict__headline');
  await expect(verdict).toBeVisible();
  await expect(verdict, 'a 500 still reads as "not found"').not.toHaveText('Hittades inte');

  // And the code stays put, so the operator can try again without asking for the card back.
  await expect(page.getByLabel(/Referens/)).toHaveValue(reference);
});

test('the bottom bar labels clear the 11px floor at 375', async ({ page }) => {
  // The ordinary shell, not the door: check-in is a mode with its own chrome and no bottom bar.
  await signInAs(page, sql, 'operator@example.com');
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/events');

  // The shell is code-split, so `goto` resolves before React has rendered the nav.
  const labels = page.locator('.sidebar .nav-link');
  await expect(labels.first()).toBeVisible();
  const count = await labels.count();
  expect(count).toBeGreaterThan(0);

  for (let index = 0; index < count; index += 1) {
    const size = await labels
      .nth(index)
      .evaluate((node) => Number.parseFloat(getComputedStyle(node).fontSize));
    expect(size, `nav label ${index} is ${size}px`).toBeGreaterThanOrEqual(11);
  }
});
