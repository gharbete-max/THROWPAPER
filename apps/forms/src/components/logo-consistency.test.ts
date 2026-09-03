import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { defaultTokens } from '@tp/tokens';
import { MARK_FACES, MARK_OFFSET } from './FortuneTeller.js';

/**
 * The mark is drawn in four places, and they must be the same mark.
 *
 * `FortuneTeller` holds the geometry and renders it; `scripts/generate-icons.ts` bakes the same
 * numbers into the favicon and the launcher icons; the fold's last keyframe lands on it; and the
 * hover animation starts and ends there. Nothing but this test connects them — the icon script
 * runs in node and a CSS keyframe imports nothing at all, so the numbers are written out three
 * times on purpose. Duplicating six coordinates is cheaper than building a renderer to avoid it,
 * but only if something notices when one copy changes.
 *
 * The failure this prevents is quiet and embarrassing: a redrawn logo in the top bar while the
 * browser tab, the installed app and the intro all still show the old one.
 */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

const ICONS = read('../../../../scripts/generate-icons.ts');
const STYLES = read('../styles.css');

/** The `(x, y)` pairs in a path, in order. */
function points(path: string): Array<[number, number]> {
  return [...path.matchAll(/(-?[\d.]+)\s+(-?[\d.]+)/g)].map((match) => [
    Number(match[1]),
    Number(match[2]),
  ]);
}

/**
 * A pose as an order-independent key.
 *
 * A set rather than a list: a fold may arrive at a given corner from any of the three points, so
 * the order is the animation's business. Which corners they are is the mark's.
 */
function corners(path: string, dy = 0): string {
  return points(path)
    .map(([x, y]) => `${x},${Math.round((y + dy) * 100) / 100}`)
    .sort()
    .join(' ');
}

/** The `d` of one flap at a given percentage of a keyframe animation. */
function poseAt(animation: string, percent: string): string {
  const block = STYLES.slice(STYLES.indexOf(`@keyframes ${animation}`));
  const at = block.slice(block.indexOf(percent));
  return /path\('([^']+)'\)/.exec(at)?.[1] ?? '';
}

/** The path data the icon script holds, in `PLANE_PATHS`. */
function scriptPaths(): string[] {
  const block = ICONS.slice(ICONS.indexOf('PLANE_PATHS'), ICONS.indexOf('} as const;'));
  return [...block.matchAll(/'(M[^']+)'/g)].map((match) => match[1]!.replace(/\s+/g, ' ').trim());
}

/** Which flap becomes which face of the plane. */
const FACES = [
  ['nw', 'topWing'],
  ['se', 'keel'],
  ['sw', 'nearWing'],
] as const;

describe('the mark, wherever it is drawn', () => {
  it('is the same three polygons in the component and in the icon script', () => {
    const [topWing, keel, nearWing] = scriptPaths();
    expect([topWing, keel, nearWing].every(Boolean), 'icon script must hold three faces').toBe(
      true,
    );

    // The component draws the mark inside a square, so it sits lower by a fixed offset.
    const expected = { topWing, keel, nearWing };
    for (const [flap, face] of FACES) {
      expect(corners(MARK_FACES[flap]), `${flap} → ${face}`).toBe(
        corners(expected[face]!, MARK_OFFSET),
      );
    }
  });

  it('collapses the quarter the plane has no face for', () => {
    // Four quarters, three faces. The spare one folds onto the nose and must be a single point.
    const spare = points(MARK_FACES.ne);
    expect(new Set(spare.map(String)).size).toBe(1);
  });

  it('uses brand tokens for its colours and never a literal', () => {
    /**
     * A hard-coded colour would survive a customer changing their palette, which is exactly what
     * `CLAUDE.md` rule 4 exists to prevent. The keel is a `color-mix` of the primary rather than a
     * fourth token, which still reads the customer's colour.
     */
    const fills = [...STYLES.matchAll(/\.ft__flap[^{]*\{[^}]*fill:\s*([^;]+);/g)].map((match) =>
      match[1]!.trim(),
    );

    expect(fills.length).toBeGreaterThan(0);
    expect(fills.every((fill) => fill.includes('var(--tp-colour-'))).toBe(true);
  });

  /**
   * The fold has to land on the mark, exactly, and the hover has to start and end there.
   *
   * The final frame of the intro is the one that stays on the screen, and the hover's first and
   * last frames are what a pointer arriving and leaving reveal. A pose a few units off the mark is
   * a logo that visibly jumps — the kind of thing that reads as a bug without anyone being able to
   * say what moved.
   */
  it.each([
    ['the fold ends on it', 'ft-fold', '100%'],
    ['the hover starts and ends on it', 'ft-open', '0%'],
  ])('%s', (_name, animation, percent) => {
    for (const [flap] of FACES) {
      expect(corners(poseAt(`${animation}-${flap}`, percent)), flap).toBe(
        corners(MARK_FACES[flap]),
      );
    }
  });

  /**
   * The generated icons are a committed build artefact, so they go stale silently.
   *
   * They did: the palette moved to parchment and midnight and the favicon stayed on the old blue,
   * so the browser tab wore the previous brand while the product wore the new one. The shape check
   * passed the whole time, because only the colours had changed and nothing looked at those.
   */
  it('has regenerated icons since the palette last changed', () => {
    const favicon = read('../../public/favicon.svg');
    const { colour } = defaultTokens;

    expect(favicon, 'run `pnpm icons`').toContain(colour.primary);
    expect(favicon, 'run `pnpm icons`').toContain(colour.background);
    expect(favicon, 'run `pnpm icons`').toContain(colour.accent);
  });
});
