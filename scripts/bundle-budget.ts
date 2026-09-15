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
 * Measured on the build at the time of writing: **entry 6.7, stylesheet 11.8, total 499.4.** Each
 * budget is set well above its measurement, so an ordinary feature does not trip it and a doubling
 * does.
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
  total: 650,
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

function everyBundleFile(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((item) => {
    const path = join(directory, item.name);
    if (item.isDirectory()) return everyBundleFile(path);
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
