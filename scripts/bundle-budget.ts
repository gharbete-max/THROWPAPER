/**
 * A size budget for what every visitor downloads, enforced as a build failure.
 *
 * Bundles grow one reasonable import at a time and nobody notices until a page is slow on a
 * phone at a venue. A number that fails CI is the only version of this check that works, because
 * a number in a document is a number nobody reads.
 *
 * ## What is budgeted, and what deliberately is not
 *
 * **Only the files `index.html` itself references.** Those are the ones every visitor pays for
 * before anything renders: one entry script and one stylesheet. Everything else in `assets/` is
 * loaded on demand — a locale catalogue when that language is chosen, the form builder when a
 * form is opened, ZXing when the door screen starts a camera — and is the code-splitting working
 * rather than weight to be alarmed about.
 *
 * That is why there is no per-chunk cap. The largest chunk in the build is 118 KB gzipped of
 * barcode decoder, which is correct: it is dynamically imported by one screen, and a rule that
 * failed on it would be a rule somebody turns off. A cap that fires on the thing that is *fine*
 * teaches people to ignore the cap.
 *
 * A total is budgeted too, as a coarse guard against the build doubling without anyone noticing.
 * It is set with real headroom, because it is meant to catch a mistake rather than to police
 * every addition.
 *
 * ## Why gzip rather than raw or brotli
 *
 * Raw bytes are not what crosses the network — the server compresses everything on the way out
 * (`apps/api-forms/src/fallback-compression.ts`). Gzip rather than brotli because it is the floor:
 * every client gets at least this, and a budget should measure the worst case a visitor sees, not
 * the best.
 */
import { gzipSync } from 'node:zlib';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DIST = join(import.meta.dirname, '..', 'apps', 'forms', 'dist');

/**
 * Budgets in gzipped kilobytes.
 *
 * Measured on the build at the time of writing: **entry 6.7, stylesheet 11.8, total 499.4.** The
 * paper importer then added `pdfjs-dist` — one lazily-loaded chunk of ~180 KB gzipped that only a
 * builder pressing "From paper" ever downloads — and the total was raised to keep the same
 * headroom above it (entry and stylesheet did not move). Each
 * budget is set well above its measurement, so an ordinary feature does not trip it and a doubling
 * does.
 *
 * The guided builder (ADR 0017, slices S1–S5) then took the total from 774.0 to 860.3 KB: one
 * lazily-loaded chunk of 55 KB gzipped — about 25 KB of it the built-in aliases in twelve
 * languages — that only an author pressing "Start from questions" downloads, and its words in all
 * twelve catalogues. By S4 it had left the total 2 KB under 850, so the total was raised to 1 000:
 * about the headroom it had when it was set (entry 6.7 and stylesheet 15.2 are well inside theirs).
 *
 * S10 took it back down from 978.4 to 914.4 without removing a feature: `@tp/shared` now declares
 * `"sideEffects": false`, so a value imported from one of its barrels no longer brings every module
 * behind it, and the import's stages run only in their worker — the page no longer carries a
 * second copy for engines without workers, which no supported browser is. The editor's own chunk,
 * which every author opening a form downloads, went from 42.7 to 29.4.
 *
 * The total needs the most headroom and gets it. 499 KB sounds alarming beside the other two and
 * is not comparable to them: it is every locale catalogue, every lazily-loaded screen and the
 * barcode decoder added together, of which a given visitor downloads a small fraction. A budget
 * near that figure would fail on the next language or the next screen — which is a budget that
 * gets raised reflexively until it means nothing.
 */
const BUDGET_KB = {
  /** The one script `index.html` loads. Every visitor, every time, before anything renders. */
  entry: 12,
  /** The one stylesheet it loads. Render-blocking, so it is paid for at the same moment. */
  stylesheet: 20,
  /** Every JavaScript and CSS file in the build, loaded or not. A doubling-detector, not a cap. */
  total: 1000,
} as const;

function gzippedKb(path: string): number {
  return gzipSync(readFileSync(path), { level: 6 }).length / 1024;
}

/** The entry script and stylesheet, by what `index.html` actually asks for. */
function referencedByTheShell(): { entry: string; stylesheet: string } {
  const html = readFileSync(join(DIST, 'index.html'), 'utf8');
  const entry = /<script[^>]+src="\/([^"]+\.js)"/.exec(html)?.[1];
  const stylesheet = /<link[^>]+rel="stylesheet"[^>]+href="\/([^"]+\.css)"/.exec(html)?.[1];

  /*
   * A build whose shell stops referencing either is not a passing build. Silently skipping the
   * check would make the budget disappear exactly when the thing it measures changed shape.
   */
  if (!entry) throw new Error('index.html references no entry script — has the build changed?');
  if (!stylesheet) throw new Error('index.html references no stylesheet — has the build changed?');
  return { entry, stylesheet };
}

/**
 * Copied runtimes that are not this build.
 *
 * `ocr/` is tesseract.js's worker and WebAssembly cores, copied out of `node_modules` by
 * `scripts/ocr-assets.ts` — 12 MB of `.wasm.js` glue that carries the module as base64. It is
 * fetched only when somebody draws a box on a photographed page in the builder, its size is
 * decided upstream rather than by anything in this repository, and counting it would put the
 * total permanently at 5 MB and make the doubling-detector unable to detect anything.
 */
const NOT_OURS = new Set(['ocr']);

function everyBundleFile(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((item) => {
    const path = join(directory, item.name);
    if (item.isDirectory()) return NOT_OURS.has(item.name) ? [] : everyBundleFile(path);
    return /\.(js|css)$/.test(item.name) ? [path] : [];
  });
}

try {
  statSync(DIST);
} catch {
  console.error('No build to measure. Run `pnpm build` first.');
  process.exit(1);
}

const { entry, stylesheet } = referencedByTheShell();
const measured = {
  entry: gzippedKb(join(DIST, entry)),
  stylesheet: gzippedKb(join(DIST, stylesheet)),
  total: everyBundleFile(DIST).reduce((sum, path) => sum + gzippedKb(path), 0),
};

const rows = (Object.keys(BUDGET_KB) as Array<keyof typeof BUDGET_KB>).map((name) => ({
  what: name,
  gzipKb: Number(measured[name].toFixed(1)),
  budgetKb: BUDGET_KB[name],
  over: measured[name] > BUDGET_KB[name],
}));

console.table(rows);

/**
 * The import's stages run in the paper door's worker, and nowhere else.
 *
 * Their word lists in twelve languages are the largest thing the door loads. Until S10 one value
 * imported from `@tp/shared/import` by the paper door carried every stage's lists into the
 * editor's own chunk, so every author opening a form downloaded them (14.9 KB gzipped), and
 * nothing failed: the app worked, and was merely bigger. `@tp/shared` now says it has no side
 * effects, so the bundler can leave out what is not used — and this is what notices if it ever
 * stops being able to. A word list's key anywhere but in the worker fails the build.
 */
const STAGE_MARKERS = ['lexiconVersion', 'booleanPairs', 'tableWords'];
const WORKER = /(^|[/\\])import\.worker-[^/\\]*\.js$/;
const strays = everyBundleFile(DIST)
  .filter((path) => path.endsWith('.js') && !WORKER.test(path))
  .filter((path) => {
    const source = readFileSync(path, 'utf8');
    return STAGE_MARKERS.some((marker) => source.includes(marker));
  });
const workers = everyBundleFile(DIST).filter((path) => WORKER.test(path));
if (workers.length !== 1) {
  console.error(
    `Expected one import worker chunk, found ${workers.length} — has the build changed?`,
  );
  process.exit(1);
}
if (strays.length > 0) {
  console.error(
    `The import's stages are in ${strays.map((path) => path.slice(DIST.length + 1)).join(', ')},\n` +
      '  not only in the worker. Something outside the paper door imports a value from\n' +
      '  @tp/shared/import that brings the word lists with it; import it from where it is used.',
  );
  process.exit(1);
}

const broken = rows.filter((row) => row.over);
if (broken.length > 0) {
  for (const row of broken) {
    console.error(
      `${row.what} is ${row.gzipKb} KB gzipped, over its ${row.budgetKb} KB budget.\n` +
        '  Either make it smaller, or raise the budget in scripts/bundle-budget.ts and say why in\n' +
        '  the commit message. Raising it silently is the failure this check exists to prevent.',
    );
  }
  process.exit(1);
}

console.log(`bundle budget passed — entry ${rows[0]?.gzipKb} KB gzipped, of ${BUDGET_KB.entry} KB`);
