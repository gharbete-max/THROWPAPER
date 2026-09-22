import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The wordmark on the sign-in page is a link home, and a link nobody styles is blue.
 *
 * `Login.tsx` wraps `<Wordmark>` in `<a class="login__home">` and nothing in the stylesheet named
 * it, so the product's own name on its front door painted in the browser's default `#0000ee` —
 * the one hue on that page that is in no palette, seen by every customer at the one moment the
 * brand matters most. Found measuring the sign-in page after the palette moved to gold; it had
 * been there under seafoam too.
 *
 * Checked in the source, as the field tests are: there is no DOM in this workspace.
 */
const LOGIN = readFileSync(new URL('./Login.tsx', import.meta.url), 'utf8');
const CSS = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

describe('the sign-in wordmark', () => {
  it('is a link home', () => {
    expect(LOGIN).toMatch(/<a className="login__home" href="\/">\s*<Wordmark/);
  });

  it('paints in the ink, not the browser’s link blue', () => {
    const rule = /\.login__home\s*\{([^}]*)\}/.exec(CSS)?.[1];
    expect(rule, '.login__home has no rule').toBeTruthy();
    expect(rule).toMatch(/color:\s*(inherit|var\(--tp-colour-(text|heading)\))/);
    expect(rule).toMatch(/text-decoration:\s*none/);
  });
});
