/**
 * Cuts the model's files into an AI pack: parts under 2 GiB with a SHA-256 each, and PACK.json.
 *
 *   pnpm --filter @tp/desktop exec tsx scripts/make-ai-pack.ts [--src <dir>] [--out <dir>]
 *                                                              [--part-bytes N] [--with-lite]
 *
 * `--src` is the folder holding the .gguf files (default LOPPA_AI_DIR, else the repository root);
 * `--out` defaults to `ai-pack-out/` (Git-ignored with the other model folders). The weights and the
 * f16 projector go in; `--with-lite` adds the optional Q8_0 projector. With the default part size
 * (1.5 GiB) the parts are byte for byte the ones the app's manifest names, and this script says
 * whether every hash matches it. Nothing is uploaded here (see publish-ai-pack.ts).
 */
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileNames, TEXT_MODEL } from '@tp/shared/ai';
import { DEFAULT_PART_BYTES, makePack } from '../src/ai/pack.js';

const args = process.argv.slice(2);
const option = (name: string) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};
const repo = resolve(import.meta.dirname, '../../..');
const src = resolve(option('--src') ?? process.env.LOPPA_AI_DIR ?? repo);
const out = resolve(option('--out') ?? join(repo, 'ai-pack-out'));
const partBytes = Number(option('--part-bytes') ?? DEFAULT_PART_BYTES);
if (!Number.isInteger(partBytes) || partBytes <= 0 || partBytes >= 2 * 1024 ** 3) {
  throw new Error('--part-bytes must be a whole number of bytes below 2 GiB');
}

const wanted = TEXT_MODEL.files.filter((f) => !f.optional || args.includes('--with-lite'));
const sources = wanted.map((file) => {
  const found = fileNames(file)
    .map((name) => join(src, name))
    .find((path) => existsSync(path));
  if (!found) throw new Error(`${file.name} is not in ${src}`);
  return found;
});

console.log(`cutting ${sources.length} files from ${src} into ${out}, parts of ${partBytes} bytes`);
const manifest = await makePack(TEXT_MODEL.id, sources, out, partBytes);

let same = true;
for (const file of manifest.files) {
  const want = TEXT_MODEL.files.find((f) => f.name === file.name);
  const parts = file.parts.map((p) => `${p.name} ${p.bytes} ${p.sha256}`).join('\n    ');
  const hashOk = want?.sha256 === file.sha256;
  const partsOk =
    want !== undefined &&
    want.parts.length === file.parts.length &&
    want.parts.every(
      (p, i) => p.sha256 === file.parts[i]?.sha256 && p.name === file.parts[i]?.name,
    );
  same &&= hashOk && partsOk;
  console.log(
    `${file.name}: ${file.bytes} bytes, whole hash ${hashOk ? 'matches' : 'DIFFERS from'} the manifest\n    ${parts}`,
  );
}
console.log(
  same
    ? 'every file and part matches the manifest in packages/shared/src/ai/models.'
    : 'NOT the files the manifest names (a different split or different weights): the app would refuse them.',
);
process.exit(same ? 0 : 1);
