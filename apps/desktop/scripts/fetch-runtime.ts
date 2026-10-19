/**
 * Fetches the pinned `llama-server` for this computer, checks it and puts it where Loppa looks.
 *
 *   pnpm --filter @tp/desktop exec tsx scripts/fetch-runtime.ts [--out <dir>] [--platform win32-x64] [--record]
 *
 * The release, the asset name, its size and its SHA-256 are pinned in
 * `packages/shared/src/ai/runtimes/llama-server.json` (ADR 0025). The archive is hashed before it
 * is opened; for a verified asset every extracted file is hashed again against the manifest. The
 * result is never committed: the default folder, `local-models/runtime/`, is Git-ignored.
 *
 * `--record` prints the `contents` list of the extracted folder, for pinning a new release.
 * An asset not marked `verified` is extracted with a warning: it has not been run by this project.
 */
import { spawnSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { LLAMA_SERVER, type RuntimeAsset } from '@tp/shared/ai';
import { describeFolder, sha256Of, verifyRuntimeFolder } from '../src/ai/runtime.js';

async function download(asset: RuntimeAsset, to: string): Promise<void> {
  await mkdir(dirname(to), { recursive: true });
  const response = await fetch(asset.url, { redirect: 'follow' });
  if (!response.ok || !response.body) throw new Error(`${asset.url}: HTTP ${response.status}`);
  await pipeline(Readable.fromWeb(response.body as never), createWriteStream(to));
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const option = (name: string) => {
    const at = args.indexOf(name);
    return at >= 0 ? args[at + 1] : undefined;
  };
  const platform = option('--platform') ?? `${process.platform}-${process.arch}`;
  const asset = LLAMA_SERVER.assets.find((a) => a.platform === platform);
  if (!asset) {
    throw new Error(`no ${LLAMA_SERVER.name} ${LLAMA_SERVER.tag} is pinned for ${platform}`);
  }
  const out = resolve(
    option('--out') ?? join(import.meta.dirname, '../../../local-models/runtime'),
  );
  const archive = join(out, '..', '.runtime-download', asset.name);

  console.log(`${LLAMA_SERVER.name} ${LLAMA_SERVER.tag}, ${asset.name} (${asset.bytes} bytes)`);
  if (!asset.verified) {
    console.warn(
      'UNVERIFIED: this asset has not been run by this project; only its hash is pinned.',
    );
  }
  if ((await stat(archive).catch(() => null))?.size !== asset.bytes) await download(asset, archive);
  const got = await sha256Of(archive);
  if (got !== asset.sha256) {
    await rm(archive, { force: true });
    throw new Error(`${asset.name}: SHA-256 ${got} is not the pinned ${asset.sha256}; deleted`);
  }
  console.log('archive hash matches the manifest');

  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  // bsdtar unpacks a zip; the tar first on PATH in a POSIX shell on Windows cannot, so use Windows' own.
  const tar =
    process.platform === 'win32'
      ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
      : 'tar';
  const untar = spawnSync(tar, ['-xf', asset.name, '-C', out], {
    cwd: dirname(archive), // a name with a drive letter in it is a remote host to GNU tar
    stdio: 'inherit',
  });
  if (untar.status !== 0) throw new Error('tar could not unpack the archive');

  if (args.includes('--record')) {
    console.log(JSON.stringify(await describeFolder(out), null, 2));
    return;
  }
  if (asset.verified) {
    if ((await verifyRuntimeFolder(out, asset)) !== 'ok')
      throw new Error('an extracted file is missing or changed');
    console.log(`${asset.contents.length} files match the manifest`);
  }
  console.log(`ready: ${join(out, asset.entry)}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
