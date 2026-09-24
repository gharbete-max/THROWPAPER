import { readFileSync } from 'node:fs';
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
/**
 * Mints a refresh token for a seeded user the way the server does — random secret, SHA-256 hash
 * stored — and returns the secret. `POST /v1/auth/refresh` with it is a real sign-in from there.
 */
export async function plantRefreshToken(
  sql: ReturnType<typeof db>,
  email: string,
): Promise<string> {
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
  return secret;
}

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
  const secret = await plantRefreshToken(sql, email);

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

/**
 * Mints a magic-link token the way the server does and returns the secret.
 *
 * `login_tokens` stores only a SHA-256 hash, so the plaintext exists nowhere but in the email —
 * which a spec cannot read, because the API's stdout belongs to Playwright's shared `webServer`.
 * Minting one here and visiting `/auth/callback?token=<secret>` drives the real `Callback` screen
 * and the real `POST /v1/auth/token` exchange; only the mail hop is skipped. Same trade as
 * `plantRefreshToken`, one step earlier in the flow.
 */
export async function plantLoginToken(sql: ReturnType<typeof db>, email: string): Promise<string> {
  const [user] = await sql`select id from users where email = ${email} limit 1`;
  if (!user) throw new Error(`No seeded user ${email} — run pnpm db:seed first.`);

  const secret = randomBytes(32).toString('base64url');
  await sql`
    insert into login_tokens (user_id, token_hash, expires_at)
    values (
      ${String(user['id'])},
      ${createHash('sha256').update(secret).digest('hex')},
      now() + interval '15 minutes'
    )
  `;
  return secret;
}

/**
 * How many files a ZIP holds, without a library.
 *
 * `archiver` writes ZIPs and cannot read them, and nothing else in the tree can either. Rather
 * than add a dependency for one assertion, this reads the End Of Central Directory record — the
 * last thing in a ZIP — whose entry count is two little-endian bytes at offset 10. The signature
 * is scanned for backwards because the record is followed by a comment of unknown length.
 */
export function zipEntryCount(archive: Buffer): number {
  const EOCD = 0x06054b50;
  for (let at = archive.length - 22; at >= 0; at -= 1) {
    if (archive.readUInt32LE(at) === EOCD) return archive.readUInt16LE(at + 10);
  }
  throw new Error('Not a ZIP: no end-of-central-directory record found');
}

/**
 * Decodes the QR out of a generated admission PDF, in the browser Playwright already runs.
 *
 * A door reads this code with a camera, so the thing worth proving is that the *pixels* decode —
 * not that the token the PDF was built from is valid, which is a different and weaker claim.
 *
 * Decoding in Node would mean rasterising the page there, and `pdfjs-dist` has no canvas backend
 * installed; adding one is a native dependency carried forever for one assertion. Chromium is
 * already here and already has a canvas. `pdfjs-dist` and `@zxing/library` are already
 * dependencies of `apps/forms` — zxing is what `screens/CheckIn.tsx` drives the camera with — so
 * both are served to the page from `node_modules` off a routed URL rather than installed anew.
 *
 * pdfjs 6 ships ESM only, so it arrives by dynamic `import()` — the legacy build, as the app's own
 * paper import uses, so the harness runs in any Chromium; zxing's UMD build is a classic
 * script and lands on `window`.
 */
export async function decodeQrFromPdf(page: Page, pdf: Buffer): Promise<string> {
  const read = (relative: string) =>
    readFileSync(new URL(`../apps/forms/node_modules/${relative}`, import.meta.url));

  for (const [route, file] of [
    ['**/__e2e/pdf.mjs', 'pdfjs-dist/legacy/build/pdf.min.mjs'],
    ['**/__e2e/pdf.worker.mjs', 'pdfjs-dist/legacy/build/pdf.worker.min.mjs'],
  ] as const) {
    await page.route(route, (r) =>
      r.fulfill({ body: read(file), contentType: 'text/javascript; charset=utf-8' }),
    );
  }
  await page.addScriptTag({ content: read('@zxing/library/umd/index.min.js').toString('utf8') });

  return page.evaluate(async (bytes: number[]) => {
    // Through `new Function`, because a literal `import()` of a path that exists only behind a
    // Playwright route is a module the compiler cannot resolve and will refuse to believe in.
    const load = new Function('url', 'return import(url)') as (u: string) => Promise<unknown>;
    const pdfjs = (await load('/__e2e/pdf.mjs')) as {
      GlobalWorkerOptions: { workerSrc: string };
      getDocument: (o: unknown) => { promise: Promise<unknown> };
    };
    pdfjs.GlobalWorkerOptions.workerSrc = '/__e2e/pdf.worker.mjs';

    const doc = (await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise) as {
      getPage: (n: number) => Promise<{
        getViewport: (o: { scale: number }) => { width: number; height: number };
        render: (o: unknown) => { promise: Promise<void> };
      }>;
    };
    const first = await doc.getPage(1);

    // The core reader, not one of the `Browser*` wrappers: those are built around a camera or an
    // <img>, and their surface moves between zxing minors. Luminance → binarizer → bitmap →
    // decode is the API underneath all of them and has not changed.
    const zxing = window as unknown as {
      ZXing: {
        HTMLCanvasElementLuminanceSource: new (c: HTMLCanvasElement) => unknown;
        HybridBinarizer: new (s: unknown) => unknown;
        GlobalHistogramBinarizer: new (s: unknown) => unknown;
        BinaryBitmap: new (b: unknown) => unknown;
        DecodeHintType: { TRY_HARDER: number };
        QRCodeReader: new () => {
          decode: (b: unknown, hints?: Map<number, unknown>) => { getText: () => string };
        };
      };
    };
    const hints = new Map<number, unknown>([[zxing.ZXing.DecodeHintType.TRY_HARDER, true]]);

    /*
     * Several looks, the way the door does it.
     *
     * One raster at one scale through one binarizer failed about once in thirty CI runs, inside
     * Reed–Solomon correction: the token is signed afresh each run, so each run is a different
     * symbol, and now and then a module edge lands on a pixel boundary badly enough at scale 3 to
     * cost a codeword. A camera at the door never has that problem because it reads many frames.
     * So this reads a few renders — different scales move the module edges — through both
     * binarizers, and takes the first that decodes. What is asserted is unchanged: the caller
     * still compares the decoded text to the token, so a card that does not carry the right token
     * still fails.
     */
    const failures: string[] = [];
    for (const scale of [3, 4, 2.5]) {
      const viewport = first.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      await first.render({ canvasContext: canvas.getContext('2d')!, viewport, canvas }).promise;

      const source = new zxing.ZXing.HTMLCanvasElementLuminanceSource(canvas);
      for (const Binarizer of [zxing.ZXing.HybridBinarizer, zxing.ZXing.GlobalHistogramBinarizer]) {
        try {
          const bitmap = new zxing.ZXing.BinaryBitmap(new Binarizer(source));
          return new zxing.ZXing.QRCodeReader().decode(bitmap, hints).getText();
        } catch (error) {
          failures.push(`scale ${scale}: ${String(error)}`);
        }
      }
    }
    throw new Error(`No QR decoded from the PDF:\n${failures.join('\n')}`);
  }, Array.from(pdf));
}
