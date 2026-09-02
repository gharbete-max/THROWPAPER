import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `window.confirm`, `alert` and `prompt` are banned in this app.
 *
 * Not a style rule. In an embedded browser — a desktop app's webview, an in-app browser, anything
 * that suppresses native dialogs — `window.confirm` returns `false` without showing anything, so
 * the guarded action silently does nothing and the user reports the feature as broken. That is
 * exactly what happened: removing a field, archiving an event, restoring a version and overriding
 * an incomplete publish were all dead, and all four looked like ordinary buttons.
 *
 * `components/Confirm.tsx` is the replacement. This test is what stops the old habit coming back.
 *
 * ## Why it does not look for `window.`
 *
 * The first version of this test matched `window.confirm(` and nothing else, so `Events.tsx` — one
 * `await confirm(...)`, no prefix — passed it while archiving an event stayed as dead as it had
 * ever been. A bare `confirm(` *is* `window.confirm`; the prefix is the part people leave out.
 *
 * So the rule is the other way round: any call to `confirm`, `alert` or `prompt` is an offence
 * unless the file also reaches for `useConfirm()`, which is the only legitimate source of a
 * binding by that name.
 */
const CALL = /(?<![.\w$])(?:window\.)?(?:confirm|alert|prompt)\s*\(/;
const SOURCE_ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [full] : [];
  });
}

describe('native dialogs', () => {
  it('are not used anywhere in the app', () => {
    const offenders = sourceFiles(SOURCE_ROOT)
      .filter((file) => !file.endsWith(join('components', 'Confirm.tsx')))
      .filter((file) => {
        const source = readFileSync(file, 'utf8');
        return CALL.test(source) && !source.includes('useConfirm(');
      })
      .map((file) => file.slice(SOURCE_ROOT.length));

    expect(offenders).toEqual([]);
  });

  /** The regex is the whole test, so it gets its own examples. */
  it('catches a bare call, not the hook that replaces it', () => {
    expect(CALL.test('if (!(await confirm(message))) return;')).toBe(true);
    expect(CALL.test('window.confirm("really?")')).toBe(true);
    expect(CALL.test('alert(`done`)')).toBe(true);
    expect(CALL.test('const confirm = useConfirm();')).toBe(false);
    expect(CALL.test('export function useConfirm(): Ask {')).toBe(false);
    expect(CALL.test('page.on("dialog", d => d.accept())')).toBe(false);
  });
});
