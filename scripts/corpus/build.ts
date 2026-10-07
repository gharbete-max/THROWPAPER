/**
 * `pnpm corpus:build` — the golden corpus's files, from its specs (`documents.ts`).
 *
 * Each spec is written as a Word file, and LibreOffice (headless, in a profile of its own) reads it
 * and writes the corpus PDF and re-saves it as the corpus DOCX. The files in `fixtures/documents/`
 * are LibreOffice's, and `SOURCES.json` records each one's hash, so a test reads exactly what was
 * committed and a changed file is a failing test, never a silent drift. A rebuild changes the PDFs'
 * bytes (LibreOffice stamps the time) — rebuild only when a spec changes, and re-check the
 * expectations by hand when you do.
 *
 * A real document (`origin: "real"` in `SOURCES.json`) was found, not written here: the build keeps
 * its entry as it is, never writes its files, and refuses a spec that has its name (`keptBy`).
 *
 * Needs `soffice` on the PATH (LibreOffice 24.2 or later). Not part of `verify`: the tests read the
 * committed files and need nothing installed.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CORPUS } from './documents.js';
import { corpusSources, keptBy } from './sources.js';
import { wordDocument } from './word.js';

const OUT = resolve(import.meta.dirname, '../../fixtures/documents');
const only = process.argv.slice(2);
const documents = only.length ? CORPUS.filter((doc) => only.includes(doc.name)) : CORPUS;
if (documents.length === 0) throw new Error(`No corpus document is called ${only.join(', ')}.`);
const manifest = join(OUT, 'SOURCES.json');
const kept = keptBy(
  corpusSources.parse(JSON.parse(readFileSync(manifest, 'utf8'))).documents,
  documents.map((doc) => doc.name),
  only.length > 0,
);

const work = mkdtempSync(join(tmpdir(), 'loppa-corpus-'));
const soffice = (...args: string[]) =>
  execFileSync(
    'soffice',
    [`-env:UserInstallation=${pathToFileURL(join(work, 'profile')).href}`, ...args],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );

try {
  const tool = soffice('--version').trim().split(' ').slice(0, 2).join(' ');
  const source = join(work, 'source');
  mkdirSync(source);
  const sources = documents.map((doc) => {
    const path = join(source, `${doc.name}.docx`);
    writeFileSync(path, wordDocument(doc.word));
    return path;
  });
  const convert = (target: string, dir: string) =>
    soffice(
      '--headless',
      '--norestore',
      '--convert-to',
      target,
      '--outdir',
      join(work, dir),
      ...sources,
    );
  convert('pdf', 'pdf');
  convert('docx:MS Word 2007 XML', 'docx');

  mkdirSync(OUT, { recursive: true });
  const sha256 = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
  const built = documents.map((doc) => {
    const files = Object.fromEntries(
      (['pdf', 'docx'] as const).map((format) => {
        const file = `${doc.name}.${format}`;
        copyFileSync(join(work, format, file), join(OUT, file));
        return [format, { path: file, sha256: sha256(join(OUT, file)) }];
      }),
    );
    return {
      name: doc.name,
      language: doc.language,
      summary: doc.summary,
      features: doc.features,
      spec: 'scripts/corpus/documents.ts',
      files,
    };
  });
  const all = [...kept, ...built].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  writeFileSync(
    manifest,
    `${JSON.stringify(
      {
        $comment:
          'The golden corpus (docs/plan/IMPORT-PIPELINE.md). The documents written for Loppa are dedicated to the public domain (the licence below), built by `pnpm corpus:build`, never edited by hand; a real one (origin "real") carries its own licence and source, and is never built.',
        licence: 'CC0-1.0',
        tool,
        documents: all,
      },
      null,
      2,
    )}\n`,
  );
  for (const doc of built)
    console.log(
      `${doc.name}: ${doc.files.pdf!.sha256.slice(0, 12)} ${doc.files.docx!.sha256.slice(0, 12)}`,
    );
  console.log(`${built.length} built with ${tool}.`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
