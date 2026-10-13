import { expect, test, type Page } from '@playwright/test';
import { db, plantLoginToken } from './support.js';

/**
 * The summary and translation centre (ADR 0023, `docs/plan/DOCUMENTS.md` section 4).
 *
 * The page is the real built Forms app. The desktop shell's `window.loppaModel` is a fake with the
 * same interface, installed before the page loads: no model, no 2.5 GB, but every screen and every
 * rule of the pane runs — the settings step, the confirmation before a download, streaming, cancel,
 * the digit warning, the language limits, and "quote, never reword" for a consent.
 */
const sql = db();
test.afterAll(async () => {
  await sql.end();
});

/** A bridge double: events are real, the "model" is a few lines of arithmetic on the input. */
function fakeBridge() {
  const listeners: Array<(event: unknown) => void> = [];
  const emit = (event: unknown) => listeners.forEach((listener) => listener(event));
  const bytes = 2497281120;
  const w = window as unknown as Record<string, unknown>;
  const state = {
    installed: false,
    jobs: 0,
    cancelled: new Set<string>(),
    requests: [] as unknown[],
  };
  w.__fake = state;
  const status = () => ({
    id: 'fake',
    licence: 'Apache-2.0',
    bytes,
    installed: state.installed,
    location: state.installed ? 'C:\\Models\\fake.gguf' : null,
    verified: state.installed,
    damaged: false,
    downloadBlocked: 'the release has not been cut yet',
    freeMemoryBytes: 16e9,
    requiredMemoryBytes: 5e9,
    activity: 'idle',
  });
  w.loppaModel = {
    status: () => Promise.resolve(status()),
    install: () => Promise.resolve({ ok: false, problem: 'download-unavailable' }),
    openFromDisk: () => {
      setTimeout(() => {
        emit({ id: 'install', kind: 'install', phase: 'verify', done: bytes / 2, total: bytes });
        state.installed = true;
        setTimeout(() => emit({ id: 'install', kind: 'installed', status: status() }), 50);
      }, 20);
      return Promise.resolve({ ok: true, id: 'install' });
    },
    remove: () => {
      state.installed = false;
      return Promise.resolve(status());
    },
    start: (
      id: string,
      job: { kind: string; text?: string; passages?: string[]; into?: string },
    ) => {
      state.requests.push(job);
      state.jobs += 1;
      const run = async () => {
        await new Promise((r) => setTimeout(r, 30));
        emit({ id, kind: 'step', step: 'loading', done: 1, total: 1 });
        if (job.kind === 'select') {
          emit({ id, kind: 'selected', numbers: [2] });
          emit({ id, kind: 'done', warnings: [], seconds: 1 });
          return;
        }
        const pieces =
          job.kind === 'translate'
            ? [`[${job.into}] `, job.text ?? '']
            : ['- First point. ', '- Second point 2027. '];
        let shown = '';
        for (const piece of pieces) {
          if (state.cancelled.has(id)) {
            emit({ id, kind: 'error', problem: 'cancelled' });
            return;
          }
          shown += piece;
          emit({ id, kind: 'text', mode: 'replace', text: shown });
          await new Promise((r) => setTimeout(r, job.text === 'slow' ? 400 : 20));
        }
        emit({
          id,
          kind: 'done',
          warnings: job.kind === 'summarise' ? [{ kind: 'numbers-added', numbers: ['2027'] }] : [],
          seconds: 2,
        });
      };
      void run();
      return Promise.resolve({ ok: true, id });
    },
    cancel: (id: string) => {
      state.cancelled.add(id);
      return Promise.resolve();
    },
    onEvent: (listener: (event: unknown) => void) => {
      listeners.push(listener);
      return () => listeners.splice(listeners.indexOf(listener), 1);
    },
  };
}

async function signIn(page: Page) {
  const secret = await plantLoginToken(sql, 'admin@example.com');
  await page.goto(`/auth/callback?token=${secret}`);
  await expect(page.getByRole('link', { name: 'Documents' })).toBeVisible();
}

test('without the desktop bridge the centre says it is not in this edition', async ({ page }) => {
  await signIn(page);
  await page.goto('/summary');
  await expect(page.getByRole('heading', { name: 'Summary and translation' })).toBeVisible();
  await expect(page.getByText('Not in this edition')).toBeVisible();
});

test('set up from a file on disk, summarise, translate, cancel, and see the limits', async ({
  page,
}) => {
  await page.addInitScript(fakeBridge);
  await signIn(page);
  await page.goto('/summary');

  // Settings step first: nothing is downloaded, and the download says why it is off.
  await expect(page.getByRole('heading', { name: 'The model' })).toBeVisible();
  await expect(page.getByText('The model is not on this computer.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Get the model' })).toBeDisabled();
  await expect(page.getByText(/the model has not been published/)).toBeVisible();
  await page.getByRole('button', { name: 'Open a model file from disk' }).click();
  await expect(page.getByRole('heading', { name: 'What to read' })).toBeVisible();
  await expect(page.getByText('The model is ready.')).toHaveCount(0);

  // A summary of pasted text streams in, is labelled as generated, and warns about an invented year.
  await page
    .getByLabel('Paste the text here')
    .fill('The fee is 120 kronor.\n\nPayment is due 2026-04-18.');
  await page.getByRole('button', { name: 'Start' }).click();
  const result = page.getByTestId('summary-result');
  await expect(
    result.getByRole('heading', { name: 'Summary — generated on this computer' }),
  ).toBeVisible();
  await expect(result).toContainText('Second point 2027.');
  await expect(result).toContainText('Numbers in the result that are not in the original: 2027');
  await expect(result).toContainText('It is not saved');

  // Icelandic cannot be written, with a reason; translating is a draft.
  const language = page.getByLabel('Into');
  await expect(language.locator('option[value="is-IS"]')).toHaveAttribute('disabled', '');
  await page.getByLabel('Translate').check();
  await expect(language.locator('option[value="is-IS"]')).toHaveAttribute('disabled', '');
  await language.selectOption('sv-SE');
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page.getByRole('heading', { name: 'Machine translation — draft' })).toBeVisible();
  await expect(page.getByTestId('summary-result')).toContainText('[sv-SE] The fee is 120 kronor.');

  // Cancel in the middle.
  await page.getByLabel('Paste the text here').fill('slow');
  await page.getByRole('button', { name: 'Start' }).click();
  await page.getByRole('button', { name: 'Stop' }).click();
  await expect(page.getByText('Stopped.')).toBeVisible();

  // Nothing was sent to the server: no request carried the text.
  const sent = await page.evaluate(
    () => (window as unknown as { __fake: { jobs: number } }).__fake.jobs,
  );
  expect(sent).toBe(3);
});

test('a consent is quoted, never summarised or translated', async ({ page }) => {
  await page.addInitScript(fakeBridge);
  await signIn(page);
  await page.goto('/summary');
  await page.getByRole('button', { name: 'Open a model file from disk' }).click();
  await expect(page.getByRole('heading', { name: 'What to read' })).toBeVisible();

  const consent =
    'Consent: I consent to my personal data being processed.\n\nI can withdraw my consent at any time, by writing to the club within 30 days.\n\nThe club keeps nothing else.';
  await page.getByLabel('Paste the text here').fill(consent);
  await expect(page.getByText(/It is not summarised or translated/)).toBeVisible();
  await expect(page.getByLabel('Into')).toHaveCount(0);
  await page.getByRole('button', { name: 'Pick out the passages to read first' }).click();

  const result = page.getByTestId('summary-result');
  await expect(result.getByRole('heading', { name: 'Passages to read first' })).toBeVisible();
  // Exactly the original words of passage 2, cut from the pasted text.
  await expect(result.locator('blockquote')).toHaveText(
    'I can withdraw my consent at any time, by writing to the club within 30 days.',
  );
  const requests = await page.evaluate(
    () => (window as unknown as { __fake: { requests: Array<{ kind: string }> } }).__fake.requests,
  );
  expect(requests.map((r) => r.kind)).toEqual(['select']);
});
