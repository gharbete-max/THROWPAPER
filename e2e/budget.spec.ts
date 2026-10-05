import { expect, test, type Page } from '@playwright/test';
import { db, signInAs } from './support.js';

/**
 * The performance budget, in the browser — `CAVEATS.md` #42 (`perf-budget`), `docs/plan/POLISH.md`
 * S13c. The built app, against a real server: an answer's next question is on the page within a
 * frame (16 ms), and a wait shorter than 150 ms shows no waiting picture at all. (Twenty pages in
 * under four seconds, the ladder's budget and the graph's load are held in `packages/shared`.)
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
const FRAME_MS = 16;
const UNSHOWN_MS = 150;
/**
 * What the measurement of "not before 150 ms" cannot resolve. Chromium coarsens `performance.now()`
 * to a tenth of a millisecond, and the animation's delay runs from a frame's timestamp, not from the
 * moment the picture was put in the page: a run here saw it at 149.9 ms. A millisecond allows for
 * the clock and nothing else — without the delay the picture is seen at 18 ms.
 */
const CLOCK_MS = 1;

async function startFromQuestions(page: Page): Promise<string> {
  await page.goto('/forms');
  await page.getByRole('button', { name: 'New form' }).first().click();
  await page.getByRole('button', { name: /Start from questions/ }).click();
  await expect(page).toHaveURL(GUIDED);
  const formId = GUIDED.exec(page.url())![1]!;
  created.push(formId);
  await expect(
    page.getByRole('heading', { level: 1, name: 'What is this form for?' }),
  ).toBeVisible();
  return formId;
}

/**
 * An answer card pressed, and the time until the next question is on the page: the machine's step
 * and React's render and commit, measured in the page from the press to the heading changing.
 */
function timedPress(page: Page, answerId: string): Promise<number> {
  return page.evaluate(
    (id) =>
      new Promise<number>((resolve, reject) => {
        const before = document.querySelector('h1')?.textContent;
        const card = document.querySelector<HTMLElement>(`[data-answer-id="${id}"]`);
        if (!card) return reject(new Error(`no answer ${id}`));
        const observer = new MutationObserver(() => {
          if (document.querySelector('h1')?.textContent === before) return;
          observer.disconnect();
          resolve(performance.now() - start);
        });
        observer.observe(document.body, { subtree: true, childList: true, characterData: true });
        const start = performance.now();
        card.click();
      }),
    answerId,
  );
}

test('the next question is on the page within a frame of the answer (16 ms)', async ({ page }) => {
  await signInAs(page, sql, 'admin@example.com', 'en-GB');
  await startFromQuestions(page);
  const times: number[] = [];
  const press = async (answerId: string) => times.push(await timedPress(page, answerId));
  const write = async (words: string) => {
    await page.getByRole('textbox', { name: /.+/ }).first().fill(words);
    await page.getByRole('button', { name: 'Continue' }).click();
  };

  await press('signup');
  await press('unsure');
  await press('unsure');
  await write('Summer party');
  await press('later');
  await write('Which day suits you?');
  await press('yes'); // needed
  await press('yes'); // buttons
  await press('one');
  await page.getByRole('button', { name: 'Continue' }).click();
  await press('pill');
  await press('under-full');

  const sorted = [...times].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)]!;
  expect(times).toHaveLength(9);
  expect(median, `each press: ${times.map((t) => t.toFixed(1)).join(', ')} ms`).toBeLessThan(
    FRAME_MS,
  );
});

/**
 * Every waiting picture the page puts up, from the moment it is in the page (a mutation, exact) to
 * the first frame it can be seen (sampled each frame), and when it goes.
 */
async function watchTheWaits(page: Page) {
  await page.addInitScript(() => {
    type Wait = { mounted: number; shown: number | null; gone: number | null };
    const waits: Wait[] = [];
    const seen = new Map<Element, Wait>();
    (window as unknown as { __waits: Wait[] }).__waits = waits;
    const note = (el: Element) => {
      if (seen.has(el)) return;
      const wait = { mounted: performance.now(), shown: null, gone: null };
      seen.set(el, wait);
      waits.push(wait);
    };
    new MutationObserver(() => {
      document.querySelectorAll('.loading').forEach(note);
      for (const [el, wait] of seen)
        if (!el.isConnected && wait.gone === null) {
          wait.gone = performance.now();
        }
    }).observe(document, { subtree: true, childList: true });
    const frame = () => {
      for (const [el, wait] of seen) {
        if (wait.shown === null && el.isConnected && Number(getComputedStyle(el).opacity) > 0) {
          wait.shown = performance.now();
        }
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
}

type Wait = { mounted: number; shown: number | null; gone: number | null };
const waitsOf = (page: Page) =>
  page.evaluate(() => (window as unknown as { __waits: Wait[] }).__waits);

test('a wait under 150 ms shows no waiting picture; a longer one shows it', async ({ page }) => {
  await signInAs(page, sql, 'admin@example.com', 'en-GB');
  const formId = await startFromQuestions(page);
  await page.getByRole('button', { name: /Signing people up/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: /set date/ })).toBeVisible();
  // Saved, so the conversation read again comes back at the same question.
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();

  // The conversation read again, its session answered after 600 ms: the picture is shown — and
  // not before it has waited 150 ms.
  await watchTheWaits(page);
  await page.route('**/v1/forms/*/builder-session', async (route) => {
    if (route.request().method() === 'GET') await new Promise((done) => setTimeout(done, 600));
    await route.continue();
  });
  await page.goto(`/forms/${formId}/guided`);
  await expect(page.getByRole('heading', { level: 1, name: /set date/ })).toBeVisible();
  const slow = await waitsOf(page);
  expect(
    slow.some((wait) => wait.shown !== null),
    JSON.stringify(slow),
  ).toBe(true);
  for (const wait of slow) {
    if (wait.shown !== null)
      expect(wait.shown - wait.mounted).toBeGreaterThanOrEqual(UNSHOWN_MS - CLOCK_MS);
  }

  // Answered at once: every wait that ended inside 150 ms was never seen.
  await page.unroute('**/v1/forms/*/builder-session');
  await page.goto(`/forms/${formId}/guided`);
  await expect(page.getByRole('heading', { level: 1, name: /set date/ })).toBeVisible();
  const quick = await waitsOf(page);
  expect(quick.length, 'the page waited for something').toBeGreaterThan(0);
  for (const wait of quick) {
    if (wait.gone !== null && wait.gone - wait.mounted < UNSHOWN_MS - CLOCK_MS) {
      expect(wait.shown).toBeNull();
    }
    if (wait.shown !== null)
      expect(wait.shown - wait.mounted).toBeGreaterThanOrEqual(UNSHOWN_MS - CLOCK_MS);
  }
});
