/**
 * Publishes an AI pack as a GitHub release (ADR 0025 section 4, ADR 0026 decision 8).
 *
 *   pnpm --filter @tp/desktop exec tsx scripts/publish-ai-pack.ts <pack folder>          # plan only
 *   pnpm --filter @tp/desktop exec tsx scripts/publish-ai-pack.ts <pack folder> --yes    # upload
 *
 * Without `--yes` this uploads nothing: it prints the release, every file with its size and the
 * exact `gh` command. The pack is about 6 GB, so uploading is the owner's decision, and takes a
 * while. With `--yes` it creates the release (a draft, then published when every file is on it)
 * and rewrites the parts' addresses in packages/shared/src/ai/models/<model>.json to point at it;
 * commit that change. Never run in CI: a runner has about 14 GB of disk.
 *
 * Nothing about hashes is decided here: the pack must already match the manifest
 * (make-ai-pack.ts says so), and the app checks every download against the manifest in its code.
 */
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
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
  `The model, its projector and PACK.json for Loppa's on-device AI. Licence: ${TEXT_MODEL.licence}. Loppa checks every part against the hashes in its own manifest.`,
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
// Point the manifest at the release before it goes public, so the draft can be checked first.
const json = join(
  import.meta.dirname,
  '../../../packages/shared/src/ai/models/qwen2.5-vl-7b-instruct-q4_k_m.json',
);
const manifest = JSON.parse(await readFile(json, 'utf8')) as {
  files: Array<{ parts: Array<{ name: string; url: string }> }>;
};
for (const file of manifest.files) {
  for (const part of file.parts)
    part.url = `https://github.com/${repo}/releases/download/${tag}/${part.name}`;
}
await writeFile(json, `${JSON.stringify(manifest, null, 2)}\n`);
execFileSync('gh', ['release', 'edit', tag, '--repo', repo, '--draft=false'], { stdio: 'inherit' });
console.log('published; commit the changed manifest URLs.');
