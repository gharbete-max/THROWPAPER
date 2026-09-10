import { describe, expect, it } from 'vitest';
import { CENTRE, FACETS, MARK } from './mark-geometry.js';
import { markSvg } from '../../../../scripts/generate-icons.js';

/**
 * The mark is drawn in two places and they must be the same mark.
 *
 * The old one was drawn in three, with the numbers written out by hand in each, and a test to
 * catch them drifting. That test earned its keep — but the drift it was catching was a problem the
 * duplication created. The geometry is a plain module now: the component imports it and so does
 * the icon script, and the only way they can disagree is if one of them stops importing it.
 *
 * Which is precisely what this checks. It is a cheap test for a quiet, embarrassing failure: a
 * redrawn logo in the top bar while the browser tab and the installed app still show the old one.
 */
describe('the mark', () => {
  it('is eight triangles', () => {
    expect(FACETS).toHaveLength(8);
    for (const facet of FACETS) {
      expect(facet.points, `${facet.id} is not a triangle`).toHaveLength(3);
    }
  });

  it('draws every facet as a closed three-point path', () => {
    for (const facet of FACETS) {
      // `M x y L x y L x y Z` — the shape a browser can interpolate and a renderer can fill.
      expect(MARK[facet.id]).toMatch(/^M[\d.]+ [\d.]+ L[\d.]+ [\d.]+ L[\d.]+ [\d.]+ Z$/);
    }
  });

  it('puts the same geometry in the launcher icon', () => {
    const svg = markSvg(512);
    for (const facet of FACETS) {
      expect(svg, `the icon is missing ${facet.id}`).toContain(MARK[facet.id]);
    }
  });

  /**
   * All eight meet at the pinch, which is what makes this a folded object rather than a pinwheel.
   *
   * It is also what the animation is built on: `Mark.tsx` gives every facet the same
   * `transform-origin` and varies only the axis through it, so a facet that did not own the centre
   * would turn about a point it is not attached to and tear away from the mark.
   */
  it('folds every facet from the same pinch', () => {
    for (const facet of FACETS) {
      expect(facet.points[0], `${facet.id} does not start at the centre`).toEqual(CENTRE);
    }
  });

  /**
   * The silhouette is a diamond, and that is the whole reason a picture is allowed to be the mark.
   *
   * A letterform survives being small because the reader already knows it; a picture has to survive
   * on outline alone. Every point of every facet must therefore sit on or inside the diamond
   * `|x-50| + |y-50| <= 46` — one convex shape with four corners. A facet poking outside it turns
   * the outline lumpy, which is invisible at hero size and fatal at 16px.
   */
  it('keeps the outline a clean diamond', () => {
    for (const facet of FACETS) {
      for (const [x, y] of facet.points) {
        const reach = Math.abs(x - 50) + Math.abs(y - 50);
        expect(reach, `${facet.id} reaches outside the diamond`).toBeLessThanOrEqual(46.01);
      }
    }
  });

  /**
   * Each of the four points is a pocket, and a pocket is two facets that open away from each other.
   *
   * One facet with a pocket to itself cannot open — there is nothing for it to part from — and
   * three would not be a fold anybody could make in paper. Opposite `swing` is what makes the pair
   * part rather than slide; the same sign twice is the bug that reads as a rendering fault rather
   * than as a mistake in the data, so it is worth asserting here where it is legible.
   */
  it('gives every point two facets that open away from each other', () => {
    for (const pocket of ['north', 'east', 'south', 'west'] as const) {
      const pair = FACETS.filter((facet) => facet.pocket === pocket);
      expect(pair, `${pocket} is not a pair`).toHaveLength(2);
      expect(pair[0]!.swing + pair[1]!.swing, `${pocket} does not open`).toBe(0);
    }
  });

  /**
   * Every hinge is a radius to an edge, never to a point.
   *
   * This is the difference between the toy opening at its four points — which is what a fortune
   * teller does — and it opening along its four edges, which is what nothing does. The points are
   * 46 from the centre and the edge midpoints 32.5, so the hinge is identifiable from the geometry
   * alone without restating which is which.
   *
   * Straight-line distance, not the `|dx| + |dy|` of the test above. On this shape that sum is 46
   * for a corner *and* for an edge midpoint — which is precisely what "the outline is a diamond"
   * means — so it cannot tell the two apart. Using it here passed the corners off as edges.
   */
  it('hinges on the edges, so the points are what open', () => {
    for (const facet of FACETS) {
      const [, [hx, hy], [tx, ty]] = facet.points;
      const hinge = Math.hypot(hx - 50, hy - 50);
      const tip = Math.hypot(tx - 50, ty - 50);
      expect(hinge, `${facet.id} hinges on a point rather than an edge`).toBeLessThan(tip);
    }
  });

  /**
   * Two facets that touch may not be the same tone, or the crease between them is not drawn.
   *
   * This is not a theoretical failure. The first arrangement put the bowl's spine in the same tone
   * as the stem beside it, and the letter came out as a bowl floating next to a bar — the edge was
   * there in the geometry and invisible on the screen.
   */
  it('never lets two touching facets share a tone', () => {
    const key = (point: readonly [number, number]) => point.join(',');

    for (const a of FACETS) {
      for (const b of FACETS) {
        if (a.id >= b.id) continue;
        const shared = a.points.filter((point) =>
          b.points.some((other) => key(other) === key(point)),
        );
        // Two shared corners is an edge; one is only a touching point.
        if (shared.length < 2) continue;
        expect(a.tone, `${a.id} and ${b.id} share an edge and a tone`).not.toBe(b.tone);
      }
    }
  });
});
