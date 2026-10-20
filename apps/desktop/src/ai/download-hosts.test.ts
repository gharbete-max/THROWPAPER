import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ModelFile } from '@tp/shared/ai';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { downloadFile } from './download.js';

const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const onlyHf = (host: string) => host === 'huggingface.co' || host.endsWith('.hf.co');

let dir = '';
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'loppa-hosts-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function single() {
  const bytes = randomBytes(30_000);
  const file = ModelFile.parse({
    bytes: bytes.length,
    name: 'one.gguf',
    parts: [
      {
        bytes: bytes.length,
        name: 'one.gguf',
        sha256: sha(bytes),
        url: 'https://huggingface.co/r/resolve/rev/one.gguf',
      },
    ],
    role: 'weights',
    sha256: sha(bytes),
  });
  return { file, bytes };
}

const redirectTo = (location: string, status = 302) =>
  (async () => new Response(null, { status, headers: { location } })) as unknown as typeof fetch;

describe('redirects and hosts', () => {
  it('follows a redirect from Hugging Face to its CDN, and hashes what arrives', async () => {
    const { file, bytes } = single();
    const asked: string[] = [];
    const fetcher = (async (url: string | URL | Request) => {
      asked.push(String(url));
      return String(url).startsWith('https://huggingface.co/')
        ? new Response(null, {
            status: 302,
            headers: { location: 'https://cas-bridge.xethub.hf.co/x?sig=1' },
          })
        : new Response(new Blob([bytes as BlobPart]));
    }) as typeof fetch;
    const path = await downloadFile({ file, dir, fetch: fetcher, allowHost: onlyHf });
    expect((await readFile(path)).equals(bytes)).toBe(true);
    expect(asked).toEqual([file.parts[0]!.url, 'https://cas-bridge.xethub.hf.co/x?sig=1']);
  });

  it('refuses a redirect to any other host and keeps nothing', async () => {
    const { file } = single();
    await expect(
      downloadFile({
        file,
        dir,
        fetch: redirectTo('https://evil.test/one.gguf'),
        allowHost: onlyHf,
      }),
    ).rejects.toMatchObject({ failure: 'host' });
    expect(await readdir(dir)).toEqual([]);
  });

  it('refuses a redirect to plain http', async () => {
    const { file } = single();
    await expect(
      downloadFile({
        file,
        dir,
        fetch: redirectTo('http://cdn.hf.co/one.gguf', 301),
        allowHost: onlyHf,
      }),
    ).rejects.toMatchObject({ failure: 'host' });
  });

  it('deletes the temporary file when the hash is wrong', async () => {
    const { file } = single();
    const fetcher = (async () =>
      new Response(new Blob([randomBytes(30_000) as BlobPart]))) as unknown as typeof fetch;
    await expect(
      downloadFile({ file, dir, fetch: fetcher, allowHost: onlyHf }),
    ).rejects.toMatchObject({ failure: 'hash' });
    expect(await readdir(dir)).toEqual([]);
  });
});
