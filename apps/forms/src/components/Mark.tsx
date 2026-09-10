import type { CSSProperties } from 'react';
import { FACETS, MARK, type Facet } from './mark-geometry.js';

/**
 * The house mark, and the only drawing of it.
 *
 * `rest` is the toy closed, still, which is what a logo in a top bar should be. `open` works it
 * while somebody points at it. `intro` runs the same working once, slower, as the app arrives.
 *
 * ## The fold is a transform, not a second drawing
 *
 * The obvious way to animate folded paper is to write an opened pose and interpolate `d` between
 * the two. That was an earlier mark's trick and it worked, but it meant the geometry existed twice
 * more — once in a CSS keyframe, which imports nothing and so had to be kept in step by a test.
 *
 * Rotating each facet about its own crease costs no second copy. The crease is an edge the facet
 * already has, so the axis comes out of the same numbers the shape does, and the browser turns the
 * triangle in three dimensions rather than sliding its corners around in two — which is what paper
 * actually does.
 *
 * ## Why the axis is per facet and not one shared diagonal
 *
 * The previous mark folded every facet about `(1, -1, 0)` — the corner-to-corner crease of a sheet,
 * the same axis for all nine — because a letter has no single centre for them to turn around. A
 * fortune teller does: all eight creases are radii of the same point, and each facet has to turn
 * about *its own*, or the mark shears instead of opening. So the axis is computed here from the
 * hinge the geometry already names, and handed to CSS as a vector.
 */
export function Mark({
  mode = 'rest',
  className,
}: {
  mode?: 'rest' | 'open' | 'intro';
  className?: string;
}) {
  return (
    <svg
      className={`mark mark--${mode}${className ? ` ${className}` : ''}`}
      viewBox="0 0 100 100"
      fill="none"
      /*
       * Hidden from the accessibility tree at every call site.
       *
       * Each one already carries its own wording: the wordmark says "Formwork" beside it, the
       * loading indicator has its label, the intro is decoration over a page that announces itself.
       * A mark that names itself a second time is a screen reader saying the product's name twice.
       */
      aria-hidden="true"
      focusable="false"
    >
      {FACETS.map((facet) => (
        <path
          key={facet.id}
          className={`mark__facet mark__facet--${facet.tone}`}
          style={creaseOf(facet)}
          d={MARK[facet.id]}
        />
      ))}
    </svg>
  );
}

/** Which pocket opens first. North and south together, then east and west — as the toy is worked. */
const PHASE_OF: Record<Facet['pocket'], 0 | 1> = { north: 0, south: 0, east: 1, west: 1 };

/**
 * Where this facet is hinged, which way it swings, and when its turn comes.
 *
 * The hinge is a radius of the pinch, so the turn happens *at the centre* — `transform-origin` is
 * the same point for all eight, and what differs is the axis. That is the whole trick: eight
 * triangles turning about eight radii of one point is a fortune teller opening, and there is no
 * other arrangement of the same rotations that looks like anything at all.
 *
 * The vector is normalised because `rotate3d` takes a direction rather than a displacement, and an
 * unnormalised axis is a silently different rotation per facet — the corner radii are 46 units long
 * and the edge radii 32, so the mark would open unevenly for no visible reason.
 */
function creaseOf(facet: Facet): CSSProperties {
  const [cx, cy] = facet.points[0];
  const [hx, hy] = facet.points[1];
  const dx = hx - cx;
  const dy = hy - cy;
  const length = Math.hypot(dx, dy) || 1;

  return {
    // All eight turn about the pinch; only the axis through it differs.
    ['--crease-x' as string]: `${cx}px`,
    ['--crease-y' as string]: `${cy}px`,
    ['--axis-x' as string]: (dx / length).toFixed(4),
    ['--axis-y' as string]: (dy / length).toFixed(4),
    /** Mirror images about their shared point, so opposite senses open the pocket between them. */
    ['--swing' as string]: facet.swing,
    /** 0 opens first, 1 second. The pause between them is what makes it read as two choices. */
    ['--phase' as string]: PHASE_OF[facet.pocket],
  };
}
