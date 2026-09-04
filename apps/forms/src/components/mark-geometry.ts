/**
 * The mark: a P built from nine triangles.
 *
 * ## Why triangles
 *
 * The house language is folded paper, and a fold is a straight crease — so every shape that moves
 * in this product is a triangle, and the mark is the statement of that. Nine is what the letter
 * costs: seven for the bowl and two for the stem.
 *
 * ## Why the bowl is not itself a triangle
 *
 * It was, in the first draft, and it read as a pennant on a pole rather than a letter. A P's bowl
 * is a mass, and a mass that comes to a sharp point is a flag. So the *silhouette* is a blunt quad
 * — flat across the top, chamfered to a shoulder on the right — and the triangles are the facets
 * inside it. Built from triangles, not shaped like one.
 *
 * The counter is the part that has to survive being small. Without a hole a P is a blob on a
 * stick, and this one is sized so it still reads at 24px in a launcher, which is the smallest
 * place the mark is ever drawn.
 *
 * The stem takes two facets, not three. Three creases fanning from a corner looked like a notch
 * bitten out of the letter at anything under 100px; one diagonal reads as a folded strip.
 *
 * ## One source, two consumers
 *
 * `Mark.tsx` renders these and `scripts/generate-icons.ts` bakes them into the favicon and the
 * launcher icons. The script runs in node and cannot import a component, so the numbers live here
 * for both to read. `mark-consistency.test.ts` is what notices if they ever stop agreeing.
 */

export type Point = readonly [number, number];

/** The bowl's outer boundary: flat on top, shouldered on the right, slanted underneath. */
const A: Point = [46, 8];
const B: Point = [78, 8];
const C: Point = [90, 32];
const D: Point = [46, 58];

/** The counter — the hole that makes it a letter rather than a shape. */
const I1: Point = [56, 20];
const I2: Point = [75, 31];
const I3: Point = [56, 45];

/** The stem. */
const S1: Point = [22, 8];
const S2: Point = [46, 8];
const S3: Point = [46, 92];
const S4: Point = [22, 92];

export interface Facet {
  /** Stable name, used for the per-facet class and by the icon script. */
  readonly id: string;
  readonly points: readonly [Point, Point, Point];
  /**
   * Which surface this facet catches the light as.
   *
   * Two hue families, two values each: the brand colour folded toward the light and away, and the
   * accent the same. Mixing the two families against each other was the first attempt and it went
   * grey — paper does not turn grey when you fold it, it turns into a lighter or darker version of
   * the paper.
   */
  readonly tone: 'face' | 'fold' | 'warm' | 'glow';
}

/** Seven for the bowl, two for the stem, back to front. */
export const FACETS: readonly Facet[] = [
  { id: 'bowl-top', points: [A, B, I1], tone: 'fold' },
  { id: 'bowl-top-in', points: [B, I2, I1], tone: 'face' },
  { id: 'bowl-shoulder', points: [B, C, I2], tone: 'warm' },
  { id: 'bowl-under', points: [C, D, I3], tone: 'face' },
  { id: 'bowl-under-in', points: [C, I3, I2], tone: 'glow' },
  { id: 'bowl-spine-low', points: [D, A, I3], tone: 'glow' },
  { id: 'bowl-spine-top', points: [A, I1, I3], tone: 'warm' },
  { id: 'stem-face', points: [S1, S2, S3], tone: 'face' },
  { id: 'stem-fold', points: [S1, S3, S4], tone: 'fold' },
];

const path = (points: readonly [Point, Point, Point]) =>
  `M${points[0][0]} ${points[0][1]} L${points[1][0]} ${points[1][1]} L${points[2][0]} ${points[2][1]} Z`;

/** The mark at rest, by facet id. */
export const MARK: Readonly<Record<string, string>> = Object.fromEntries(
  FACETS.map((facet) => [facet.id, path(facet.points)]),
);
