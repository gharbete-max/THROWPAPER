import { expect, test, type Page } from '@playwright/test';
import { db, signInAs } from './support.js';
import { fakeBridge } from './fake-model.js';

/**
 * "Add-ons and updates" (ADR 0026, amended): the page that holds everything optional, so nobody
 * leaves the app to find files. The real built Forms app, with the desktop shell's `window.loppaAddons`
 * faked (same interface, no network): what is under test is the page, its words, its confirmations
 * naming the host, and that nothing is asked of the shell until a press and a yes.
 */
const sql = db();
test.afterAll(async () => {
  await sql.end();
});

interface Seed {
  platform?: string;
  program?: 'included' | 'installed' | 'missing' | 'unavailable';
  tested?: boolean;
  pack?: 'present' | 'missing';
  portable?: boolean;
  check?: unknown;
  installerFails?: boolean;
  downloaded?: string | null;
}

/** Stands alone: it is serialised into the page. */
function addonsFake(seed: Seed) {
  const w = window as unknown as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const listeners: Array<(event: unknown) => void> = [];
  const emit = (event: unknown) => listeners.forEach((l) => l(event));
  const calls = {
    program: [] as unknown[],
    pack: [] as unknown[],
    check: [] as unknown[],
    installer: [] as unknown[],
    open: 0,
    cancel: 0,
    status: 0,
  };
  w.__addons = calls;
  const state = {
    version: '0.2.0',
    platform: seed.platform ?? 'win32',
    arch: 'x64',
    program: {
      state: seed.program ?? 'included',
      name: 'llama.cpp llama-server b11741',
      bytes: 12324422,
      tested: seed.tested ?? true,
      consent:
        (seed.program ?? 'included') === 'missing'
          ? {
              host: 'github.com',
              files: ['llama-b11741-bin-macos-arm64.tar.gz'],
              totalBytes: 12324422,
            }
          : null,
      folder: '/Users/me/Library/Application Support/Loppa/models/runtime',
    },
    pack: {
      state: seed.pack ?? 'missing',
      bytes: 6890354656,
      consent:
        (seed.pack ?? 'missing') === 'missing'
          ? {
              host: 'github.com',
              files: [
                'Qwen2.5-VL-7B-Instruct-Q4_K_M.gguf',
                'mmproj-Qwen2.5-VL-7B-Instruct-f16.gguf',
                'mmproj-Qwen2.5-VL-7B-Instruct-Q8_0.gguf',
              ],
              totalBytes: 6890354656,
            }
          : null,
    },
    update: {
      consent: { host: 'api.github.com', files: [], totalBytes: 0 },
      portable: seed.portable ?? false,
      downloaded: seed.downloaded ?? null,
    },
  };
  const task = (name: string, bytes: number, finish: () => void, fails?: string) => {
    setTimeout(() => emit({ kind: 'progress', task: name, done: bytes / 2, total: bytes }), 10);
    setTimeout(() => {
      if (fails) emit({ kind: 'failed', task: name, problem: fails });
      else {
        finish();
        emit({ kind: 'done', task: name, status: structuredClone(state) });
      }
    }, 80);
    return { ok: true };
  };
  w.loppaAddons = {
    status: async () => {
      calls.status += 1;
      return structuredClone(state);
    },
    installProgram: async (consent: unknown) => {
      calls.program.push(consent);
      return task('program', 12324422, () => {
        state.program.state = 'installed';
        state.program.consent = null;
      });
    },
    installPack: async (consent: unknown) => {
      calls.pack.push(consent);
      return task('pack', 6890354656, () => {
        state.pack.state = 'present';
        state.pack.consent = null;
      });
    },
    checkUpdate: async (consent: unknown) => {
      calls.check.push(consent);
      return seed.check;
    },
    downloadInstaller: async (consent: unknown) => {
      calls.installer.push(consent);
      return task(
        'installer',
        181254896,
        () => {
          state.update.downloaded = 'C:\\Users\\me\\Downloads\\Loppa-Windows-Setup-9.9.9.exe';
        },
        seed.installerFails ? 'not-the-listed-file' : undefined,
      );
    },
    openInstaller: async () => {
      calls.open += 1;
      return { ok: true };
    },
    cancel: async () => {
      calls.cancel += 1;
    },
    onEvent: (listener: (event: unknown) => void) => {
      listeners.push(listener);
      return () => undefined;
    },
  };
}

const NEWER = {
  ok: true,
  current: '0.2.0',
  latest: '9.9.9',
  newer: true,
  notes: 'What is new\n- Add-ons and updates',
  page: 'https://github.com/gharbete-max/THROWPAPER/releases/tag/desktop-v9.9.9',
  installer: {
    name: 'Loppa-Windows-Setup.exe',
    bytes: 181254896,
    consent: { host: 'github.com', files: ['Loppa-Windows-Setup.exe'], totalBytes: 181254896 },
  },
};

async function open(page: Page, seed: Seed = {}) {
  await page.addInitScript(fakeBridge);
  await page.addInitScript(addonsFake, seed);
  await signInAs(page, sql, 'admin@example.com', 'en-GB');
  await page.goto('/ai-setup');
  await expect(page.getByRole('heading', { name: 'Add-ons and updates', level: 1 })).toBeVisible();
}

const calls = (page: Page) =>
  page.evaluate(
    () =>
      (window as never as { __addons: Record<string, unknown> }).__addons as {
        program: unknown[];
        pack: unknown[];
        check: unknown[];
        installer: unknown[];
        open: number;
        cancel: number;
      },
  );

const row = (page: Page, name: string) => page.locator(`[data-addon="${name}"]`);

test('the page lists the program, the pack and the update check, and asks nothing of the shell by itself @smoke', async ({
  page,
}) => {
  await open(page);
  await expect(page.getByRole('heading', { name: 'AI models on this computer' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Program, pack and updates' })).toBeVisible();
  await expect(row(page, 'program')).toContainText('AI program');
  await expect(row(page, 'program')).toContainText('Included with Loppa.');
  await expect(row(page, 'program').getByRole('button')).toHaveCount(0);
  await expect(row(page, 'pack')).toContainText('computers that cannot reach Hugging Face');
  await expect(page.getByRole('button', { name: 'Get the AI pack (about 6.9 GB)' })).toBeEnabled();
  await expect(row(page, 'update')).toContainText('You have version 0.2.0.');
  await expect(row(page, 'update')).toContainText('never looks for updates by itself');
  await expect(page.getByRole('button', { name: 'Check for a new version' })).toBeEnabled();
  const c = await calls(page);
  expect([c.program, c.pack, c.check, c.installer].map((x) => x.length)).toEqual([0, 0, 0, 0]);
  expect(c.open).toBe(0);
});

test('on a Mac the program is fetched after a confirmation naming github.com, the file and the size', async ({
  page,
}) => {
  await open(page, { platform: 'darwin', program: 'missing', tested: false });
  await expect(row(page, 'program')).toContainText('Not tested on this kind of computer yet');
  await page.getByRole('button', { name: 'Get the AI program' }).click();
  const dialog = page.getByRole('dialog', { name: 'Confirm' });
  await expect(dialog).toContainText('github.com');
  await expect(dialog).toContainText('llama-b11741-bin-macos-arm64.tar.gz');
  await expect(dialog).toContainText('12 MB');
  await expect(dialog).toContainText('Your documents are not sent anywhere');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  expect((await calls(page)).program).toHaveLength(0);

  await page.getByRole('button', { name: 'Get the AI program' }).click();
  await dialog.getByRole('button', { name: 'Download' }).click();
  expect((await calls(page)).program).toEqual([
    { host: 'github.com', files: ['llama-b11741-bin-macos-arm64.tar.gz'], totalBytes: 12324422 },
  ]);
  await expect(page.getByRole('progressbar')).toBeVisible();
  await expect(row(page, 'program')).toContainText('On this computer.');
  // The result still says it has not been tried on this kind of computer.
  await expect(row(page, 'program')).toContainText('Not tested on this kind of computer yet');
  await expect(row(page, 'program').getByRole('button')).toHaveCount(0);
});

test('where no program is pinned the row says so and offers nothing', async ({ page }) => {
  await open(page, { platform: 'freebsd', program: 'unavailable', tested: false });
  await expect(row(page, 'program')).toContainText('no AI program for this kind of computer');
  await expect(row(page, 'program').getByRole('button')).toHaveCount(0);
});

test('the AI pack is fetched only after a confirmation with github.com and the whole size', async ({
  page,
}) => {
  await open(page);
  const get = page.getByRole('button', { name: 'Get the AI pack (about 6.9 GB)' });
  await get.click();
  const dialog = page.getByRole('dialog', { name: 'Confirm' });
  await expect(dialog).toContainText('github.com');
  await expect(dialog).toContainText('6890 MB');
  await expect(dialog).toContainText('Qwen2.5-VL-7B-Instruct-Q4_K_M.gguf');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  expect((await calls(page)).pack).toHaveLength(0);

  await get.click();
  await dialog.getByRole('button', { name: 'Download' }).click();
  expect((await calls(page)).pack).toHaveLength(1);
  // Cancel is there while it runs.
  await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible();
  await expect(row(page, 'pack')).toContainText('already on this computer');
  await expect(get).toHaveCount(0);
});

test('the update check asks first, names api.github.com, and says which version is newest', async ({
  page,
}) => {
  await open(page, { check: NEWER });
  const check = page.getByRole('button', { name: 'Check for a new version' });
  await check.click();
  const dialog = page.getByRole('dialog', { name: 'Confirm' });
  await expect(dialog).toContainText('api.github.com');
  await expect(dialog).toContainText('Nothing is sent except the request itself');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  expect((await calls(page)).check).toHaveLength(0);

  await check.click();
  await dialog.getByRole('button', { name: 'Check' }).click();
  expect((await calls(page)).check).toEqual([{ host: 'api.github.com', files: [], totalBytes: 0 }]);
  await expect(page.getByText('Version 9.9.9 is available.')).toBeVisible();
  await expect(row(page, 'update')).toContainText('Add-ons and updates');
  // Pre-wrapped release notes keep their lines.
  await expect(row(page, 'update').locator('.addon__notes')).toContainText('What is new');
  expect((await calls(page)).installer).toHaveLength(0);
});

test('the installer is downloaded after a confirmation, then offered to open, and never opened by itself', async ({
  page,
}) => {
  await open(page, { check: NEWER });
  await page.getByRole('button', { name: 'Check for a new version' }).click();
  const dialog = page.getByRole('dialog', { name: 'Confirm' });
  await dialog.getByRole('button', { name: 'Check' }).click();

  const get = page.getByRole('button', {
    name: 'Download the installer for this computer (181 MB)',
  });
  await get.click();
  await expect(dialog).toContainText('github.com');
  await expect(dialog).toContainText('Loppa-Windows-Setup.exe');
  await expect(dialog).toContainText('181 MB');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  expect((await calls(page)).installer).toHaveLength(0);

  await get.click();
  await dialog.getByRole('button', { name: 'Download' }).click();
  expect((await calls(page)).installer).toEqual([NEWER.installer.consent]);
  await expect(page.getByText('matches its published fingerprint')).toBeVisible();
  expect((await calls(page)).open).toBe(0);
  await page.getByRole('button', { name: 'Open the installer' }).click();
  expect((await calls(page)).open).toBe(1);
});

test('a download that does not match its fingerprint is reported plainly and nothing can be opened', async ({
  page,
}) => {
  await open(page, { check: NEWER, installerFails: true });
  await page.getByRole('button', { name: 'Check for a new version' }).click();
  await page
    .getByRole('dialog', { name: 'Confirm' })
    .getByRole('button', { name: 'Check' })
    .click();
  await page.getByRole('button', { name: /Download the installer/ }).click();
  await page
    .getByRole('dialog', { name: 'Confirm' })
    .getByRole('button', { name: 'Download' })
    .click();
  await expect(page.getByRole('alert')).toContainText('did not match its published fingerprint');
  await expect(page.getByRole('button', { name: 'Open the installer' })).toHaveCount(0);
});

test('the newest version, no installer for this computer, and the portable program each say what to do', async ({
  page,
}) => {
  await open(page, { check: { ...NEWER, newer: false, latest: '0.2.0', installer: null } });
  await page.getByRole('button', { name: 'Check for a new version' }).click();
  await page
    .getByRole('dialog', { name: 'Confirm' })
    .getByRole('button', { name: 'Check' })
    .click();
  await expect(page.getByText('You have the newest version.')).toBeVisible();
  await expect(page.getByRole('button', { name: /Download the installer/ })).toHaveCount(0);
});

test('a Mac and the portable program are told how to use the saved file', async ({ page }) => {
  await open(page, { platform: 'darwin', downloaded: '/Users/me/Downloads/Loppa.dmg' });
  await expect(row(page, 'update')).toContainText('drag Loppa to Applications');
  await expect(page.getByRole('button', { name: 'Open the installer' })).toBeVisible();
});

test('the portable program is told to close Loppa and run the new file', async ({ page }) => {
  await open(page, { portable: true, downloaded: 'C:\\Users\\me\\Downloads\\Loppa-Portable.exe' });
  await expect(row(page, 'update')).toContainText('You use the portable program');
});

test('GitHub being unreachable is said in words', async ({ page }) => {
  await open(page, { check: { ok: false, problem: 'offline' } });
  await page.getByRole('button', { name: 'Check for a new version' }).click();
  await page
    .getByRole('dialog', { name: 'Confirm' })
    .getByRole('button', { name: 'Check' })
    .click();
  await expect(page.getByRole('alert')).toContainText('GitHub could not be reached');
});

test('at a phone width nothing runs off the page and the buttons are usable targets', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await open(page, { platform: 'darwin', program: 'missing', tested: false, check: NEWER });
  const wide = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(wide).toBeLessThanOrEqual(0);
  for (const name of [
    'Get the AI program',
    'Get the AI pack (about 6.9 GB)',
    'Check for a new version',
  ]) {
    const box = await page.getByRole('button', { name }).boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(24);
    expect(box!.x + box!.width).toBeLessThanOrEqual(360);
  }
});

test('in Swedish the page and its confirmation are in Swedish', async ({ page }) => {
  await page.addInitScript(fakeBridge);
  await page.addInitScript(addonsFake, { check: NEWER });
  await signInAs(page, sql, 'admin@example.com', 'sv-SE');
  await page.goto('/ai-setup');
  await expect(
    page.getByRole('heading', { name: 'Till\u00e4gg och uppdateringar', level: 1 }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Leta efter en ny version' }).click();
  await expect(page.getByRole('dialog')).toContainText('api.github.com');
});

test.describe('the first-run note in the room', () => {
  async function room(page: Page) {
    await page.route('**/health', async (route) => {
      const response = await route.fetch();
      await route.fulfill({ response, json: { ...(await response.json()), edition: 'desktop' } });
    });
    await page.addInitScript(fakeBridge);
    await page.addInitScript(addonsFake, {});
    await signInAs(page, sql, 'admin@example.com', 'en-GB');
    await page.goto('/room');
  }

  test('says AI is optional, links to Add-ons and updates, and stays hidden once dismissed', async ({
    page,
  }) => {
    await room(page);
    const note = page.locator('[data-ai-hint]');
    await expect(note).toContainText('AI is optional \u2014 set it up when you want to.');
    // It is not a dialog and does not take focus.
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await note.getByRole('link', { name: 'Add-ons and updates' }).click();
    await expect(
      page.getByRole('heading', { name: 'Add-ons and updates', level: 1 }),
    ).toBeVisible();

    await page.goto('/room');
    await page.getByRole('button', { name: 'Hide this note' }).click();
    await expect(note).toHaveCount(0);
    await page.reload();
    await expect(page.locator('[data-ai-hint]')).toHaveCount(0);
    // The corner link is still there.
    await expect(page.getByRole('link', { name: 'Add-ons and updates' })).toBeVisible();
  });

  test('is not shown when local storage refuses to answer: it simply shows again', async ({
    page,
  }) => {
    // Only this note's key refuses (a blocked or full store); signing in still works.
    await page.addInitScript(() => {
      for (const method of ['getItem', 'setItem'] as const) {
        const original = Storage.prototype[method];
        Storage.prototype[method] = function (this: Storage, key: string, value?: string) {
          if (key === 'loppa.addonsHint.dismissed') throw new Error('blocked');
          return (original as (k: string, v?: string) => string | null | void).call(
            this,
            key,
            value,
          );
        } as never;
      }
    });
    await room(page);
    await expect(page.locator('[data-ai-hint]')).toBeVisible();
    await page.getByRole('button', { name: 'Hide this note' }).click();
    await expect(page.locator('[data-ai-hint]')).toHaveCount(0);
  });

  test('is not shown in the web edition', async ({ page }) => {
    await page.addInitScript(fakeBridge);
    await signInAs(page, sql, 'admin@example.com', 'en-GB');
    await page.goto('/room');
    await expect(page.locator('.room__bar')).toBeVisible();
    await expect(page.locator('[data-ai-hint]')).toHaveCount(0);
  });
});
