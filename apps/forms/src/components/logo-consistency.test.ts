import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The mark is drawn in three places, and they must be the same mark.
 *
 * `Logo.tsx` renders it in the app, `scripts/generate-icons.ts` bakes it into the launcher icons
 * and the favicon, and `Intro.tsx` throws it across the screen. Nothing but this test connects
 * them: the script runs in node and cannot import JSX, so the path data is written out twice on
 * purpose — duplicating six numbers is cheaper than building a renderer to avoid it, but only if
 * something notices when one copy changes.
 *
 * The failure this prevents is quiet and embarrassing: a redrawn logo in the top bar while the
 * browser tab, the installed app and the intro all still show the old one.
 */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

const LOGO = read('./Logo.tsx');
const ICONS = read('../../../../scripts/generate-icons.ts');
const INTRO = read('./Intro.tsx');

/** Every `d="…"` on a `<path>` in a component, in order. */
function drawnPaths(source: string): string[] {
  return [...source.matchAll(/<path[^>]*\sd="(M[^"]+)"/g)].map((match) =>
    match[1]!.replace(/\s+/g, ' ').trim(),
  );
}

/**
 * The path data the icon script holds, in `PLANE_PATHS`.
 *
 * It lives in an object rather than in markup because that script assembles SVG strings — so the
 * two copies cannot be compared by looking for the same syntax, only for the same numbers.
 */
function scriptPaths(source: string): string[] {
  const block = source.slice(source.indexOf('PLANE_PATHS'), source.indexOf('} as const;'));
  return [...block.matchAll(/'(M[^']+)'/g)].map((match) => match[1]!.replace(/\s+/g, ' ').trim());
}

describe('the mark, wherever it is drawn', () => {
  it('is the same three polygons in the component and in the icon script', () => {
    const inLogo = drawnPaths(LOGO);
    const inIcons = scriptPaths(ICONS);

    // Three faces: top wing, keel, near wing. If this is not three, the drawing changed shape.
    expect(inLogo).toHaveLength(3);
    expect(inIcons).toEqual(inLogo);
  });

  it('uses brand tokens for its colours and never a literal', () => {
    /**
     * A hard-coded colour here would survive a customer changing their palette, which is exactly
     * what `CLAUDE.md` rule 4 exists to prevent.
     *
     * Only the shapes are checked: `<svg fill="none">` on the element itself is a reset rather
     * than a colour, and counting it would make this assertion impossible to satisfy.
     */
    const fills = [...LOGO.matchAll(/<path[^>]*\sfill="([^"]+)"/g)].map((match) => match[1]!);
    expect(fills.length).toBeGreaterThan(0);
    expect(fills.every((fill) => fill.startsWith('var(--tp-colour-'))).toBe(true);
  });

  it('throws the same plane in the intro as it lands in the top bar', () => {
    // Scaled and offset, so the path data differs — but the number of faces must not.
    const introPlane = INTRO.slice(INTRO.indexOf('intro__paper'));
    const faces = drawnPaths(introPlane);
    expect(faces.length).toBeGreaterThanOrEqual(2);
  });
});
