/**
 * Puts the OCR runtime where the app can serve it from its own origin.
 *
 * `tesseract.js` defaults its worker, its WebAssembly core and its language data to a CDN. This
 * product's content security policy is `'self'` with no CDN, on purpose (`server.ts`), so all
 * three are copied out of `node_modules` into `apps/forms/public/ocr/` before Vite runs, and
 * `ocr.ts` points the worker there. The language data comes through `pnpm install` like every
 * other dependency (`@tesseract.js-data/<lang>`), so a build needs no network beyond the install
 * it already needs.
 *
 * The folder is gitignored: it is 8 MB of WebAssembly and 25 MB of language models, and a
 * generated file in git is a file somebody will edit.
 *
 * Idempotent, and skipped entirely when the target is already current, so `pnpm dev` stays fast.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(join(import.meta.dirname, '..', 'apps', 'forms', 'package.json'));
const OUT = join(import.meta.dirname, '..', 'apps', 'forms', 'public', 'ocr');

/** The interface languages, as Tesseract names them. Keep in step with `ocr.ts`. */
const LANGS = [
  'eng',
  'swe',
  'dan',
  'nor',
  'fin',
  'isl',
  'deu',
  'fra',
  'spa',
  'rus',
  'jpn',
  'chi_sim',
];

/**
 * Only the LSTM cores: `createWorker` picks the best one the browser supports (relaxed SIMD,
 * SIMD, or neither) and never asks for the legacy engine unless told to.
 */
const CORES = [
  'tesseract-core-relaxedsimd-lstm',
  'tesseract-core-simd-lstm',
  'tesseract-core-lstm',
];

function copyIfNewer(from: string, to: string): boolean {
  if (existsSync(to) && statSync(to).mtimeMs >= statSync(from).mtimeMs) return false;
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
  return true;
}

let copied = 0;

const worker = require.resolve('tesseract.js/dist/worker.min.js');
if (copyIfNewer(worker, join(OUT, 'worker.min.js'))) copied += 1;

const coreDir = dirname(require.resolve('tesseract.js-core/package.json'));
for (const core of CORES) {
  for (const suffix of ['.wasm.js', '.wasm']) {
    if (copyIfNewer(join(coreDir, core + suffix), join(OUT, core + suffix))) copied += 1;
  }
}

for (const lang of LANGS) {
  const dir = dirname(require.resolve(`@tesseract.js-data/${lang}/package.json`));
  const file = `${lang}.traineddata.gz`;
  if (copyIfNewer(join(dir, '4.0.0_best_int', file), join(OUT, 'lang', file))) copied += 1;
}

const present = readdirSync(OUT).length + readdirSync(join(OUT, 'lang')).length;
console.log(`ocr-assets: ${copied} copied, ${present} files in place`);
