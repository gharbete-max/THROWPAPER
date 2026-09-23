import { expect, test } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import {
  db,
  decodeQrFromPdf,
  deleteSubmission,
  plantLoginToken,
  uniqueEmail,
  zipEntryCount,
} from './support.js';

/**
 * S3 — one simulated user, one loop, end to end.
 *
 * The owner cannot test this product by hand, so this file is the acceptance channel: the whole
 * v0.1 journey as one person actually walks it, in a real browser against a real Postgres.
 *
 * It is deliberately **one test**, not ten. The other specs already assert the pieces — the public
 * form, the door, persistence across a restart — and they are better at it, because a focused test
 * that fails names its own cause. What none of them can show is that the pieces still join up: an
 * event created in the morning, a form built on top of it, a stranger's registration, the PDF that
 * registration produces, and the code on that PDF opening the door that evening. Every step here
 * is the input to the next one, which is the only way that claim can be made.
 *
 * Where there is a screen, it drives the screen. Two steps have no screen and are driven through
 * the API, which is a finding rather than a shortcut — see § Simulation findings in
 * `docs/PROGRESS.md`:
 *
 * - **Attaching a form to an event.** `createForm` accepts `eventId` and no screen ever sends it.
 * - **Bulk admission documents.** Known and recorded before this spec was written.
 */
const API = 'http://localhost:4001';
const sql = db();

/** Everything this test makes, so a re-run starts from the same place as the first run. */
const references: string[] = [];
let formId: string | undefined;
let eventId: string | undefined;

test.afterAll(async () => {
  /*
   * Swept by pattern, not by the ids this run happened to reach.
   *
   * A test that fails at step three never sets `formId`, so an id-based cleanup leaves the form
   * and its draft behind — and the next run inherits them. That is not hypothetical: leftovers
   * from a failed run put an extra row in `/responses` and failed two *unrelated* specs in
   * check-in.spec, which is a far worse ten minutes than writing this.
   */
  for (const reference of references) await deleteSubmission(sql, reference);

  const forms = await sql`select id from forms where slug like 's3-%'`;
  const ids = forms.map((row) => String(row['id']));
  if (ids.length > 0) {
    // Order matters: a check-in points at a submission, a submission at the version it was made
    // against, and a version cannot go while anything still references it.
    await sql`
      delete from check_ins where submission_id in (
        select id from submissions where form_id in ${sql(ids)}
      )
    `;
    await sql`delete from submissions where form_id in ${sql(ids)}`;
    await sql`delete from jobs where payload->>'formId' in ${sql(ids)}`;
    await sql`update forms set published_version_id = null where id in ${sql(ids)}`;
    await sql`delete from form_versions where form_id in ${sql(ids)}`;
    await sql`delete from forms where id in ${sql(ids)}`;
  }
  await sql`delete from events where name->>'sv-SE' like 'S3 %'`;

  await sql.end();
});

/** A datetime-local input wants exactly this, and a `Date` will not do. */
function localInput(daysFromNow: number): string {
  const at = new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000);
  at.setSeconds(0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

/** The access token for the two steps that have no screen. */
async function bearer(request: APIRequestContext): Promise<Record<string, string>> {
  const secret = await plantLoginToken(sql, 'admin@example.com');
  const exchanged = await request.post(`${API}/v1/auth/token`, { data: { token: secret } });
  expect(exchanged.status(), 'the minted magic-link token exchanges').toBe(200);
  return { authorization: `Bearer ${(await exchanged.json()).accessToken as string}` };
}

/** Polls a job to rest. The bulk export renders a PDF per registration and is not instant. */
async function drain(request: APIRequestContext, headers: Record<string, string>, id: string) {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    const body = await (await request.get(`${API}/v1/jobs/${id}`, { headers })).json();
    if (body.status === 'done') return body.result as { downloadPath: string };
    if (body.status === 'failed') throw new Error(`admission.bulk failed: ${body.error}`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('admission.bulk never finished');
}

test('one person: signs in, builds an event and a form, and admits a stranger at the door', async ({
  page,
  browser,
  request,
}) => {
  // Eleven real steps, two servers and a PDF render per registration.
  test.setTimeout(240_000);

  // ── 1. Sign in, through the magic link's own landing screen ───────────────────────────────
  const secret = await plantLoginToken(sql, 'admin@example.com');
  // The shell takes its language from the browser, and CI's Chromium says en-US: pinned before
  // first load, or every assertion below looks for Swedish that was never rendered.
  await page.addInitScript(() => window.localStorage.setItem('tp.locale', 'sv-SE'));
  await page.goto(`/auth/callback?token=${secret}`);
  await expect(page.getByRole('heading', { name: 'Evenemang' })).toBeVisible();

  // ── 2. Create an event ────────────────────────────────────────────────────────────────────
  const eventName = `S3 ${Date.now().toString(36)}`;
  await page.goto('/events/new');
  // One input per locale, labelled by the language's own name inside a `Namn` fieldset — so the
  // field is reached through the group, not by a label that appears twice on the page.
  await page.getByRole('group', { name: 'Namn' }).getByLabel('Svenska').fill(eventName);
  await page.getByLabel('Börjar').fill(localInput(30));
  await page.getByLabel('Slutar').fill(localInput(31));
  await page.getByLabel('Anmälan stänger').fill(localInput(29));
  await page.getByLabel('Antal platser').fill('50');
  await page.getByLabel('Status').selectOption('open');
  await page.getByRole('button', { name: 'Spara' }).click();

  await expect(page.getByText(eventName)).toBeVisible();
  const [eventRow] = await sql`
    select id from events where name->>'sv-SE' = ${eventName} limit 1
  `;
  expect(eventRow, 'the event the screen just saved is in Postgres').toBeTruthy();
  eventId = String(eventRow!['id']);

  // ── 3. Create a form ──────────────────────────────────────────────────────────────────────
  const slug = `s3-${Date.now().toString(36)}`;
  await page.goto('/forms');
  await page.getByRole('button', { name: 'Nytt formulär' }).first().click();
  // "Nytt formulär" opens the wizard. This operator knows what they want and takes the manual
  // route, which is the one that lets them name the slug the public link will use.
  await page.getByRole('button', { name: 'Bygga själv' }).click();
  await page.getByLabel('Titel').fill(`Anmälan ${eventName}`);
  await page.getByLabel('Länkadress').fill(slug);
  await page.getByRole('button', { name: 'Skapa', exact: true }).click();

  // The wizard route opens the new form; this one hands you back the list and lets you find it.
  // Recorded as a finding — the two ways of making a form end somewhere different.
  await page
    .locator('.card', { hasText: `Anmälan ${eventName}` })
    .getByRole('link', { name: 'Redigera formulär' })
    .click();
  await expect(page).toHaveURL(/\/forms\/[0-9a-f-]{36}$/);
  formId = page.url().split('/').pop()!;

  // ── 4. Attach it to the event — no screen does this ───────────────────────────────────────
  // `createForm` takes `eventId` and nothing in the app ever passes one, so a registration
  // cannot become an admission without this call. Recorded as a finding, not worked around
  // silently: without an event there is no door, and the rest of this test could not run.
  const headers = await bearer(request);
  const attached = await request.patch(`${API}/v1/forms/${formId}`, {
    headers,
    data: { eventId },
  });
  expect(attached.status(), 'the form can be attached to its event through the API').toBe(200);

  // ── 5. Build it: two questions, and save-and-resume turned on ─────────────────────────────
  await page.reload();
  // The key is left as the builder generates it: it lives behind the "Avancerat" disclosure and
  // only matters to the export. What the visitor reads is the label.
  await page.getByRole('button', { name: 'Kort text' }).click();
  await page.getByLabel('Etikett').first().fill('Namn');

  await page.getByRole('button', { name: 'E-post', exact: true }).click();
  await page.getByLabel('Etikett').first().fill('E-postadress');
  await page.getByLabel('Obligatoriskt').check();

  // The settings live at the foot of the builder, always on — not behind a tab.
  await page.getByLabel('Tillåt att spara och fortsätta senare').check();

  /*
   * Publishing snapshots the draft, and the draft is saved by an autosave rather than a button —
   * so publishing too early ships the form as it was two edits ago.
   *
   * Waiting for the "Sparat" indicator does not prove this: it was already showing from the field
   * edits a moment earlier, so the assertion passes without the settings change having been
   * written. The draft row itself is the only thing that actually answers the question.
   */
  await expect
    .poll(
      async () => {
        const [row] = await sql`select draft_definition from forms where id = ${formId!}`;
        return Boolean(
          (row?.['draft_definition'] as { settings?: { allowSaveAndResume?: boolean } })?.settings
            ?.allowSaveAndResume,
        );
      },
      { timeout: 15_000, message: 'the autosave never wrote allowSaveAndResume to the draft' },
    )
    .toBe(true);

  // ── 6. Publish ────────────────────────────────────────────────────────────────────────────
  await page.getByRole('button', { name: 'Publicera' }).first().click();
  // A form whose twelve locales are not all translated asks before publishing. Answering it is
  // part of the journey: the operator publishes in Swedish and fills the rest in later.
  const override = page.getByRole('button', { name: 'Publicera' }).last();
  if (await override.isVisible().catch(() => false)) await override.click();

  // Published, and published *with the settings the builder was left in* — the version is a
  // snapshot, so "a version exists" is not the same claim.
  await expect
    .poll(
      async () => {
        const [row] = await sql`
          select v.definition from forms f
          join form_versions v on v.id = f.published_version_id
          where f.id = ${formId!}
        `;
        if (!row) return 'not published';
        const settings = (row['definition'] as { settings?: { allowSaveAndResume?: boolean } })
          .settings;
        return settings?.allowSaveAndResume ? 'published with save-and-resume' : 'published stale';
      },
      { timeout: 15_000 },
    )
    .toBe('published with save-and-resume');

  // ── 7. A stranger registers — a fresh browser, no session, no shared state ────────────────
  // The public form renders in the visitor's own language, so the language is pinned at the
  // context rather than asserted against whatever CI's Chromium happens to report.
  const visitor = await browser.newContext({ locale: 'sv-SE' });
  const guest = await visitor.newPage();
  const email = uniqueEmail('s3');
  await guest.goto(`/f/${slug}`);
  await guest.getByLabel('Namn').fill('Simulerad Besökare');
  await guest.getByLabel(/E-post/).fill(email);

  // Leave halfway. The resume link is only ever shown, never stored — `submissions` keeps a hash
  // of the token, the way `login_tokens` does — so the test takes it off the screen, which is the
  // one place a real visitor can get it from.
  await guest.getByRole('button', { name: 'Spara och fortsätt senare' }).click();
  const link = guest.locator('input[readonly]');
  await expect(link).toBeVisible();
  const resumeLink = await link.inputValue();
  expect(resumeLink, 'leaving halfway offers a link back').toContain('resume=');

  // A different visit entirely: the link is the only thing carried across.
  await visitor.clearCookies();
  await guest.goto(resumeLink);
  await expect(guest.getByLabel('Namn')).toHaveValue('Simulerad Besökare');

  await guest.getByLabel(/post/i).fill(email);
  await guest.getByRole('button', { name: 'Slutför' }).click();
  await expect(guest.getByText('Tack!')).toBeVisible();

  const reference = (
    await guest
      .getByText(/[0-9A-Z]{4}-[0-9A-Z]{4}/)
      .first()
      .textContent()
  )?.match(/[0-9A-Z]{4}-[0-9A-Z]{4}/)?.[0];
  expect(reference, 'the confirmation shows a reference the door can use').toBeTruthy();
  references.push(reference!);
  await visitor.close();

  // ── 8. The admission documents — no screen does this either ───────────────────────────────
  const queued = await request.post(`${API}/v1/forms/${formId}/admission-documents`, { headers });
  expect(queued.status()).toBe(202);
  const { downloadPath } = await drain(request, headers, (await queued.json()).id as string);

  const archive = await request.get(`${API}${downloadPath}`);
  expect(archive.status()).toBe(200);
  expect(archive.headers()['content-type']).toContain('application/zip');

  // ── 9. One registration, one document in the ZIP ──────────────────────────────────────────
  expect(zipEntryCount(Buffer.from(await archive.body()))).toBe(references.length);

  // ── 10. The QR on the card decodes — as a camera would read it ────────────────────────────
  const [submission] = await sql`
    select id from submissions where reference = ${reference!} limit 1
  `;
  const card = await request.get(
    `${API}/v1/submissions/${String(submission!['id'])}/admission.pdf`,
    { headers },
  );
  expect(card.status()).toBe(200);

  const scanned = await decodeQrFromPdf(page, Buffer.from(await card.body()));
  expect(scanned, 'the code on the card names the registration it belongs to').toContain(
    reference!,
  );

  // ── 11. The door: admitted once, and told so the second time ──────────────────────────────
  // `CheckIn.tsx:210` hands a scanned string to the same `submit` the typed field uses, so typing
  // the decoded value is exactly what the camera does.
  await page.goto(`/events/${eventId}/check-in`);
  await page.getByLabel(/Referens/).fill(scanned);
  await page.getByRole('button', { name: 'Checka in' }).click();
  await expect(page.getByText('Välkommen')).toBeVisible();

  await page.getByLabel(/Referens/).fill(scanned);
  await page.getByRole('button', { name: 'Checka in' }).click();
  await expect(page.getByText('Redan incheckad')).toBeVisible();

  // The screen is not the record. Exactly one arrival, whatever it said.
  const arrivals = await sql`
    select 1 from check_ins c
    join submissions s on s.id = c.submission_id
    where s.reference = ${reference!}
  `;
  expect(arrivals).toHaveLength(1);
});
