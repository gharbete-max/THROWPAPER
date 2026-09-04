import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { defaultTokens } from '@tp/tokens';

/**
 * The two things about the document itself that nobody looks at.
 *
 * `index.html` is written once and then never opened again, which is exactly how it ended up
 * holding a `theme-color` of `#1f4b99` — the blue this product shipped with two palettes ago — and
 * a `lang` of `sv` on an interface that comes in twelve languages.
 *
 * Neither is cosmetic. `theme-color` paints the address bar on Android and the status bar of an
 * installed app, so a stale one is a band of the wrong brand above every screen. `lang` is what a
 * screen reader picks a voice from, so a permanent `sv` had it pronouncing Japanese as Swedish.
 *
 * Both are set at runtime now — from the resolved custom property and the resolved locale, so they
 * follow the organisation's own kit and the reader's own language. What this test guards is the
 * markup they start from, which is the part that goes stale in silence.
 */
const HTML = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');

describe('the document shell', () => {
  it('starts from a colour the palette still contains', () => {
    const stated = /<meta name="theme-color" content="([^"]+)"/.exec(HTML)?.[1];
    expect(stated, 'index.html must declare a theme-color').toBeDefined();

    // Any of the shipped colours is fine; one from a palette we no longer ship is not.
    const palette = Object.values(defaultTokens.colour).map((value) => value.toLowerCase());
    expect(palette, `theme-color ${stated} is not in the palette`).toContain(stated!.toLowerCase());
  });

  it('does not claim to be in a language chosen years ago', () => {
    const lang = /<html lang="([^"]+)"/.exec(HTML)?.[1];
    expect(lang).toBeDefined();
    /**
     * English, because that is the language of the markup and the fallback everything resolves to.
     * Any other fixed language is a guess about a reader the file has never met — and `sv` in
     * particular is the guess this file used to make.
     */
    expect(lang).toBe('en');
  });

  it('links the icons the generator actually produces', () => {
    // A rename in `generate-icons.ts` would otherwise show as a missing tab icon and nothing else.
    for (const asset of ['/favicon.svg', '/icon-192.png']) {
      expect(HTML, `index.html should reference ${asset}`).toContain(asset);
    }
  });
});
