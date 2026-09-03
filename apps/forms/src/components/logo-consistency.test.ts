import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The mark is drawn in three places, and they must be the same mark.
 *
 * `Logo.tsx` renders it in the app, `scripts/generate-icons.ts` bakes it into the launcher icons
 * and the favicon, and the fold in `styles.css` ends on it. Nothing but this test connects them:
 * the script runs in node and cannot import JSX, and a CSS keyframe cannot import anything at all,
 * so the path data is written out three times on purpose — duplicating six numbers is cheaper than
 * building a renderer to avoid it, but only if something notices when one copy changes.
 *
 * The failure this prevents is quiet and embarrassing: a redrawn logo in the top bar while the
 * browser tab, the installed app and the intro all still show the old one.
 */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

const LOGO = read('./Logo.tsx');
const ICONS = read('../../../../scripts/generate-icons.ts');
/** The fold's keyframes: its last pose is the mark. See `FortuneTeller.tsx`. */
const STYLES = read('../styles.css');

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

  /**
   * The fold has to land on the mark, exactly.
   *
   * This assertion used to be "the intro contains at least two `<path>` elements", because the
   * intro drew its own small copy of the plane and there was no way to compare a hand-scaled copy
   * to the original. The fold changed that: its last keyframe *is* the mark, moved down the
   * viewBox to sit in a square, so the two can be checked number for number.
   *
   * That matters more than the old check did. The final frame of the intro is the one that stays
   * on the screen, and a fold that ends a few units off the logo is a mark that visibly jumps when
   * the overlay clears — the kind of thing that reads as a bug without anyone being able to say
   * what moved.
   */
  it('ends the fold on exactly the mark in the top bar', () => {
    const points = (path: string): Array<[number, number]> =>
      [...path.matchAll(/(-?[\d.]+)\s+(-?[\d.]+)/g)].map((match) => [
        Number(match[1]),
        Number(match[2]),
      ]);

    /** The `100%` pose of one flap's fold. */
    const finalPose = (flap: string): string => {
      const block = STYLES.slice(STYLES.indexOf(`@keyframes ft-fold-${flap}`));
      const at100 = block.slice(block.indexOf('100%'));
      return /path\('([^']+)'\)/.exec(at100)?.[1] ?? '';
    };

    // The mark's own three faces, and where each one ends up.
    const [topWing, keel, nearWing] = drawnPaths(LOGO);
    const pairs: Array<[string, string]> = [
      [topWing!, finalPose('nw')],
      [keel!, finalPose('se')],
      [nearWing!, finalPose('sw')],
    ];

    // A set, not a list: a fold may arrive at a corner from any of the three, so the order of the
    // points is the animation's business. Which corners they are is the mark's.
    const key = (list: Array<[number, number]>, dy = 0) =>
      list
        .map(([x, y]) => `${x},${y + dy}`)
        .sort()
        .join(' ');

    /** One offset for all three, or the faces have drifted apart rather than moved together. */
    const OFFSET = 24;
    for (const [face, landed] of pairs) {
      expect(key(points(landed)), face).toBe(key(points(face), OFFSET));
    }

    // And the fourth quarter, which the plane has no face for, folds away to a single point.
    const vanished = points(finalPose('ne'));
    expect(new Set(vanished.map(String)).size, 'the spare quarter must collapse').toBe(1);
  });
});
