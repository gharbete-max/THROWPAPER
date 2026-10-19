import { z } from 'zod';
import llamaServer from './runtimes/llama-server.json';

/**
 * The runtime manifest: the one program that runs the model (ADR 0025). A pinned release of
 * llama.cpp's `llama-server` (MIT), fetched by `apps/desktop/scripts/fetch-runtime.ts`, checked
 * against the hashes here and never committed.
 *
 * Like the model manifests (ADR 0021): JSON, provenance as fields, validated on load. An asset is
 * `verified` when it was downloaded, hashed and run on that platform by this project, and then it
 * lists every file of the extracted folder with its hash, so the desktop can check the folder before
 * it starts anything in it. Any other asset carries only the hash the release page gave and is
 * **UNVERIFIED**: it is listed so the pin exists, not because it is known to work.
 */
const Sha256 = z.string().regex(/^[0-9a-f]{64}$/, 'a lower-case SHA-256');

export const RuntimeContent = z
  .object({
    bytes: z.number().int().nonnegative(),
    name: z.string().min(1),
    sha256: Sha256,
  })
  .strict();

export const RuntimeAsset = z
  .object({
    bytes: z.number().int().positive(),
    /** Every file of the extracted folder. Empty for an unverified asset. */
    contents: z.array(RuntimeContent),
    /** The program inside the folder. */
    entry: z.string().min(1),
    name: z.string().min(1),
    /** `process.platform` and `process.arch`, joined with a dash. */
    platform: z.string().regex(/^(win32|darwin|linux)-(x64|arm64)$/),
    sha256: Sha256,
    url: z.string().url().startsWith('https://github.com/ggml-org/llama.cpp/releases/download/'),
    verified: z.boolean(),
  })
  .strict();
export type RuntimeAsset = z.infer<typeof RuntimeAsset>;

export const RuntimeManifest = z
  .object({
    assets: z.array(RuntimeAsset).min(1),
    id: z.string().regex(/^[a-z0-9-]+$/),
    licence: z.string().min(1),
    licenceUrl: z.string().url(),
    name: z.string().min(1),
    retrievedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    source: z.string().url(),
    tag: z.string().regex(/^b\d+$/),
  })
  .strict()
  .superRefine((manifest, context) => {
    const issue = (path: (string | number)[], message: string) =>
      context.addIssue({ code: z.ZodIssueCode.custom, path, message });
    const seen = new Set<string>();
    for (const [index, asset] of manifest.assets.entries()) {
      const at = ['assets', index];
      if (seen.has(asset.platform)) issue([...at, 'platform'], 'two assets for one platform');
      seen.add(asset.platform);
      if (!asset.name.includes(manifest.tag) || !asset.url.includes(`/${manifest.tag}/`)) {
        issue(at, 'the asset is not from the pinned tag');
      }
      if (asset.verified && !asset.contents.some((c) => c.name === asset.entry)) {
        issue([...at, 'contents'], 'a verified asset lists its program');
      }
      if (!asset.verified && asset.contents.length > 0) {
        issue([...at, 'contents'], 'an unverified asset has no contents list');
      }
    }
  });
export type RuntimeManifest = z.infer<typeof RuntimeManifest>;

export const LLAMA_SERVER: RuntimeManifest = RuntimeManifest.parse(llamaServer);

/** The asset for this computer, or undefined: there is no build pinned for it. */
export function runtimeAssetFor(
  platform: string,
  arch: string,
  manifest: RuntimeManifest = LLAMA_SERVER,
): RuntimeAsset | undefined {
  return manifest.assets.find((a) => a.platform === `${platform}-${arch}`);
}
