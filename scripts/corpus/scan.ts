/**
 * `pnpm corpus:scan` — the golden corpus's scans (S14, `docs/plan/SCANS.md` §5).
 *
 * A scan is a corpus document printed and put through a scanner: here, its first page drawn by
 * pdf.js at 200 dots an inch, in grey, turned a fraction of a degree as a sheet fed by hand is
 * turned. Tesseract reads that picture in Node, with exactly the conversion the review screen uses
 * (`recognisedFrom`, `photoDocument`), and the result is frozen as the scan's raw document. The
 * corpus test reads that file, never Tesseract: OCR is a measurement, like pdf.js, and a test must
 * give the same answer on every machine. So the picture, the raw document and the scanned PDF are
 * all committed, `scans/SOURCES.json` records each one's hash, and a rebuild is a diff to review.
 *
 * Each scan writes:
 * - `<name>.png`, the picture, which `e2e/scan.spec.ts` gives the review screen as a photograph;
 * - `<name>.raw.json`, stage 1's raw document of it, which `corpus.test.ts` reads through the
 *   stages against `expected/<name>.json`, written by hand;
 * - with `pdf: true`, `<name>.pdf`, the same picture as a PDF with no text in it, as a scanner
 *   writes one, which `e2e/scan.spec.ts` gives the review screen to read by OCR.
 *
 * And, run over every scan, `fixtures/ocr/box-marks.json`: the lines of each picture that hold a
 * printed box, or a word that could be taken for one, as Tesseract gave them — the scanned PDFs'
 * pages drawn as the review screen draws them — for B1's own tests (`ocr.test.ts`).
 *
 * Not part of `verify`: the tests read the committed files. Needs the language data in
 * `apps/forms/public/ocr/lang`, which `scripts/ocr-assets.ts` puts there (run first, here).
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  photoDocument,
  READ_LONG_SIDE,
  recognisedFrom,
  tessLangs,
  type RecognisedWords,
  type TesseractPage,
} from '../../apps/forms/src/screens/builder/paper/ocr-words.js';
import '../ocr-assets.js';

const ROOT = resolve(import.meta.dirname, '../..');
const CORPUS = join(ROOT, 'fixtures', 'documents');
const OUT = join(CORPUS, 'scans');
const LANG = join(ROOT, 'apps', 'forms', 'public', 'ocr', 'lang');
const RECORDED = join(ROOT, 'fixtures', 'ocr', 'box-marks.json');
const require = createRequire(join(ROOT, 'apps', 'forms', 'package.json'));

/** Dots an inch: an office scanner's ordinary setting. */
const DPI = 200;

interface Scan {
  /** The corpus document scanned: its PDF's first page. */
  name: string;
  /** The language its author works in, which says what Tesseract reads it as (`tessLangs`). */
  locale: string;
  /** How far the sheet went in turned, in degrees, clockwise. */
  skew: number;
  /** Also written as a PDF holding only the picture. */
  pdf: boolean;
  /** The lines kept for B1's tests: its boxes, and words that could be taken for one. */
  record: RegExp;
}

const SCANS: Scan[] = [
  {
    name: 'medlemsansokan',
    locale: 'sv-SE',
    skew: 0.5,
    pdf: false,
    record: /nyhetsbrev|Namn:|lämna/u,
  },
  { name: 'fotosamtycke', locale: 'sv-SE', skew: -0.4, pdf: true, record: /samtycker|lämna/u },
];

const only = process.argv.slice(2);
const scans = only.length ? SCANS.filter((scan) => only.includes(scan.name)) : SCANS;
if (scans.length === 0) throw new Error(`No scan is called ${only.join(', ')}.`);

type Pdfjs = typeof import('pdfjs-dist/legacy/build/pdf.mjs');
const pdfjs = (await import(
  pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href
)) as Pdfjs;
pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(
  require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs'),
).href;
/** `tesseract.js` in Node, as far as this uses it: a dependency of `apps/forms`, not of the root. */
type CreateWorker = (
  langs: string[],
  oem: number,
  options: { langPath: string; gzip: boolean; cacheMethod: 'none' },
) => Promise<{
  recognize(image: Buffer, options: object, output: { blocks: true }): Promise<{ data: unknown }>;
  terminate(): Promise<unknown>;
}>;
const { createWorker } = (await import(pathToFileURL(require.resolve('tesseract.js')).href)) as {
  createWorker: CreateWorker;
};

/** The canvas pdf.js draws on in Node (`@napi-rs/canvas`), as far as this uses it. */
interface NodeCanvas {
  width: number;
  height: number;
  getContext(kind: '2d'): CanvasRenderingContext2D;
  toBuffer(mime: 'image/png' | 'image/jpeg', quality?: number): Buffer;
}
interface CanvasFactory {
  create(width: number, height: number): { canvas: NodeCanvas; context: CanvasRenderingContext2D };
}

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** A picture read by Tesseract in Node, as the review screen reads one in the browser. */
async function read(png: Buffer, size: { width: number; height: number }, locale: string) {
  const worker = await createWorker(tessLangs(locale), 1, {
    langPath: LANG,
    gzip: true,
    cacheMethod: 'none',
  });
  try {
    const { data } = await worker.recognize(png, {}, { blocks: true });
    return recognisedFrom(data as TesseractPage, size);
  } finally {
    await worker.terminate();
  }
}

/** A PDF's first page drawn as the review screen draws a scanned page for OCR (`picture`). */
async function drawnForOcr(bytes: Uint8Array) {
  const document = await pdfjs.getDocument({ data: bytes }).promise;
  try {
    const page = await document.getPage(1);
    const natural = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({
      scale: READ_LONG_SIDE / Math.max(natural.width, natural.height),
    });
    const factory = (document as unknown as { canvasFactory: CanvasFactory }).canvasFactory;
    const { canvas, context } = factory.create(
      Math.round(viewport.width),
      Math.round(viewport.height),
    );
    await page.render({
      canvas: canvas as unknown as HTMLCanvasElement,
      canvasContext: context,
      viewport,
      intent: 'print',
    }).promise;
    return { png: canvas.toBuffer('image/png'), width: canvas.width, height: canvas.height };
  } finally {
    await document.loadingTask.destroy();
  }
}

const recorded: Array<Omit<RecognisedWords, 'lines'> & { from: string; lines: unknown[] }> = [];
function record(from: string, recognised: RecognisedWords, match: RegExp) {
  const lines = recognised.lines
    .map((line) => ({ text: line.words.map((word) => word.text).join(' '), ...line }))
    .filter((line) => match.test(line.text));
  const { width, height, engine } = recognised;
  recorded.push({ from, width, height, engine, lines });
}

/** The first page as a scanner gives it back: grey, on white, turned by `skew` degrees. */
async function scanned(name: string, skew: number) {
  const document = await pdfjs.getDocument({
    data: new Uint8Array(readFileSync(join(CORPUS, `${name}.pdf`))),
  }).promise;
  try {
    const page = await document.getPage(1);
    const viewport = page.getViewport({ scale: DPI / 72 });
    const width = Math.round(viewport.width);
    const height = Math.round(viewport.height);
    const factory = (document as unknown as { canvasFactory: CanvasFactory }).canvasFactory;
    const drawn = factory.create(width, height);
    drawn.context.fillStyle = '#ffffff';
    drawn.context.fillRect(0, 0, width, height);
    await page.render({
      canvas: drawn.canvas as unknown as HTMLCanvasElement,
      canvasContext: drawn.context,
      viewport,
    }).promise;

    const sheet = factory.create(width, height);
    const context = sheet.context;
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.translate(width / 2, height / 2);
    context.rotate((skew * Math.PI) / 180);
    context.drawImage(drawn.canvas as unknown as CanvasImageSource, -width / 2, -height / 2);
    const pixels = context.getImageData(0, 0, width, height);
    for (let i = 0; i < pixels.data.length; i += 4) {
      const [r = 0, g = 0, b = 0] = pixels.data.subarray(i, i + 3);
      const grey = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
      pixels.data.set([grey, grey, grey, 255], i);
    }
    context.putImageData(pixels, 0, 0);
    return { canvas: sheet.canvas, width, height, widthPt: viewport.width / (DPI / 72) };
  } finally {
    await document.loadingTask.destroy();
  }
}

/**
 * A PDF with one page and nothing on it but the picture, as a scanner writes one: no text layer,
 * so `openPdf(…).raw()` finds fewer than three runs on it and reads it by OCR.
 */
function scannedPdf(jpeg: Buffer, pixels: { width: number; height: number }, widthPt: number) {
  const heightPt = (widthPt * pixels.height) / pixels.width;
  const size = (value: number) => value.toFixed(2);
  const content = `q ${size(widthPt)} 0 0 ${size(heightPt)} 0 0 cm /Scan Do Q`;
  const parts: Array<string | Buffer> = [];
  const offsets: number[] = [];
  let length = 0;
  const write = (part: string | Buffer) => {
    parts.push(part);
    length += typeof part === 'string' ? Buffer.byteLength(part, 'latin1') : part.length;
  };
  const object = (body: Array<string | Buffer>) => {
    offsets.push(length);
    write(`${offsets.length} 0 obj\n`);
    for (const part of body) write(part);
    write('\nendobj\n');
  };
  write('%PDF-1.4\n');
  object(['<< /Type /Catalog /Pages 2 0 R >>']);
  object(['<< /Type /Pages /Kids [3 0 R] /Count 1 >>']);
  object([
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${size(widthPt)} ${size(heightPt)}] `,
    '/Resources << /XObject << /Scan 4 0 R >> >> /Contents 5 0 R >>',
  ]);
  object([
    `<< /Type /XObject /Subtype /Image /Width ${pixels.width} /Height ${pixels.height} `,
    `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
    jpeg,
    '\nendstream',
  ]);
  object([`<< /Length ${content.length} >>\nstream\n${content}\nendstream`]);
  const xref = length;
  write(`xref\n0 ${offsets.length + 1}\n0000000000 65535 f \n`);
  for (const at of offsets) write(`${String(at).padStart(10, '0')} 00000 n \n`);
  write(`trailer\n<< /Size ${offsets.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return Buffer.concat(
    parts.map((part) => (typeof part === 'string' ? Buffer.from(part, 'latin1') : part)),
  );
}

mkdirSync(OUT, { recursive: true });
const manifestPath = join(OUT, 'SOURCES.json');
interface Manifest {
  licence: string;
  tool: string;
  scans: Array<{
    name: string;
    from: string;
    locale: string;
    dpi: number;
    skew: number;
    files: Record<string, { path: string; sha256: string }>;
  }>;
}
let manifest: Manifest;
try {
  manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;
} catch {
  manifest = { licence: 'CC0-1.0', tool: '', scans: [] };
}

for (const scan of scans) {
  const { canvas, width, height, widthPt } = await scanned(scan.name, scan.skew);
  const png = canvas.toBuffer('image/png');
  const recognised = await read(png, { width, height }, scan.locale);
  const raw = photoDocument(recognised, sha256(png));
  record(`documents/scans/${scan.name}.png`, recognised, scan.record);
  const files: Manifest['scans'][number]['files'] = {};
  const keep = (path: string, bytes: Uint8Array) => {
    writeFileSync(join(OUT, path), bytes);
    files[path.slice(path.indexOf('.') + 1)] = { path, sha256: sha256(bytes) };
  };
  keep(`${scan.name}.png`, png);
  keep(`${scan.name}.raw.json`, Buffer.from(`${JSON.stringify(raw, null, 2)}\n`));
  if (scan.pdf) {
    const pdf = scannedPdf(canvas.toBuffer('image/jpeg', 90), { width, height }, widthPt);
    keep(`${scan.name}.pdf`, pdf);
    const drawn = await drawnForOcr(new Uint8Array(pdf));
    record(
      `documents/scans/${scan.name}.pdf, its page drawn ${READ_LONG_SIDE} pixels on its longer side, as the review screen draws a scanned page`,
      await read(drawn.png, drawn, scan.locale),
      scan.record,
    );
  }
  const entry = {
    name: scan.name,
    from: `${scan.name}.pdf`,
    locale: scan.locale,
    dpi: DPI,
    skew: scan.skew,
    files,
  };
  manifest.scans = [...manifest.scans.filter((one) => one.name !== scan.name), entry].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  manifest.tool = `pdfjs-dist@${pdfjs.version} + ${raw.source.extractor}`;
  const words = raw.pages[0]?.words ?? [];
  console.log(
    `${scan.name}: ${words.length} words, least sure ${Math.min(...words.map((w) => w.ocrConfidence ?? 100))}`,
  );
}
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
if (only.length) {
  console.log(`${RECORDED} left as it was: it is written from every scan, not some.`);
} else {
  mkdirSync(dirname(RECORDED), { recursive: true });
  const source =
    "Written by pnpm corpus:scan: each picture read by tesseract.js in Node, in English and the scan's language, converted by recognisedFrom; the lines holding a printed box, or a word that could be taken for one, kept whole.";
  writeFileSync(RECORDED, `${JSON.stringify({ source, pages: recorded }, null, 2)}\n`);
}
