import { describe, expect, it } from 'vitest';
import { FACETS, MARK } from './mark-geometry.js';
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
  it('is nine triangles', () => {
    expect(FACETS).toHaveLength(9);
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
   * A P needs a hole, and the hole is the first thing to close up when the mark is scaled down to
   * a favicon. The counter is the triangle the seven bowl facets are arranged around; if a future
   * edit shrinks it, this is what says so before somebody ships a blob on a stick.
   */
  it('keeps a counter big enough to survive a favicon', () => {
    const counter = FACETS.filter((facet) => facet.id.startsWith('bowl'))
      .flatMap((facet) => facet.points)
      .filter(([x]) => x > 50 && x < 80);
    const ys = counter.map(([, y]) => y);
    const height = Math.max(...ys) - Math.min(...ys);

    // In a 100-unit drawing at 24px, a 25-unit counter is 6px of daylight.
    expect(height).toBeGreaterThanOrEqual(24);
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
