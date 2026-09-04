import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Every application source file under `dir`, recursively — tests excluded.
 *
 * Several tests in this app are *properties over the source tree* rather than assertions about
 * one module: no native dialogs anywhere, no key asked for that the catalogue lacks, no import
 * that would undo the language split, no field property left unhandled. Each of them needs the
 * same walk, and each had grown its own byte-identical copy — four by the time anybody counted.
 *
 * One copy, because the interesting part is what counts as application source, and that is a
 * decision this repo should make once. Tests are excluded here: a guard that catches itself in
 * its own fixture reports a failure nobody can act on.
 */
export function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [path] : [];
  });
}

/**
 * The app's `src/` directory, as a path `readdirSync` accepts on Windows too.
 *
 * `new URL(...).pathname` yields `/C:/Users/...` on Windows, which Node's fs rejects; the leading
 * slash comes off. Every caller was doing this by hand with the same regex.
 */
export const APP_SOURCE_ROOT = new URL('../', import.meta.url).pathname.replace(
  /^\/([A-Za-z]:)/,
  '$1',
);
