import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sourceFiles } from './source-files.js';
import { describe, expect, it } from 'vitest';
import { TRANSLATED_LOCALES } from './messages/index.js';
import { LOCALE_CODES } from '@tp/i18n';

const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

/**
 * The twelve catalogues must stay out of the entry chunk.
 *
 * Importing them all statically took the entry bundle from 307 kB to 548 kB, and the person
 * paying for that is a member of the public opening one form, on a phone, to read it in one
 * language. `messages/all.ts` exists for the completeness tests and pulls in every language by
 * design; one ordinary `import` of it from application code silently undoes the split, and
 * nothing else would notice — the app would work perfectly and merely be twice the size.
 */
describe('the language catalogues', () => {
  it('are never imported all at once by application code', () => {
    const offenders = sourceFiles(ROOT)
      .filter((path) => !path.endsWith(join('messages', 'all.ts')))
      .filter((path) => readFileSync(path, 'utf8').includes('messages/all.js'))
      .map((path) => path.slice(ROOT.length));

    expect(offenders, `these would pull every language into their chunk: ${offenders}`).toEqual([]);
  });

  /**
   * English is the last link in every fallback chain, so it has to be there before anything has
   * loaded. Making it dynamic would mean a blank interface rather than a briefly English one.
   */
  it('keep English loaded from the start', () => {
    const source = readFileSync(join(ROOT, 'lib', 'messages', 'index.ts'), 'utf8');
    expect(source).toContain("import { enGB, type MessageKey } from './en-GB.js'");
    expect(source).toContain("'en-GB': () => Promise.resolve(enGB)");
  });

  /** A locale the registry names but no loader can reach is a language the picker cannot deliver. */
  it('offer a loader for every locale in the registry', () => {
    expect([...TRANSLATED_LOCALES].sort()).toEqual([...LOCALE_CODES].sort());
  });
});
/**
 * The PDF reader is a megabyte and the OCR engine is another; each exists for one button in
 * the builder.
 *
 * `screens/builder/paper/extract.ts` and `ocr.ts` load them with `import()`. A static import
 * anywhere else would put them in the entry chunk for every member of the public opening a form
 * on a phone — and, as with the catalogues, nothing else would notice.
 */
describe('the PDF reader and the OCR engine', () => {
  it.each(['pdfjs-dist', 'tesseract.js'])('%s is only ever imported dynamically', (name) => {
    const escaped = name.replace('.', '[.]');
    const pattern = new RegExp(`(^|\\s)import\\s[^;]*from\\s+'${escaped}`, 'm');
    const offenders = sourceFiles(ROOT)
      .filter((path) => pattern.test(readFileSync(path, 'utf8')))
      .map((path) => path.slice(ROOT.length));
    expect(offenders, `these would put ${name} in the entry chunk: ${offenders}`).toEqual([]);
  });
});

/**
 * `CAVEATS.md` #43, `privacy`: a document never leaves the machine to be read, and what was read
 * is never stored anywhere but where the author saves it.
 *
 * The readers — the Word unzipper and XML reader, the stages, the worker — live in the paper
 * door and nowhere else, so they load only when somebody opens it: the editor's paper import
 * (`paper/`) and, since S10, the review screen (`review/`). And none of the modules that hold a
 * reading can reach the server. An import keeps only what the author presses a button for: the
 * source file, sent by `ImportPaper` (ADR 0004), or the questions "Use these questions" adds to
 * the draft, saved by `ReviewScreen`.
 */
describe('the document readers', () => {
  const PAPER = join('screens', 'builder', 'paper');
  const REVIEW = join('screens', 'builder', 'review');
  const READERS = [
    'docx.js',
    'zip.js',
    'xml.js',
    'pipeline.js',
    'reading.js',
    'read-in-worker.js',
    'import.worker',
    'clipboard.js',
  ];

  it('are imported from the paper door only', () => {
    const door = (path: string) =>
      [PAPER, REVIEW].some((dir) => path.includes(`${dir}/`) || path.includes(`${dir}\\`));
    const offenders = sourceFiles(ROOT)
      .filter((path) => !door(path))
      .filter((path) => {
        const source = readFileSync(path, 'utf8');
        return READERS.some((name) => source.includes(`paper/${name}`));
      })
      .map((path) => path.slice(ROOT.length));
    expect(
      offenders,
      `these would load a document reader outside the paper door: ${offenders}`,
    ).toEqual([]);
  });

  it('never talk to the server, and neither does what shows a reading', () => {
    const quiet = [
      'docx.ts',
      'zip.ts',
      'xml.ts',
      'refusal.ts',
      'pipeline.ts',
      'reading.ts',
      'read-in-worker.ts',
      'import.worker.ts',
      'clipboard.ts',
      'ReadingView.tsx',
    ];
    for (const name of quiet) {
      const source = readFileSync(join(ROOT, PAPER, name), 'utf8');
      expect(source, name).not.toMatch(/lib\/api|fetch\(|XMLHttpRequest|sendBeacon/);
    }
    const review = ['review.ts', 'fields.ts', 'keys.ts', 'SourcePane.tsx', 'DraftPane.tsx'];
    for (const name of review) {
      const source = readFileSync(join(ROOT, REVIEW, name), 'utf8');
      expect(source, name).not.toMatch(/lib\/api|fetch\(|XMLHttpRequest|sendBeacon/);
    }
  });
});

/**
 * `CAVEATS.md` #43 again, for the summary centre (ADR 0023, `docs/plan/DOCUMENTS.md` section 4).
 *
 * The centre holds a reading's text and sends it to a model — on this computer, through the
 * desktop shell's `window.loppaModel`. That is not `fetch`, and this test is what keeps it from
 * becoming one: nothing that holds the text may reach the server, and nothing may store it. The one
 * file of the centre that talks to the server, `FormSource.tsx`, only brings a form's words *in*.
 * The centre is a lazy chunk, and the hosted edition has no bridge to call.
 */
describe('the summary centre', () => {
  const HOLDS_TEXT = [
    'screens/Summary.tsx',
    'screens/summary/Setup.tsx',
    'screens/summary/job.ts',
    'screens/summary/text.ts',
    'lib/model-bridge.ts',
  ];

  it.each(HOLDS_TEXT)('%s never talks to the server and never stores a text', (name) => {
    const source = readFileSync(join(ROOT, name), 'utf8');
    expect(source).not.toMatch(
      /lib\/api|fetch\(|XMLHttpRequest|sendBeacon|WebSocket|localStorage|sessionStorage|indexedDB|document\.cookie/,
    );
  });

  it('is only loaded on demand, and only Summary.tsx reaches into its folder', () => {
    const app = readFileSync(join(ROOT, 'App.tsx'), 'utf8');
    expect(app).toMatch(/lazy\(\(\) => import\('\.\/screens\/Summary\.js'\)/);
    expect(app).not.toMatch(/^import .*screens\/Summary/m);
    const offenders = sourceFiles(ROOT)
      .filter((path) => !path.includes(join('screens', 'summary')) && !path.endsWith('Summary.tsx'))
      .filter((path) => /screens\/summary\//.test(readFileSync(path, 'utf8')))
      .map((path) => path.slice(ROOT.length));
    expect(offenders).toEqual([]);
  });

  it('is the only place that reaches for the bridge', () => {
    const offenders = sourceFiles(ROOT)
      .filter((path) => !path.endsWith('model-bridge.ts'))
      .filter((path) => readFileSync(path, 'utf8').includes('window.loppaModel'))
      .map((path) => path.slice(ROOT.length));
    expect(offenders).toEqual([]);
  });
});
