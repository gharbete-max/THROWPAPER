import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { db, deleteSubmission, seededForm, signInAs } from './support.js';
import { tinyPdf } from './pdf.js';

/**
 * A form made from paper, all the way round, in a real browser against the real server.
 *
 * The author imports a PDF, draws a text box and a signature box on the page, and reopens the
 * builder to find them where they were left. The form is published, filled in with a drawn
 * signature, and the organisation downloads the original page with the answers written on it.
 * That PDF is then drawn with pdf.js — the way a person sees it — and read: the answer inside its
 * box, ink inside the signature box, the original's own text still there.
 *
 * Twice: upright, and rotated a quarter turn, because a scanner's PDF often carries `/Rotate` and
 * the answers once came out in the wrong place and on their side on such a page.
 */
const sql = db();
const forms: string[] = [];
const references: string[] = [];

test.afterAll(async () => {
  for (const reference of references) await deleteSubmission(sql, reference);
  for (const id of forms) {
    await sql`delete from form_uploads where form_id = ${id}`;
    await sql`update forms set published_version_id = null where id = ${id}`;
    await sql`delete from form_versions where form_id = ${id}`;
    await sql`delete from forms where id = ${id}`;
  }
  await sql.end();
});

/** Where the author draws the two boxes, as fractions of the page as it is seen. */
const TEXT_BOX = { x1: 0.15, y1: 0.3, x2: 0.65, y2: 0.36 };
const SIGN_BOX = { x1: 0.15, y1: 0.5, x2: 0.65, y2: 0.68 };

interface Seen {
  runs: Array<{ text: string; x: number; y: number }>;
  /** Dark pixels inside each box (inset, so a border drawn around it is not counted). */
  ink: number[];
}

/** Draws page 1 of a PDF with pdf.js in the page, and reads it back as a person would see it. */
async function see(page: Page, pdf: Buffer, boxes: Array<typeof TEXT_BOX>): Promise<Seen> {
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
  return page.evaluate(
    async ({ bytes, boxes }) => {
      const load = new Function('url', 'return import(url)') as (u: string) => Promise<unknown>;
      type Viewport = {
        width: number;
        height: number;
        convertToViewportPoint: (x: number, y: number) => number[];
      };
      type TextItem = { str?: string; transform: number[] };
      type PdfPage = {
        getViewport: (o: { scale: number }) => Viewport;
        render: (o: unknown) => { promise: Promise<void> };
        getTextContent: () => Promise<{ items: TextItem[] }>;
      };
      const pdfjs = (await load('/__e2e/pdf.mjs')) as {
        GlobalWorkerOptions: { workerSrc: string };
        getDocument: (o: unknown) => {
          promise: Promise<{ getPage: (n: number) => Promise<PdfPage> }>;
        };
      };
      pdfjs.GlobalWorkerOptions.workerSrc = '/__e2e/pdf.worker.mjs';
      const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise;
      const first = await doc.getPage(1);
      const viewport = first.getViewport({ scale: 2 });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext('2d')!;
      await first.render({ canvasContext: context, viewport, canvas }).promise;

      const content = await first.getTextContent();
      const runs = content.items
        .filter((item) => typeof item.str === 'string' && item.str.trim())
        .map((item) => {
          const [x = 0, y = 0] = viewport.convertToViewportPoint(
            item.transform[4] ?? 0,
            item.transform[5] ?? 0,
          );
          return { text: item.str!, x: x / viewport.width, y: y / viewport.height };
        });

      const ink = boxes.map((box) => {
        const insetX = (box.x2 - box.x1) * 0.08;
        const insetY = (box.y2 - box.y1) * 0.08;
        const x = Math.round((box.x1 + insetX) * canvas.width);
        const y = Math.round((box.y1 + insetY) * canvas.height);
        const w = Math.round((box.x2 - box.x1 - 2 * insetX) * canvas.width);
        const h = Math.round((box.y2 - box.y1 - 2 * insetY) * canvas.height);
        const data = context.getImageData(x, y, w, h).data;
        let dark = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i]! + data[i + 1]! + data[i + 2]! < 384 && data[i + 3]! > 0) dark += 1;
        }
        return dark;
      });
      return { runs, ink };
    },
    { bytes: Array.from(pdf), boxes },
  );
}

/** The run from which the following runs spell `answer` (Chromium may split a word). */
function findAnswer(runs: Seen['runs'], answer: string) {
  return runs.find((_, i) =>
    runs
      .slice(i)
      .map((run) => run.text)
      .join('')
      .replace(/\s+/g, '')
      .startsWith(answer.replace(/\s+/g, '')),
  );
}

/** A box's place as the builder styles it — `left/top/width/height` in percent of the page. */
function boxFromStyle(style: string): typeof TEXT_BOX {
  const [left, top, width, height] = ['left', 'top', 'width', 'height'].map((property) =>
    Number(new RegExp(`${property}: ([\\d.]+)%`).exec(style)?.[1] ?? NaN),
  ) as [number, number, number, number];
  return { x1: left / 100, y1: top / 100, x2: (left + width) / 100, y2: (top + height) / 100 };
}

async function drawBox(page: Page, box: typeof TEXT_BOX, type: string) {
  const surface = page.locator('.paper__surface').first();
  const size = (await surface.boundingBox())!;
  // Hovering the starting point scrolls it into view; the end is measured after that scroll.
  await surface.hover({ position: { x: size.width * box.x1, y: size.height * box.y1 } });
  await page.mouse.down();
  const at = (await surface.boundingBox())!;
  await page.mouse.move(at.x + at.width * box.x2, at.y + at.height * box.y2, { steps: 8 });
  await page.mouse.up();
  await page
    .getByRole('dialog', { name: 'What kind of answer?' })
    .getByRole('button', { name: type, exact: true })
    .click();
}

// Tall enough that a whole page and the boxes on it are on screen at once.
test.use({ viewport: { width: 1280, height: 1100 } });

for (const [shape, rotate] of [
  ['an upright page', 0],
  ['a page rotated a quarter turn', 90],
] as const) {
  test(`paper, all the way round, on ${shape}`, async ({ page, browser }) => {
    test.setTimeout(180_000);
    await signInAs(page, sql, 'admin@example.com', 'en-GB');
    const stamp = `${Date.now().toString(36)}${rotate}`;
    const title = `Paper round trip ${stamp}`;
    const source = tinyPdf('Membership 2011', rotate);

    // ── Build: a blank form, then its paper ───────────────────────────────────────────────
    await page.goto('/forms');
    await page.getByRole('button', { name: 'New form' }).first().click();
    await page.getByRole('button', { name: /Build it myself/ }).click();
    await page.getByLabel('Title', { exact: true }).fill(title);
    await page.getByLabel('Link address').fill(`paper-trip-${stamp}`);
    await page.getByRole('button', { name: 'Create' }).click();
    await page
      .locator('.card', { hasText: title })
      .getByRole('link', { name: 'Edit form' })
      .click();
    await expect(page).toHaveURL(/\/forms\/[0-9a-f-]{36}$/);
    const formId = page.url().split('/').pop()!;
    forms.push(formId);

    await page.getByRole('button', { name: 'From paper' }).click();
    await page.getByLabel('PDF or photographs').setInputFiles({
      name: 'membership.pdf',
      mimeType: 'application/pdf',
      buffer: source,
    });
    await expect(page.getByText('1 page')).toBeVisible();
    await page.getByRole('button', { name: 'Replace this form' }).click();
    await expect(page.locator('.paper__surface canvas')).toBeVisible();

    await drawBox(page, TEXT_BOX, 'Short text');
    await drawBox(page, SIGN_BOX, 'Signature');
    await expect(page.locator('.paper__box')).toHaveCount(2);
    const placed = await page
      .locator('.paper__box')
      .evaluateAll((boxes) => boxes.map((box) => (box as HTMLElement).style.cssText));
    await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 15_000 });

    // ── Reopen: the boxes are where they were left ────────────────────────────────────────
    await page.reload();
    await expect(page.locator('.paper__box')).toHaveCount(2, { timeout: 20_000 });
    expect(
      await page
        .locator('.paper__box')
        .evaluateAll((boxes) => boxes.map((box) => (box as HTMLElement).style.cssText)),
    ).toEqual(placed);

    // ── Publish ───────────────────────────────────────────────────────────────────────────
    await page.getByRole('button', { name: 'Publish' }).first().click();
    // The organisation publishes in two languages and the boxes' labels are in one, so the builder
    // asks first (rule 7); the answer is yes.
    const anyway = page.getByRole('dialog').getByRole('button', { name: 'Publish', exact: true });
    const published = page.getByText(/Version 1/).first();
    await expect(anyway.or(published).first()).toBeVisible({ timeout: 15_000 });
    if (await anyway.isVisible()) await anyway.click();
    await expect(published).toBeVisible({ timeout: 15_000 });

    // ── Fill in, with a drawn signature ───────────────────────────────────────────────────
    const visitor = await browser.newPage();
    await visitor.goto(`/f/paper-trip-${stamp}`);
    await visitor.getByRole('button', { name: /^(Language|Språk):/ }).click();
    await visitor.getByRole('option', { name: 'English' }).click();
    const answer = 'Åsa Öberg-Ærø';
    await visitor.locator('input[type="text"]').first().fill(answer);
    const pad = visitor.locator('canvas.signature__pad');
    await pad.scrollIntoViewIfNeeded();
    const at = (await pad.boundingBox())!;
    await visitor.mouse.move(at.x + at.width * 0.1, at.y + at.height * 0.6);
    await visitor.mouse.down();
    for (let step = 1; step <= 24; step += 1) {
      await visitor.mouse.move(
        at.x + at.width * (0.1 + step * 0.033),
        at.y + at.height * (0.6 - 0.35 * Math.sin(step / 3)),
      );
    }
    await visitor.mouse.up();
    await visitor.getByRole('button', { name: 'Use this signature' }).click();
    await expect(visitor.getByText('Signed', { exact: true })).toBeVisible();
    await visitor.getByRole('button', { name: 'Complete' }).click();
    await expect(visitor.getByText(/Your reference:/)).toBeVisible();
    const reference = (await visitor.getByText(/Your reference:/).textContent())?.match(
      /[0-9A-Z]{4}-[0-9A-Z]{4}/,
    )?.[0];
    if (!reference) throw new Error('no reference');
    references.push(reference);

    // The respondent's own copy is the paper too.
    await expect(visitor.getByRole('heading', { name: 'Your document is ready' })).toBeVisible({
      timeout: 60_000,
    });
    const theirs = visitor.waitForEvent('download');
    await visitor.getByRole('button', { name: 'Download PDF' }).click();
    const respondentCopy = await readFile((await (await theirs).path())!);

    // ── The organisation downloads the paper ──────────────────────────────────────────────
    await page.goto(`/forms/${formId}/submissions`);
    const downloading = page.waitForEvent('download');
    await page.getByRole('button', { name: `${reference}-paper.pdf` }).click();
    const paper = await readFile((await (await downloading).path())!);
    expect(paper.subarray(0, 5).toString()).toBe('%PDF-');

    // ── Read it the way a person sees it ──────────────────────────────────────────────────
    // Against the boxes as they were placed (a drag lands within a few pixels of where it was
    // aimed, not exactly), read back from the builder in the order the fields were made.
    const [textBox, signBox] = placed.map(boxFromStyle) as [typeof TEXT_BOX, typeof TEXT_BOX];
    const blank = await see(visitor, source, [textBox, signBox]);
    for (const copy of [paper, respondentCopy]) {
      const seen = await see(visitor, copy, [textBox, signBox]);
      // The original is still there.
      expect(findAnswer(seen.runs, 'Membership 2011'), JSON.stringify(seen.runs)).toBeDefined();
      // The answer, inside its box.
      const written = findAnswer(seen.runs, answer);
      expect(written, JSON.stringify(seen.runs)).toBeDefined();
      expect(written!.x).toBeGreaterThanOrEqual(textBox.x1 - 0.01);
      expect(written!.x).toBeLessThan(textBox.x2);
      expect(written!.y).toBeGreaterThanOrEqual(textBox.y1 - 0.01);
      expect(written!.y).toBeLessThanOrEqual(textBox.y2 + 0.01);
      // The signature is drawn into the document — ink where the blank page has none.
      expect(blank.ink[1]).toBe(0);
      expect(seen.ink[1]).toBeGreaterThan(40);
    }
    await visitor.close();
  });
}

test('the builder is headed by the form’s title in the language it has, not its link address', async ({
  page,
}) => {
  const { organisationId } = await seededForm(sql);
  const stamp = Date.now().toString(36);
  const [form] = await sql`
    insert into forms (organisation_id, slug, title, status, draft_definition)
    values (${organisationId}, ${`english-only-${stamp}`}, ${sql.json({ 'en-GB': 'Only in English' })},
            'draft', ${sql.json({ schemaVersion: 1, fields: [] })})
    returning id
  `;
  const id = String(form!['id']);
  forms.push(id);
  await signInAs(page, sql, 'admin@example.com', 'en-GB');
  await page.goto(`/forms/${id}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Only in English');
});
