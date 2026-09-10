/**
 * The mark: a paper fortune teller, seen from above, built from eight triangles.
 *
 * ## Why a fortune teller
 *
 * It is the object the product already is. You ask a fortune teller a question by choosing, then
 * choosing again, and it opens onto an answer — which is the wizard, drawn. The previous mark was a
 * folded `P`: a good letterform and an honest one, but it said "paper" and stopped there, and the
 * one thing worth saying without words is what the paper *does*.
 *
 * The trade being made deliberately: a letter survives being small because the reader is
 * recognising something they already know, and a picture has to earn it. This picture earns it on
 * silhouette — the outline is a plain diamond, which is a shape at 16px, not a smudge — and the
 * eight facets inside it are what appear as the square grows. A paper dart failed exactly this
 * test once already, so it is worth naming why this one is different: a dart's silhouette is a
 * thin acute wedge with no mass, and a diamond has mass.
 *
 * ## Why eight triangles
 *
 * That is the real toy. A fortune teller is one square folded twice into quarters and then its four
 * corners folded to the middle, so from above it is four flaps meeting at a centre point, each flap
 * creased down its own middle: four flaps, two triangles each. Every crease in the drawing is a
 * crease you would actually make in the paper, which is what makes the opening animation possible
 * without inventing any geometry for it — `Mark.tsx` hinges each facet on the radial crease it
 * already has.
 *
 * The centre is load-bearing in a way the `P`'s counter was. Every facet owns it, so all eight
 * meet at one point; that convergence is what reads as "folded" rather than as a pinwheel sticker,
 * and it is what `mark-consistency.test.ts` protects.
 *
 * ## One source, three consumers
 *
 * `Mark.tsx` renders these, `scripts/generate-icons.ts` bakes them into the favicon and the
 * launcher icons, and the opening animation in `styles.css` turns about the axes derived here. The
 * script runs in node and cannot import a component, so the numbers live here for all of them to
 * read. `mark-consistency.test.ts` is what notices if they ever stop agreeing.
 */

export type Point = readonly [number, number];

/**
 * The centre: the pinch, where all four flaps meet and where every fold turns.
 *
 * Written once and shared by all eight facets rather than repeated per triangle, because "they all
 * meet at the same point" is the property the mark is built on and a typo in one copy of it would
 * be a hairline crack nobody sees until the mark is on a billboard.
 */
export const CENTRE: Point = [50, 50];

/** The four points of the toy — the corners you put your fingers behind. */
const N: Point = [50, 4];
const E: Point = [96, 50];
const S: Point = [50, 96];
const W: Point = [4, 50];

/**
 * The middle of each outer edge, where one flap ends and the next begins.
 *
 * These sit exactly on the lines `N–E`, `E–S`, `S–W` and `W–N`, so the silhouette stays a clean
 * diamond however the facets are shaded. That is deliberate and is the reason the mark survives
 * being small: the outline is one convex shape with four corners, and the detail lives inside it.
 */
const NE: Point = [73, 27];
const SE: Point = [73, 73];
const SW: Point = [27, 73];
const NW: Point = [27, 27];

export interface Facet {
  /** Stable name, used for the per-facet class and by the icon script. */
  readonly id: string;
  /**
   * `[centre, hinge, tip]`, and the order is a contract rather than a convention.
   *
   * `Mark.tsx` reads `points[0]` as the pinch, `points[1]` as the far end of the crease this facet
   * turns about, and `points[2]` as the point of the toy it swings toward. Getting the second and
   * third the wrong way round does not break the drawing — the triangle is the same three corners
   * either way — it makes the mark open about the wrong edge, which is the kind of bug that looks
   * like a taste problem.
   *
   * Every hinge is a radius to an *edge* midpoint, never to a point of the diamond. That is what
   * makes the two facets meeting at a point swing apart from each other and open a pocket there,
   * which is the motion the toy actually has.
   */
  readonly points: readonly [Point, Point, Point];
  /**
   * Which of the four points this facet swings toward, and so which pocket it belongs to.
   *
   * A fortune teller does not open all four pockets at once — it opens north/south, closes, then
   * opens east/west. `Mark.tsx` turns this into the phase of the animation, so the mark works the
   * way the paper does instead of blooming like a flower.
   */
  readonly pocket: 'north' | 'east' | 'south' | 'west';
  /**
   * Which side of its pocket the facet is on.
   *
   * The two facets meeting at a point are mirror images about it, so they take opposite senses of
   * rotation about their own creases. Without this they swing the same way and the pair slides
   * instead of opening.
   */
  readonly swing: 1 | -1;
  /**
   * Which surface this facet catches the light as.
   *
   * Two hue families, two values each: the brand colour folded toward the light and away, and the
   * accent the same. Mixing the two families against each other was the first attempt and it went
   * grey — paper does not turn grey when you fold it, it turns into a lighter or darker version of
   * the paper.
   *
   * **The two facets of one pocket share a family and differ in value.** This is the difference
   * between a fortune teller and a pinwheel, and it was got wrong first: cycling all four tones
   * around the ring gave eight equal blades turning about a hub, which is a windmill. Grouping by
   * pocket gives four flaps, each creased down its own middle by the value change — which is what
   * the object is. The eye counts flaps, not triangles.
   *
   * It also colour-codes the animation for free. North and south are the brand colour and open
   * first; east and west are the accent and open second. Nobody has to be told that the two pairs
   * are two separate choices, because they are two separate colours.
   */
  readonly tone: 'face' | 'fold' | 'warm' | 'glow';
}

/**
 * Eight facets, listed clockwise around the mark from the top point.
 *
 * Consecutive entries share the centre *and* the radius between them, which is an edge — so their
 * tones must differ, and the test holds that. Facets opposite each other share only the centre,
 * which is a point and not an edge, so the four tones cycle twice around the ring without any
 * crease going undrawn.
 */
export const FACETS: readonly Facet[] = [
  { id: 'north-east', points: [CENTRE, NE, N], pocket: 'north', swing: 1, tone: 'face' },
  { id: 'east-north', points: [CENTRE, NE, E], pocket: 'east', swing: -1, tone: 'warm' },
  { id: 'east-south', points: [CENTRE, SE, E], pocket: 'east', swing: 1, tone: 'glow' },
  { id: 'south-east', points: [CENTRE, SE, S], pocket: 'south', swing: -1, tone: 'fold' },
  { id: 'south-west', points: [CENTRE, SW, S], pocket: 'south', swing: 1, tone: 'face' },
  { id: 'west-south', points: [CENTRE, SW, W], pocket: 'west', swing: -1, tone: 'warm' },
  { id: 'west-north', points: [CENTRE, NW, W], pocket: 'west', swing: 1, tone: 'glow' },
  { id: 'north-west', points: [CENTRE, NW, N], pocket: 'north', swing: -1, tone: 'fold' },
];

const path = (points: readonly [Point, Point, Point]) =>
  `M${points[0][0]} ${points[0][1]} L${points[1][0]} ${points[1][1]} L${points[2][0]} ${points[2][1]} Z`;

/** The mark at rest, by facet id. */
export const MARK: Readonly<Record<string, string>> = Object.fromEntries(
  FACETS.map((facet) => [facet.id, path(facet.points)]),
);
