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
