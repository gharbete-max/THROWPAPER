import { createHash, randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ModelManifest } from '@tp/shared/ai';

const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/**
 * A model of real, tiny files: the coordinator hashes them, a stand-in `llama-server` "loads"
 * them. The first file is the weights, the rest projectors. Used by the reliability suites.
 */
export function tinyModel(id: string, capability: 'text' | 'vision', sizes: number[]) {
  const contents = sizes.map((n) => randomBytes(n));
  const manifest = ModelManifest.parse({
    capabilities: [capability],
    distributable: true,
    evaluationOnly: false,
    files: contents.map((bytes, index) => {
      const name = `${id}-${index}.gguf`;
      return {
        bytes: bytes.length,
        name,
        parts: [
          {
            bytes: bytes.length,
            name,
            sha256: sha(bytes),
            url: `https://huggingface.co/x/resolve/r/${name}`,
          },
        ],
        role: index === 0 ? 'weights' : 'projector',
        sha256: sha(bytes),
      };
    }),
    id,
    kind: capability,
    licence: 'Apache-2.0',
    licenceUrl: 'https://example.test/licence',
    name: id,
    requiredMemoryBytes: 1000,
    requiredMemoryVerified: false,
    support: { evidence: 'test', state: 'untested' },
    tier: 'light',
    retrievedAt: '2026-10-14',
    source: 'https://example.test/source',
    sourceRevision: 'x',
  });
  return { manifest, contents };
}

/** Puts a tiny model's files in `dir`, under their manifest names. */
export async function writeTinyModel(
  dir: string,
  model: ReturnType<typeof tinyModel>,
): Promise<string[]> {
  await mkdir(dir, { recursive: true });
  return Promise.all(
    model.manifest.files.map(async (file, index) => {
      const path = join(dir, file.name);
      await writeFile(path, model.contents[index]!);
      return path;
    }),
  );
}
