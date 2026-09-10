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
 * ## Why the pockets are separated, and why that reversed an earlier decision
 *
 * This drawing was a solid diamond: the four flaps met along shared edges, so the silhouette was
 * one convex shape. The argument for it was legibility — *"a letterform survives being small
 * because the reader already knows it; a picture has to survive on outline alone"* — and a diamond
 * is a shape at 16px where a lumpy outline is a smudge.
 *
 * That argument was sound and it was solving the problem at the wrong end. A closed diamond is a
 * fortune teller that is **shut**, and a shut fortune teller is a folded napkin: the whole idea is
 * an object that opens onto a choice, and the drawing was showing the one state where it does not.
 * The four slits are the pockets parted, which is the thing being described.
 *
 * Legibility is then paid for where it is actually spent — by drawing the mark twice. `FACETS` is
 * the full mark for anything with room for it, and `REDUCED` is the same object with the fold
 * highlights dropped and the slits widened, for favicon sizes where a thin slit and a two-tone
 * flap both turn to mud. That is the trade the brand handoff makes and it is the right one: one
 * drawing cannot be both delicate at 512px and blunt at 16px.
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
 * The centre is load-bearing. Every facet owns it, so all eight meet at one point; that convergence
 * is what reads as "folded" rather than as a pinwheel sticker, and it is what
 * `mark-consistency.test.ts` protects.
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

/**
 * How far the four points of the toy reach.
 *
 * 46 of a 50 half-box, leaving an optical margin. This is the number every existing size decision
 * in the product was tuned against — the header lockup, the loading mark, the icon script's own
 * bounding-box fit — so the shape below changed and this deliberately did not.
 */
const TIP_RADIUS = 46;

/**
 * The shape, as the two numbers that decide it.
 *
 * `SEAM_RATIO` is how far out along a flap the mouth of the pocket sits, as a fraction of the tip
 * reach; `GAP` is half the slit between two neighbouring pockets, in degrees. Both are the brand
 * handoff's own values — its generator writes them as `0.455/0.52` and `6.5°` — and they are kept
 * as a ratio and an angle rather than baked into coordinates so that the drawing can be re-derived
 * at any scale without anybody re-deriving the trigonometry.
 */
const SEAM_RATIO = 0.455 / 0.52;
const GAP = 6.5;

/**
 * The reduced drawing, for favicon sizes.
 *
 * Wider slits and the mouth pushed further out, both for the same reason: below about 32px a 13°
 * slit closes up under antialiasing and the mark fills in solid, which loses the one thing that
 * says the pockets are open. Widening the slit keeps the gap visible when it is two pixels across.
 */
const REDUCED_SEAM_RATIO = 0.69 / 0.754;
const REDUCED_GAP = 10.5;

/** Polar to the drawing's own coordinates. Screen `y` grows downward, so the sine is subtracted. */
function at(degrees: number, radius: number): Point {
  const radians = (degrees * Math.PI) / 180;
  return [
    round(CENTRE[0] + Math.cos(radians) * radius),
    round(CENTRE[1] - Math.sin(radians) * radius),
  ];
}

/** Two decimals: enough for a 100-unit box, and it keeps the path strings readable. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}

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
   * Every hinge is a radius to the *mouth* of a pocket, never to a point of the toy. That is what
   * makes the two facets of a flap swing apart from each other and open it, which is the motion the
   * paper actually has.
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
   * The two facets of a flap are mirror images about its crease, so they take opposite senses of
   * rotation about their own edges. Without this they swing the same way and the pair slides
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
 * The four flaps, by the direction they point and the pair of tones they are creased in.
 *
 * Listed anticlockwise from the top, which is the order the brand handoff's own generator writes
 * them in — worth matching so the two drawings can be compared corner by corner.
 */
const FLAPS = [
  { pocket: 'north', tip: 90, tones: ['face', 'fold'] },
  { pocket: 'west', tip: 180, tones: ['warm', 'glow'] },
  { pocket: 'south', tip: 270, tones: ['face', 'fold'] },
  { pocket: 'east', tip: 0, tones: ['warm', 'glow'] },
] as const;

/** Half a quadrant, less the slit: where one pocket's mouth ends and the gap begins. */
const SEAM_OFFSET = 45 - GAP;
const REDUCED_SEAM_OFFSET = 45 - REDUCED_GAP;

export const FACETS: readonly Facet[] = FLAPS.flatMap(({ pocket, tip, tones }) => {
  const point = at(tip, TIP_RADIUS);
  const seam = (side: 1 | -1) => at(tip + side * SEAM_OFFSET, TIP_RADIUS * SEAM_RATIO);

  return [
    {
      id: `${pocket}-lead`,
      points: [CENTRE, seam(-1), point] as const,
      pocket,
      swing: 1,
      tone: tones[0],
    },
    {
      id: `${pocket}-trail`,
      points: [CENTRE, seam(1), point] as const,
      pocket,
      swing: -1,
      tone: tones[1],
    },
  ];
});

const path = (points: readonly Point[]) =>
  `M${points[0]![0]} ${points[0]![1]}${points
    .slice(1)
    .map(([x, y]) => ` L${x} ${y}`)
    .join('')} Z`;

/** The mark at rest, by facet id. */
export const MARK: Readonly<Record<string, string>> = Object.fromEntries(
  FACETS.map((facet) => [facet.id, path(facet.points)]),
);

export interface ReducedPocket {
  readonly id: string;
  /** `[centre, mouth, tip, mouth]` — the whole flap as one shape, uncreased. */
  readonly points: readonly [Point, Point, Point, Point];
  readonly tone: 'face' | 'warm';
}

/**
 * The same object with the creases dropped: four solid flaps rather than eight facets.
 *
 * The fold highlight is the first thing to go at small sizes. It is a value step of a few percent
 * across a shape a handful of pixels wide, so it survives as neither a crease nor a flat colour —
 * it reads as the mark being slightly out of focus. Dropping it deliberately is sharper than
 * letting the renderer average it away.
 */
export const REDUCED: readonly ReducedPocket[] = FLAPS.map(({ pocket, tip, tones }) => ({
  id: pocket,
  points: [
    CENTRE,
    at(tip - REDUCED_SEAM_OFFSET, TIP_RADIUS * REDUCED_SEAM_RATIO),
    at(tip, TIP_RADIUS),
    at(tip + REDUCED_SEAM_OFFSET, TIP_RADIUS * REDUCED_SEAM_RATIO),
  ] as const,
  tone: tones[0],
}));

/** The reduced mark, by pocket. */
export const REDUCED_MARK: Readonly<Record<string, string>> = Object.fromEntries(
  REDUCED.map((flap) => [flap.id, path(flap.points)]),
);
