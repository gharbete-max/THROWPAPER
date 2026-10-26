import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TEXT_MODEL, consentFor } from '@tp/shared/ai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UPDATE_CHECK_CONSENT } from '../addons/release.js';
import { createShellAi } from './shell.js';

let work: string;
beforeEach(async () => {
  work = await mkdtemp(join(tmpdir(), 'loppa-shell-'));
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await rm(work, { recursive: true, force: true });
});

function shell() {
  return createShellAi({
    chooseFile: async () => null,
    userData: join(work, 'user'),
    resources: join(work, 'resources'),
    repoRoot: null,
    emit: () => undefined,
    emitLegacy: () => undefined,
    addons: {
      version: '0.2.0',
      portable: false,
      downloads: join(work, 'Downloads'),
      openPath: async () => '',
      emit: () => undefined,
    },
    env: { LOPPA_FAKE_MODEL: '1' },
  });
}

describe('the shell wires add-ons beside the coordinator', () => {
  it('answers the status of the add-ons from the same folders as the models', async () => {
    const { addons, coordinator } = shell();
    const status = await addons.status();
    expect(status.version).toBe('0.2.0');
    expect(status.update.consent).toEqual(UPDATE_CHECK_CONSENT);
    // The fake model counts as installed, so the pack is not offered.
    expect(status.pack.state).toBe('present');
    await coordinator.close();
  });

  it('keeps a model download and an add-on from running at the same time, both ways', async () => {
    // GitHub never answers, so the update check stays in flight until it is cancelled.
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            // As the real fetch: an already-aborted signal rejects at once.
            if (init?.signal?.aborted) reject(new Error('aborted'));
            init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
          }),
      ),
    );
    const { addons, coordinator } = shell();
    const pending = addons.checkUpdate(UPDATE_CHECK_CONSENT);
    await vi.waitFor(() => expect(addons.working()).toBe(true));

    const consent = consentFor(TEXT_MODEL)!;
    expect(await coordinator.install(TEXT_MODEL.id, consent)).toEqual({
      ok: false,
      problem: 'busy',
    });

    await addons.cancel();
    expect((await pending).ok).toBe(false);
    expect(addons.working()).toBe(false);
    await coordinator.close();
  });
});
