import { readFileSync } from 'node:fs';
import { sourceFiles } from './source-files.js';
import { describe, expect, it } from 'vitest';

/**
 * Two ways a literal string reaches a screen, and this refuses both.
 *
 * `placeholder="…"` is text a person reads inside a box, and it had been written straight into
 * JSX three times — `https://` twice in the builder, `AB12-CD34` at the door — while every other
 * string went through `t()`. And `EventForm` once showed the *code* `load-failed` when the event
 * list could not be fetched: a state value that was only ever meant to be tested, rendered as if
 * it were a sentence. CLAUDE.md rule 4 says neither may happen; the type system cannot see either.
 *
 * A placeholder written as `placeholder={t('…')}` does not match — the brace is the tell.
 */
const LITERAL_PLACEHOLDER = /placeholder="[^"]+"/;
const RENDERED_CODE = /setError\('load-failed'\)/;
const SOURCE_ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

describe('literal strings on screens', () => {
  it('are not written into placeholders', () => {
    const offenders = sourceFiles(SOURCE_ROOT)
      .filter((file) => file.endsWith('.tsx'))
      .filter((file) => LITERAL_PLACEHOLDER.test(readFileSync(file, 'utf8')))
      .map((file) => file.slice(SOURCE_ROOT.length));

    expect(offenders).toEqual([]);
  });

  it('are not error codes handed to the user', () => {
    const offenders = sourceFiles(SOURCE_ROOT)
      .filter((file) => RENDERED_CODE.test(readFileSync(file, 'utf8')))
      .map((file) => file.slice(SOURCE_ROOT.length));

    expect(offenders).toEqual([]);
  });

  it('is a regex that tells a literal from a translated one', () => {
    expect(LITERAL_PLACEHOLDER.test('<input placeholder="https://" />')).toBe(true);
    expect(LITERAL_PLACEHOLDER.test("<input placeholder={t('url.placeholder')} />")).toBe(false);
    expect(LITERAL_PLACEHOLDER.test('<input placeholder="" />')).toBe(false);
  });
});
