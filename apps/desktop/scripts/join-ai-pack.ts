/**
 * Joins an AI pack's parts back into the model's files and checks every hash, without the app.
 *
 *   pnpm --filter @tp/desktop exec tsx scripts/join-ai-pack.ts <pack folder> <output folder>
 *
 * The same code the app runs for "open from disk" on a PACK.json (src/ai/pack.ts): each part is
 * checked while it is read, the whole file before it is given its name, and a failure leaves
 * nothing behind that looks like a model. The parts are not touched. Finished files already in the
 * output folder are kept, so running it again resumes at the file that stopped.
 */
import { resolve } from 'node:path';
import { PackError, installFromFolder, readPackManifest } from '../src/ai/pack.js';

const [folder, out] = process.argv.slice(2);
if (!folder || !out) {
  console.error('usage: join-ai-pack.ts <pack folder> <output folder>');
  process.exit(2);
}
try {
  const pack = await readPackManifest(resolve(folder));
  const paths = await installFromFolder(pack.files, resolve(folder), resolve(out), {
    onProgress: (file, files, p) => {
      if (p.done === p.total || p.done % (256 * 1024 * 1024) < 4 * 1024 * 1024) {
        process.stdout.write(
          `\rfile ${file}/${files}: ${Math.round((p.done / p.total) * 100)}%   `,
        );
      }
    },
  });
  console.log(`\n${paths.length} files ready and verified:\n${paths.join('\n')}`);
} catch (error) {
  console.error(error instanceof PackError ? `${error.failure}: ${error.message}` : error);
  process.exit(1);
}
