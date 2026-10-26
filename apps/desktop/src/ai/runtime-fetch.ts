import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { isRuntimeHost, type RuntimeAsset } from '@tp/shared/ai';
import { downloadFile, type OnProgress } from './download.js';
import { extractArchive } from '../addons/extract.js';
import { verifyRuntimeFolder } from './runtime.js';

/**
 * Fetches one pinned runtime asset into `dir` (the folder the program is looked for in): the
 * archive over the same checked download as a model file (https only, redirects only to the
 * allowed hosts, size and SHA-256 against the manifest before anything is opened), unpacked beside
 * `dir`, every file hashed against the manifest, and only then moved into place. A failure leaves
 * `dir` as it was. Called only after the person confirmed the host, the file and the size
 * (ADR 0026); `scripts/fetch-runtime.ts` is the developer's command-line twin.
 */
export async function fetchRuntime(options: {
  asset: RuntimeAsset;
  dir: string;
  fetch: typeof fetch;
  signal?: AbortSignal;
  onProgress?: OnProgress;
}): Promise<void> {
  const { asset, dir } = options;
  const work = `${dir}.download`;
  const unpacked = `${dir}.new`;
  try {
    const archive = await downloadFile({
      file: {
        name: asset.name,
        bytes: asset.bytes,
        sha256: asset.sha256,
        role: 'runtime',
        parts: [{ name: asset.name, bytes: asset.bytes, sha256: asset.sha256, url: asset.url }],
      },
      dir: work,
      fetch: options.fetch,
      allowHost: isRuntimeHost,
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.onProgress ? { onProgress: options.onProgress } : {}),
    });
    await rm(unpacked, { recursive: true, force: true });
    await mkdir(unpacked, { recursive: true });
    // Names, links and sizes are checked as it unpacks (addons/extract.ts): a hash proves the file
    // is the one released, not that what is inside it is safe to write.
    await extractArchive(archive, unpacked);
    // `unpinned`: an asset nobody here has run lists no files, so only the archive's hash was
    // checked; its program must still be there.
    const entry = await stat(join(unpacked, asset.entry)).catch(() => null);
    if ((await verifyRuntimeFolder(unpacked, asset)) === 'damaged' || !entry?.isFile()) {
      throw new Error('a file of the unpacked runtime is missing or changed');
    }
    await rm(dir, { recursive: true, force: true });
    await rename(unpacked, dir);
  } finally {
    await rm(unpacked, { recursive: true, force: true });
    await rm(work, { recursive: true, force: true });
  }
}
