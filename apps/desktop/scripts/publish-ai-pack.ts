/**
 * Publishes an AI pack as a GitHub release (ADR 0025 section 4, ADR 0026 decision 8).
 *
 *   pnpm --filter @tp/desktop exec tsx scripts/publish-ai-pack.ts <pack folder>          # plan only
 *   pnpm --filter @tp/desktop exec tsx scripts/publish-ai-pack.ts <pack folder> --yes    # upload
 *
 * Without `--yes` this uploads nothing: it prints the release, every file with its size and the
 * exact `gh` command. The pack is about 6 GB, so uploading is the owner's decision, and takes a
 * while. With `--yes` it creates the release (a draft, then published when every file is on it).
 * The manifest is NOT changed: in-app downloads go to Hugging Face (the only hosts the download
 * manager allows); this release is the pack for 'Open a pack from a folder'. Never run in CI: a
 * runner has about 14 GB of disk.
 *
 * Nothing about hashes is decided here: the pack must already match the manifest
 * (make-ai-pack.ts says so), and the app checks every download against the manifest in its code.
 */
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { TEXT_MODEL } from '@tp/shared/ai';
import { readPackManifest } from '../src/ai/pack.js';

const [folderArg] = process.argv.slice(2);
if (!folderArg) {
  console.error('usage: publish-ai-pack.ts <pack folder> [--yes]');
  process.exit(2);
}
const folder = resolve(folderArg);
const pack = await readPackManifest(folder);
if (pack.id !== TEXT_MODEL.id) throw new Error(`the pack is for ${pack.id}, not ${TEXT_MODEL.id}`);

const repo = execFileSync(
  'gh',
  ['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'],
  {
    encoding: 'utf8',
  },
).trim();
const tag = `ai-pack-${TEXT_MODEL.id}`;
const names = pack.files.flatMap((f) => f.parts.map((p) => p.name));
const sizes = pack.files.flatMap((f) => f.parts.map((p) => p.bytes));
const total = sizes.reduce((a, b) => a + b, 0);
const files = [...names.map((n) => join(folder, n)), join(folder, 'PACK.json')];
const command = [
  'gh',
  'release',
  'create',
  tag,
  ...files,
  '--repo',
  repo,
  '--draft',
  '--title',
  `AI pack: ${TEXT_MODEL.name}`,
  '--notes',
  [
    `The model, its projector and PACK.json for Loppa's on-device AI. Loppa checks every part against the hashes in its own manifest.`,
    '',
    `Weights: Qwen2.5-VL-7B-Instruct by the Qwen team (Alibaba Cloud), a GGUF quantisation published by ggml-org (https://huggingface.co/ggml-org/Qwen2.5-VL-7B-Instruct-GGUF), redistributed unmodified.`,
    `Licence: ${TEXT_MODEL.licence} (https://www.apache.org/licenses/LICENSE-2.0). This notice and the licence text travel with the files; the copyright and attribution belong to their authors.`,
    '',
    'To use without Loppa: join the numbered parts of a file in order (`copy /b a.part1+a.part2+a.part3 a.gguf` on Windows, `cat` elsewhere) and check the SHA-256 in PACK.json.',
  ].join(String.fromCharCode(10)),
];

console.log(`release ${tag} on ${repo}: ${names.length} parts, ${(total / 1e9).toFixed(2)} GB`);
for (const [i, n] of names.entries()) console.log(`  ${n}  ${sizes[i]} bytes`);
console.log(
  `\n${command.map((c) => (/\s/.test(c) ? `"${c}"` : c)).join(' ')}\ngh release edit ${tag} --repo ${repo} --draft=false`,
);

if (!process.argv.includes('--yes')) {
  console.log('\nPlan only. Nothing was uploaded. Add --yes to run it.');
  process.exit(0);
}
execFileSync(command[0]!, command.slice(1), { stdio: 'inherit' });
execFileSync('gh', ['release', 'edit', tag, '--repo', repo, '--draft=false'], { stdio: 'inherit' });
console.log(
  'published. The manifest is unchanged: the Get button downloads from Hugging Face (the only hosts the download manager allows); this release is the pack to open from a folder, or to hand to a computer with no access to Hugging Face.',
);
