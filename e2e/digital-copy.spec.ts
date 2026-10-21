import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { db, openMoreTools, signInAs } from './support.js';
import { see } from './pdf-read.js';
import { copyHtml, copyPages, PAGE_PX, type CopyPage } from '../fixtures/copy/pages.js';

/**
 * The digital copy of a photographed page (Scan, "Make a digital copy"): lines and text only, read
 * on this device. Each synthetic page (`fixtures/copy/pages.ts`) is drawn to a picture by the
 * browser itself, given to Scan as a photograph, read by the real Tesseract from this origin, and
 * its lines found by the line finder. The test proves the copy holds the known lines (counted, and
 * placed), the words that were printed, that a word can be fixed, and that every way of keeping it
 * carries what the screen showed.
 */
const sql = db();
test.afterAll(async () => {
  await sql.end();
});

// Tesseract's language data and its first page take seconds, not milliseconds.
test.setTimeout(240_000);
const READ = { timeout: 150_000 };

async function picture(page: Page, fixture: CopyPage): Promise<Buffer> {
  const sheet = await page.context().newPage();
  await sheet.setViewportSize(PAGE_PX);
  await sheet.setContent(copyHtml(fixture));
  const png = await sheet.screenshot({ type: 'png' });
  await sheet.close();
  return png;
}

/** The words of a PDF as pdf.js extracts them, in Node, with its standard fonts so no text is dropped. */
async function wordsOfPdf(bytes: Buffer): Promise<string[]> {
  const require = createRequire(new URL('../apps/forms/package.json', import.meta.url));
  const pdfjs = (await import(
    pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href
  )) as typeof import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(bytes),
    standardFontDataUrl: `${join(dirname(require.resolve('pdfjs-dist/package.json')), 'standard_fonts')}/`,
  }).promise;
  const content = await (await doc.getPage(1)).getTextContent();
  await doc.loadingTask.destroy();
  return content.items.flatMap((i) => ('str' in i ? i.str.split(/\s+/) : [])).filter(Boolean);
}

const OPEN = { 'en-GB': 'Make a digital copy', 'sv-SE': 'Gör en digital kopia' } as const;

/** Signs in as someone who reads the interface in the page's language, then makes the copy. */
async function makeCopy(page: Page, fixture: CopyPage) {
  await signInAs(page, sql, 'admin@example.com', fixture.locale);
  await page.goto('/scan');
  await page.getByTestId('scan-files').setInputFiles({
    name: `${fixture.name}.png`,
    mimeType: 'image/png',
    buffer: await picture(page, fixture),
  });
  // The page lands in Fix by itself; its More tools are the ones wanted, not Bring in's.
  await expect(page.locator('.scan__page')).toHaveCount(1);
  await openMoreTools(page, fixture.locale);
  await page.getByRole('button', { name: OPEN[fixture.locale] }).click();
  await expect(page.getByTestId('digital-copy')).toBeVisible();
  // The language to read in starts as the interface's own.
  await expect(page.getByTestId('copy-language')).toHaveValue(fixture.locale);
  await expect(page.getByTestId('copy-panes')).toBeVisible(READ);
}

/** The lines on the sheet, as fractions of the page. */
async function foundLines(page: Page) {
  return page.getByTestId('copy-line').evaluateAll((elements) => {
    const sheet = document.querySelector('[data-testid="copy-sheet"]')!;
    const [, , w = 1, h = 1] = (sheet.getAttribute('viewBox') ?? '').split(' ').map(Number);
    return elements.map((e) => ({
      x1: Number(e.getAttribute('x1')) / w,
      y1: Number(e.getAttribute('y1')) / h,
      x2: Number(e.getAttribute('x2')) / w,
      y2: Number(e.getAttribute('y2')) / h,
    }));
  });
}

type Frac = { x1: number; y1: number; x2: number; y2: number };

/** A found line is a known one when it lies on it (a quarter of a percent... of the page: 0.6 %) and covers most of it. */
function same(a: Frac, b: Frac): boolean {
  const horizontal = (l: Frac) => Math.abs(l.y2 - l.y1) < Math.abs(l.x2 - l.x1);
  if (horizontal(a) !== horizontal(b)) return false;
  const [from, to] = horizontal(a) ? (['x1', 'x2'] as const) : (['y1', 'y2'] as const);
  const [across] = horizontal(a) ? (['y1'] as const) : (['x1'] as const);
  if (Math.abs(a[across] - b[across]) > 0.006) return false;
  const overlap = Math.min(a[to], b[to]) - Math.max(a[from], b[from]);
  const union = Math.max(a[to], b[to]) - Math.min(a[from], b[from]);
  return overlap > 0 && overlap >= union * 0.7;
}

const known = (fixture: CopyPage): Frac[] =>
  fixture.rules.map((r) => ({
    x1: r.x1 / PAGE_PX.width,
    y1: r.y1 / PAGE_PX.height,
    x2: r.x2 / PAGE_PX.width,
    y2: r.y2 / PAGE_PX.height,
  }));

const wordsOnSheet = (page: Page) => page.getByTestId('copy-word').allTextContents();

for (const fixture of copyPages) {
  test(`a photographed ${fixture.name}: its lines and its words, side by side with the photograph`, async ({
    page,
  }) => {
    await makeCopy(page, fixture);

    // The photograph is shown, unchanged, beside the copy.
    await expect(page.locator('.copy__photo')).toBeVisible();
    await expect(page.getByTestId('copy-sheet')).toBeVisible();

    // The lines: the right number, in the right places.
    const truth = known(fixture);
    const found = await foundLines(page);
    const hit = truth.filter((t) => found.some((f) => same(f, t))).length;
    const right = found.filter((f) => truth.some((t) => same(f, t))).length;
    const recall = hit / truth.length;
    const precision = right / Math.max(1, found.length);
    console.log(
      `${fixture.name}: ${found.length} lines found for ${truth.length} known; recall ${(recall * 100).toFixed(0)} %, precision ${(precision * 100).toFixed(0)} %`,
    );
    expect(Math.abs(found.length - truth.length)).toBeLessThanOrEqual(
      Math.max(2, Math.round(truth.length * 0.15)),
    );
    expect(recall).toBeGreaterThanOrEqual(0.9);
    expect(precision).toBeGreaterThanOrEqual(0.9);

    // The words: what was printed is on the sheet.
    const words = await wordsOnSheet(page);
    const read = fixture.words.filter((word) => words.includes(word));
    console.log(`${fixture.name}: ${read.length} of ${fixture.words.length} words read exactly`);
    expect(read.length / fixture.words.length).toBeGreaterThanOrEqual(0.85);
  });
}

test('the language can be changed, and the words are the ones the page prints', async ({
  page,
}) => {
  const fixture = copyPages.find((p) => p.locale === 'sv-SE')!;
  await makeCopy(page, fixture);
  const swedish = await wordsOnSheet(page);
  // åäö survive: the reading used the Swedish data, not English alone.
  expect(swedish).toEqual(expect.arrayContaining(['Förnamn', 'för']));

  await page.getByTestId('copy-language').selectOption('en-GB');
  await expect(page.getByTestId('copy-status')).toContainText(/Läser|Reading/);
  await expect(page.getByTestId('copy-status')).not.toContainText(
    /Läser sidan|Reading the page/,
    READ,
  );
  const english = await wordsOnSheet(page);
  expect(english.join(' ')).not.toEqual(swedish.join(' '));
});

test('a word can be fixed before keeping, and every way of keeping carries the fix', async ({
  page,
}) => {
  const fixture = copyPages[0]!;
  await makeCopy(page, fixture);

  // Fix the first word: the copy says it is the person's own, and the sheet shows it.
  await page.getByTestId('copy-word').first().click();
  await expect(page.getByTestId('copy-word-input')).toBeFocused();
  await page.getByTestId('copy-word-input').fill('Fixed');
  await page.getByTestId('copy-word-apply').click();
  await expect(page.getByTestId('copy-word').first()).toHaveText('Fixed');
  await expect(page.getByTestId('copy-word-info')).toContainText('Fixed by you');
  const words = await wordsOnSheet(page);

  // Plain text: the words, in reading order, as the sheet has them.
  const text = page.waitForEvent('download');
  await page.getByTestId('copy-keep-text').click();
  const plain = await readFile((await (await text).path())!, 'utf8');
  expect(plain.split(/\s+/).filter(Boolean)).toEqual(words);

  // SVG: a standalone picture whose text is the same words.
  const svgDownload = page.waitForEvent('download');
  await page.getByTestId('copy-keep-svg').click();
  const svg = await readFile((await (await svgDownload).path())!, 'utf8');
  const inSvg = [...svg.matchAll(/<text [^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);
  expect(inSvg).toEqual(words);
  expect(svg).toContain('<line ');
  expect(svg).not.toContain('copy__doubt');

  // PDF with lines and text: real text, the same words.
  const pdfDownload = page.waitForEvent('download');
  await page.getByTestId('copy-keep-pdf').click();
  const pdf = await readFile((await (await pdfDownload).path())!);
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  const copy = await see(page, pdf, [{ x1: 0, y1: 0, x2: 1, y2: 1 }]);
  expect(await wordsOfPdf(pdf)).toEqual(words);
  expect(copy.ink[0]).toBeGreaterThan(0);

  // Searchable PDF: the photograph is the page, and the same words are in it to search.
  const searchableDownload = page.waitForEvent('download');
  await page.getByTestId('copy-keep-searchable').click();
  const searchable = await readFile((await (await searchableDownload).path())!);
  const seen = await see(page, searchable, [{ x1: 0, y1: 0, x2: 1, y2: 1 }]);
  expect(await wordsOfPdf(searchable)).toEqual(words);
  // The page shows the photograph: much more ink than a bare page, and the words on it are not
  // painted a second time (the text layer is invisible).
  expect(seen.ink[0]).toBeGreaterThan(copy.ink[0]! * 0.5);
});

test('every word the reader was unsure of is marked, and the buttons walk through them by keyboard', async ({
  page,
}) => {
  await makeCopy(page, copyPages[2]!);
  const unsure = Number(await page.getByTestId('copy-panes').getAttribute('data-unsure'));
  const next = page.getByTestId('copy-next-unsure');
  if (unsure === 0) {
    await expect(next).toBeDisabled();
  } else {
    await next.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('copy-word-input')).toBeFocused();
    await expect(page.locator('[data-testid="copy-word"][data-unsure="true"]')).toHaveCount(unsure);
  }
  // A word can be picked by keyboard too: Escape leaves the field.
  await page.getByRole('button', { name: 'Next word', exact: true }).focus();
  await page.keyboard.press('Enter');
  await page.getByTestId('copy-word-input').press('Escape');
  await expect(page.getByTestId('copy-word-input')).toBeDisabled();
});

test('"A form" opens the paper import on the page already read', async ({ page }) => {
  await makeCopy(page, copyPages[1]!);
  await page.getByTestId('copy-keep-form').click();
  await expect(page).toHaveURL(/\/forms\/[^/]+\/import$/);
  // The review opens on its own sentence, without being given a file.
  await expect(page.locator('.review__summary')).toBeVisible(READ);
});
