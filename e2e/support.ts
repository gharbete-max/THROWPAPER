import { createHash, randomBytes, randomUUID } from 'node:crypto';
import postgres from 'postgres';
import type { Page } from '@playwright/test';

/**
 * Helpers the e2e suite needs, all of them talking to the same database the server is using.
 *
 * Signing in is the awkward one. The real flow is a magic link printed to the API's console, which
 * a browser test cannot read. Rather than add a test-only endpoint to production code, the suite
 * mints a refresh token the same way the server does — random secret, SHA-256 hash stored — and
 * puts the secret where the app keeps it. The app's own `restoreSession()` then exchanges it for
 * an access token through the real endpoint, so everything after this point is the genuine path.
 */
export const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgres://throwpaper:throwpaper@localhost:5432/throwpaper';

export function db() {
  return postgres(DATABASE_URL, { max: 1, onnotice: () => {} });
}

export interface SeededForm {
  organisationId: string;
  formId: string;
  slug: string;
  eventId: string | null;
}

/** The form `pnpm db:seed` publishes. The suite reads it rather than building its own. */
export async function seededForm(sql: ReturnType<typeof db>): Promise<SeededForm> {
  const [row] = await sql`
    select f.id, f.slug, f.event_id, f.organisation_id
    from forms f
    where f.published_version_id is not null
    order by f.created_at
    limit 1
  `;
  if (!row) throw new Error('No published form found — run pnpm db:seed first.');
  return {
    organisationId: String(row['organisation_id']),
    formId: String(row['id']),
    slug: String(row['slug']),
    eventId: row['event_id'] ? String(row['event_id']) : null,
  };
}

/**
 * Puts a working session in the browser without going through the magic link.
 *
 * Only the refresh token is planted; the access token is obtained by the app calling the real
 * `/v1/auth/refresh`. Anything the test does afterwards is authenticated exactly as a user would
 * be.
 */
export async function signInAs(
  page: Page,
  sql: ReturnType<typeof db>,
  email: string,
  /**
   * Pinned, not inherited. The authenticated shell takes its language from the browser, and CI's
   * Chromium reports `en-US` — so assertions written against Swedish labels silently looked for
   * text that was never on the page.
   */
  locale: 'sv-SE' | 'en-GB' = 'sv-SE',
): Promise<void> {
  const [user] = await sql`select id from users where email = ${email} limit 1`;
  if (!user) throw new Error(`No seeded user ${email} — run pnpm db:seed first.`);

  const secret = randomBytes(32).toString('base64url');
  await sql`
    insert into refresh_tokens (user_id, family_id, token_hash, expires_at)
    values (
      ${String(user['id'])},
      ${randomUUID()},
      ${createHash('sha256').update(secret).digest('hex')},
      now() + interval '1 day'
    )
  `;

  /**
   * Must be set for the app's origin before the first load, or restoreSession finds nothing.
   *
   * Planted only when nothing is there. `addInitScript` runs on *every* navigation, and refresh
   * tokens rotate on use — so re-planting the original on a second page load presents a token that
   * has already been spent, and the reuse detection from phase 2 correctly revokes the whole
   * family and logs the session out. Any test that navigates twice would lose its session, and the
   * product would be right to do that.
   */
  await page.addInitScript(
    ({ token, locale: chosen }: { token: string; locale: string }) => {
      if (!window.localStorage.getItem('tp.refresh')) {
        window.localStorage.setItem('tp.refresh', token);
      }
      window.localStorage.setItem('tp.locale', chosen);
    },
    { token: secret, locale },
  );
}

/** Removes rows a test created, so a re-run starts clean. */
export async function deleteSubmission(
  sql: ReturnType<typeof db>,
  reference: string,
): Promise<void> {
  await sql`delete from check_ins where submission_id in (
    select id from submissions where reference = ${reference}
  )`;
  await sql`delete from submissions where reference = ${reference}`;
}

/** A fresh address per run, so duplicate control does not reject the second execution. */
export function uniqueEmail(prefix = 'e2e'): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1000)}@example.com`;
}
