import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { basename, join, relative } from 'node:path';
import {
  runtimeAssetFor,
  type AiFileStatus,
  type RuntimeAsset,
  type RuntimeManifest,
} from '@tp/shared/ai';
import { AiError } from './engine.js';
import type { ResolveContext } from './resolve.js';
import { searchDirs } from './resolve.js';

/**
 * Finding and checking the program that runs the model (ADR 0025): a pinned `llama-server` folder,
 * looked for in the same places as the model files (`resolve.ts`, kind `runtime`).
 *
 * A folder is accepted when its program is there. For a verified asset every file listed in the
 * manifest is also hashed; the first one missing or changed makes the folder `damaged` and nothing
 * in it is started. For an unverified asset only the program's presence is known, which the
 * status shows as `unpinned`.
 */
export async function sha256Of(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

async function walk(root: string, dir = root): Promise<string[]> {
  const names: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) names.push(...(await walk(root, path)));
    else names.push(relative(root, path).split('\\').join('/'));
  }
  return names.sort();
}

/** The files of a folder as the manifest lists them: for pinning a new release. */
export async function describeFolder(root: string): Promise<RuntimeAsset['contents']> {
  const out: RuntimeAsset['contents'] = [];
  for (const name of await walk(root)) {
    const path = join(root, name);
    out.push({ bytes: (await stat(path)).size, name, sha256: await sha256Of(path) });
  }
  return out;
}

export type RuntimeVerdict = 'ok' | 'unpinned' | 'damaged';

export async function verifyRuntimeFolder(
  dir: string,
  asset: RuntimeAsset,
): Promise<RuntimeVerdict> {
  for (const want of asset.contents) {
    const path = join(dir, want.name);
    const info = await stat(path).catch(() => null);
    if (!info || info.size !== want.bytes || (await sha256Of(path)) !== want.sha256) {
      return 'damaged';
    }
  }
  return asset.verified ? 'ok' : 'unpinned';
}

export interface LocatedRuntime {
  /** The folder. */
  dir: string;
  /** The program. */
  entry: string;
  asset: RuntimeAsset;
  source: ReturnType<typeof searchDirs>[number]['source'];
}

/** The first folder that holds the program for this computer, or null: nothing is pinned or nothing is there. */
export async function locateRuntime(
  context: ResolveContext,
  manifest: RuntimeManifest,
  platform: string = process.platform,
  arch: string = process.arch,
  variant?: 'vulkan',
): Promise<LocatedRuntime | null> {
  const asset = runtimeAssetFor(platform, arch, manifest, variant);
  if (!asset) return null;
  // The graphics build has the CPU build's file names: only its own folder may hold it, never a
  // root or pack folder where the CPU program sits.
  const kind = variant ? 'runtime-vulkan' : 'runtime';
  for (const { dir, source } of searchDirs(kind, context)) {
    if (variant && basename(dir) !== kind) continue;
    const entry = join(dir, asset.entry);
    if ((await stat(entry).catch(() => null))?.isFile()) return { dir, entry, asset, source };
  }
  return null;
}

/**
 * What the engine and the status panel ask about the runtime. A folder is hashed once per
 * session (a verified asset lists its 51 files, about 50 MB) and trusted until the app restarts.
 */
export function createRuntimeChecker(options: {
  context: () => ResolveContext;
  manifest: RuntimeManifest;
  platform?: string;
  arch?: string;
  variant?: 'vulkan';
}) {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const checked = new Map<string, RuntimeVerdict>();

  async function check(): Promise<{ found: LocatedRuntime; verdict: RuntimeVerdict } | null> {
    const found = await locateRuntime(
      options.context(),
      options.manifest,
      platform,
      arch,
      options.variant,
    );
    if (!found) return null;
    let verdict = checked.get(found.dir);
    if (!verdict) {
      verdict = await verifyRuntimeFolder(found.dir, found.asset);
      checked.set(found.dir, verdict);
    }
    return { found, verdict };
  }

  return {
    /** Forget what was checked: a folder was just put there. */
    forget: () => checked.clear(),
    /** The program to start. Rejects with a problem a person can be told: missing, or damaged. */
    async entry(): Promise<string> {
      const result = await check();
      if (!result) {
        throw new AiError(
          'cannot-start',
          `llama-server ${options.manifest.tag} is not on this computer`,
        );
      }
      if (result.verdict === 'damaged') {
        throw new AiError('damaged', 'a file of the runtime does not match the manifest');
      }
      return result.found.entry;
    },

    async status(): Promise<AiFileStatus> {
      const asset = runtimeAssetFor(platform, arch, options.manifest, options.variant);
      const base = {
        role: 'runtime' as const,
        name: `${options.manifest.name} ${options.manifest.tag}`,
        bytes: asset?.bytes ?? 0,
      };
      const result = await check();
      if (!result) return { ...base, path: null, source: null, hash: 'missing' };
      const hash = result.verdict === 'ok' ? 'verified' : result.verdict;
      return { ...base, path: result.found.dir, source: result.found.source, hash };
    },
  };
}
