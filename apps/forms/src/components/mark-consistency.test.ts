import { describe, expect, it } from 'vitest';
import { CENTRE, FACETS, MARK, REDUCED } from './mark-geometry.js';
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
   * Nothing reaches past the four points.
   *
   * This asserted a *diamond* — `|x-50| + |y-50| <= 46`, one convex shape with four corners — back
   * when the flaps met along shared edges. The mark is drawn open now, so the mouths of the pockets
   * sit out at 51.5° where that sum is 56.5, and the old test failed for the right reason: the
   * silhouette genuinely is not a diamond any more.
   *
   * What still has to hold is the bound that the sizing was tuned against. Every point sits within
   * the circle the four tips describe, so the mark occupies the box it claims to and a flap cannot
   * quietly grow past the point it belongs to.
   */
  it('keeps every corner within the reach of its points', () => {
    for (const facet of FACETS) {
      for (const [x, y] of facet.points) {
        const reach = Math.hypot(x - 50, y - 50);
        expect(reach, `${facet.id} reaches past the tips`).toBeLessThanOrEqual(46.01);
      }
    }
  });

  /**
   * The pockets are open, which is the entire point of the drawing.
   *
   * A fortune teller with its flaps touching is a folded napkin: the object is only recognisable
   * because it is parted. So the four slits are asserted rather than left to the geometry — the
   * failure being prevented is a well-meaning tidy-up that closes the gap to make the outline
   * "cleaner" and silently turns the mark back into a diamond.
   *
   * Measured between the mouths of neighbouring pockets, which is where the slit actually is. The
   * tips are 90° apart and each pocket spans 77°, leaving 13° of daylight at each corner.
   */
  it('parts the four pockets', () => {
    const angle = ([x, y]: readonly [number, number]) =>
      (Math.atan2(50 - y, x - 50) * 180) / Math.PI;

    // The mouth of each facet — points[1] — is the edge that faces the next pocket along.
    const mouths = FACETS.map((facet) => angle(facet.points[1])).sort((a, b) => a - b);
    expect(mouths).toHaveLength(8);

    const gaps: number[] = [];
    for (let i = 0; i < mouths.length; i += 1) {
      const next = mouths[(i + 1) % mouths.length]!;
      const span = (next - mouths[i]! + 360) % 360;
      gaps.push(Math.round(span));
    }

    // Four slits of 13° between pockets, and four spans of 77° across a pocket.
    expect(gaps.filter((gap) => gap === 13)).toHaveLength(4);
    expect(gaps.filter((gap) => gap === 77)).toHaveLength(4);
  });

  /**
   * The small drawing is the same object with less said, not a different one.
   *
   * Below about 32px the fold highlight is a few percent of value across a handful of pixels and
   * reads as blur rather than as a crease, and a 13° slit closes up entirely under antialiasing.
   * `REDUCED` drops the first and widens the second. What it must not do is move the toy: same
   * centre, same four points, same two hue families in the same places.
   */
  it('reduces to four flaps on the same four points', () => {
    expect(REDUCED).toHaveLength(4);

    for (const flap of REDUCED) {
      expect(flap.points[0], `${flap.id} does not start at the centre`).toEqual(CENTRE);

      // The tip is shared with the full drawing's pair for the same pocket, to the last decimal.
      const pair = FACETS.filter((facet) => facet.pocket === flap.id);
      expect(pair).toHaveLength(2);
      for (const facet of pair) {
        expect(facet.points[2], `${flap.id} points somewhere else`).toEqual(flap.points[2]);
      }
    }

    // Two families, alternating, exactly as the full drawing groups them.
    expect(REDUCED.map((flap) => flap.tone)).toEqual(['face', 'warm', 'face', 'warm']);
  });

  /**
   * Its slits are wider, or it would not be worth drawing twice.
   *
   * Measured as the angle between the two mouths of a flap rather than the distance between them,
   * which is the trap this test fell into first: the reduced drawing pushes its mouths further out
   * along the flap, so the *chord* between them can grow while the pocket narrows. The slit is an
   * angle, so it is compared as one — 21° of daylight at each corner against the full drawing's 13.
   */
  it('opens the small drawing further than the full one', () => {
    const angle = ([x, y]: readonly [number, number]) =>
      (Math.atan2(50 - y, x - 50) * 180) / Math.PI;

    /** A quadrant is 90°; whatever the pocket does not span is the slit beside it. */
    const slitBeside = (a: readonly [number, number], b: readonly [number, number]) =>
      Math.round(90 - Math.abs(((angle(a) - angle(b) + 540) % 360) - 180));

    for (const flap of REDUCED) {
      const pair = FACETS.filter((facet) => facet.pocket === flap.id);
      const full = slitBeside(pair[0]!.points[1], pair[1]!.points[1]);
      const reduced = slitBeside(flap.points[1], flap.points[3]);

      expect(full, `${flap.id} full slit`).toBe(13);
      expect(reduced, `${flap.id} reduced slit`).toBe(21);
      expect(reduced).toBeGreaterThan(full);
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
