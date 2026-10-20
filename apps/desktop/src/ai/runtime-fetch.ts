import { spawnSync } from 'node:child_process';
import { mkdir, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { isRuntimeHost, type RuntimeAsset } from '@tp/shared/ai';
import { downloadFile, type OnProgress } from './download.js';
import { verifyRuntimeFolder } from './runtime.js';

/** Unpacks a zip with the system's own `tar` (bsdtar reads zip; the GNU tar first on a POSIX shell's PATH on Windows cannot). */
export function untar(archive: string, out: string): void {
  const tar =
    process.platform === 'win32'
      ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
      : 'tar';
  const done = spawnSync(tar, ['-xf', archive, '-C', out], {
    cwd: dirname(archive), // a name with a drive letter in it is a remote host to GNU tar
    stdio: 'ignore',
  });
  if (done.status !== 0) throw new Error('tar could not unpack the archive');
}

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
    untar(archive, unpacked);
    if ((await verifyRuntimeFolder(unpacked, asset)) !== 'ok') {
      throw new Error('a file of the unpacked runtime is missing or changed');
    }
    await rm(dir, { recursive: true, force: true });
    await rename(unpacked, dir);
  } finally {
    await rm(unpacked, { recursive: true, force: true });
    await rm(work, { recursive: true, force: true });
  }
}
