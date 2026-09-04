import type { CSSProperties } from 'react';
import { FACETS, MARK, type Facet } from './mark-geometry.js';

/**
 * The house mark, and the only drawing of it.
 *
 * `rest` is the letter, still, which is what a logo in a top bar should be. `open` folds while
 * somebody points at it. `intro` runs the same fold once, slower, as the app arrives.
 *
 * ## The fold is a transform, not a second drawing
 *
 * The obvious way to animate folded paper is to write a folded pose and interpolate `d` between
 * the two. That was the previous mark's trick and it worked, but it meant the geometry existed
 * twice more — once in a CSS keyframe, which imports nothing and so had to be kept in step by a
 * test.
 *
 * Rotating each facet about its own crease costs no second copy. The crease is an edge the facet
 * already has, so the origin comes out of the same numbers the shape does, and the browser folds
 * the triangle in three dimensions rather than sliding its corners around in two — which is what
 * paper actually does.
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
      {FACETS.map((facet, index) => (
        <path
          key={facet.id}
          className={`mark__facet mark__facet--${facet.tone}`}
          style={creaseOf(facet, index)}
          d={MARK[facet.id]}
        />
      ))}
    </svg>
  );
}

/**
 * Where this facet is hinged, and when its turn comes.
 *
 * The crease is the edge a facet shares with the one before it, so its midpoint is the axis the
 * fold turns about. `--i` staggers the nine so the mark folds across itself like a sheet rather
 * than collapsing all at once.
 */
function creaseOf(facet: Facet, index: number): CSSProperties {
  const [ax, ay] = facet.points[0];
  const [bx, by] = facet.points[2];
  return {
    ['--crease-x' as string]: `${(ax + bx) / 2}px`,
    ['--crease-y' as string]: `${(ay + by) / 2}px`,
    ['--i' as string]: index,
  };
}
