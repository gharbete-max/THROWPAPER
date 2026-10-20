import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  LLAMA_SERVER,
  graphicsConsentFor,
  runtimeAssetFor,
  type AiConsent,
  type AiGraphics,
  type GraphicsFailure,
  type RuntimeManifest,
} from '@tp/shared/ai';
import type { OnProgress } from './download.js';
import type { GpuHook } from './engines/server-engine.js';
import type { ResolveContext } from './resolve.js';
import { fetchRuntime } from './runtime-fetch.js';
import { createRuntimeChecker } from './runtime.js';

/**
 * The optional "use the graphics card" setting (ADR 0025, docs/plan/VISION-TUNING.md §5): off until
 * the person turns it on, and then used only while the Vulkan program is on this computer and whole
 * and no failure is remembered. Two small facts are kept in `graphics.json` beside the models:
 * whether it is on, and why the card was last given up on (until the person clears that).
 *
 * The program comes from the AI pack or a folder the person filled by hand (`runtime-vulkan` in any
 * place the model files are looked for, offline), or from the release page after a confirmation
 * that names the host, the file and the size (ADR 0026). Nothing here fetches on its own.
 */
export interface GraphicsDeps {
  /** Loppa's folder for downloaded files (`<userData>/models`): the settings file and the download go here. */
  dir: string;
  context: () => ResolveContext;
  manifest?: RuntimeManifest;
  platform?: string;
  arch?: string;
}

interface Saved {
  enabled: boolean;
  failure: GraphicsFailure | null;
}

const FAILURES: readonly GraphicsFailure[] = [
  'no-device',
  'out-of-memory',
  'start-failed',
  'request-failed',
];

export function createGraphics(deps: GraphicsDeps) {
  const manifest = deps.manifest ?? LLAMA_SERVER;
  const platform = deps.platform ?? process.platform;
  const arch = deps.arch ?? process.arch;
  const file = join(deps.dir, 'graphics.json');
  const asset = runtimeAssetFor(platform, arch, manifest, 'vulkan');
  const support: AiGraphics['support'] = asset
    ? 'available'
    : platform === 'darwin'
      ? 'later'
      : 'none';
  const checker = createRuntimeChecker({
    manifest,
    context: deps.context,
    platform,
    arch,
    variant: 'vulkan',
  });
  let ranOn: AiGraphics['ranOn'] = null;
  let device: string | null = null;

  async function read(): Promise<Saved> {
    return readFile(file, 'utf8')
      .then((text): Saved => {
        const v = JSON.parse(text) as { enabled?: unknown; failure?: unknown };
        return {
          enabled: v.enabled === true,
          failure: FAILURES.find((f) => f === v.failure) ?? null,
        };
      })
      .catch(() => ({ enabled: false, failure: null }));
  }

  async function write(saved: Saved): Promise<void> {
    await mkdir(deps.dir, { recursive: true });
    await writeFile(file, JSON.stringify(saved), 'utf8');
  }

  /** The program is here and every file of it matches the manifest. */
  async function present(): Promise<boolean> {
    return (await checker.status()).hash === 'verified';
  }

  const hook: GpuHook = {
    async entry() {
      if (!asset) return null;
      const saved = await read();
      if (!saved.enabled || saved.failure) return null;
      return checker.entry().catch(() => null);
    },
    async failed(reason) {
      await write({ ...(await read()), failure: reason });
    },
    ranOn(on, name) {
      ranOn = on;
      device = name;
    },
  };

  return {
    hook,
    async status(): Promise<AiGraphics> {
      const saved = await read();
      const here = support === 'available' && (await present());
      return {
        support,
        enabled: support === 'available' && saved.enabled,
        present: here,
        consent:
          support === 'available' && !here ? graphicsConsentFor(platform, arch, manifest) : null,
        folder: join(deps.dir, 'runtime-vulkan'),
        failure: saved.failure,
        ranOn,
        device,
      };
    },
    /** Turning it on needs the program; without it nothing changes (the caller then asks about the download). */
    async setEnabled(on: boolean): Promise<void> {
      if (support !== 'available') return;
      checker.forget(); // a folder may have been put there by hand since
      if (on && !(await present())) return;
      await write({ enabled: on, failure: on ? (await read()).failure : null });
    },
    async clearFailure(): Promise<void> {
      await write({ ...(await read()), failure: null });
    },
    consentMatches(given: AiConsent): boolean {
      const wanted = graphicsConsentFor(platform, arch, manifest);
      return (
        wanted !== null &&
        given.host === wanted.host &&
        given.totalBytes === wanted.totalBytes &&
        given.files.length === wanted.files.length &&
        wanted.files.every((name, i) => given.files[i] === name)
      );
    },
    /** Fetches, verifies and puts the program in place, then turns the setting on. Rejects on any failure. */
    async install(options: {
      fetch: typeof fetch;
      signal?: AbortSignal;
      onProgress?: OnProgress;
    }): Promise<void> {
      if (!asset) throw new Error('no graphics-card build is pinned for this computer');
      await fetchRuntime({ asset, dir: join(deps.dir, 'runtime-vulkan'), ...options });
      checker.forget();
      await write({ enabled: true, failure: null });
    },
  };
}

export type Graphics = ReturnType<typeof createGraphics>;
