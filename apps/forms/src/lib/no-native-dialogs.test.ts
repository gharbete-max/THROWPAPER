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
 */
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
      .filter((file) => /\bwindow\.(confirm|alert|prompt)\s*\(/.test(readFileSync(file, 'utf8')))
      .map((file) => file.slice(SOURCE_ROOT.length));

    expect(offenders).toEqual([]);
  });
});
