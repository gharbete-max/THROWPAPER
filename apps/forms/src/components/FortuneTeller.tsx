/**
 * A paper fortune teller, worked between two fingers, that folds into the plane.
 *
 * ## Four triangles, all the way through
 *
 * Every pose in this animation — the closed fortune teller, both pinches, the half-unfolded
 * middle, and the finished plane — is the same four triangles with the same three points each.
 * That is the whole trick. Because the path commands never change shape (`M … L … L … Z`), the
 * browser interpolates `d` between poses and the paper appears to fold, with no library, no
 * sprite sheet and no video.
 *
 * The alternative was a crossfade between two drawings, which is what most "morphs" are, and it
 * would have read as one picture replacing another rather than one sheet of paper moving.
 *
 * ## Why the pinch looks like a pinch
 *
 * A fortune teller opened one way is two beaks side by side; opened the other way it is the
 * perpendicular pair. Seen from above, that is precisely the four outer points moving: squeeze
 * east and west toward the centre and the diamond becomes a tall lens, squeeze north and south
 * and it becomes a wide one. Alternating between those two is the motion everybody's hands
 * remember, and it costs four coordinates.
 *
 * ## Edges
 *
 * Each flap is stroked in the border colour, so the creases are drawn where the flaps meet — the
 * folded-paper detail — without a second set of shapes to keep in step. The stroke fades to
 * nothing as the plane arrives, which is what leaves the finished mark flat and identical to
 * `Logo`.
 *
 * ## The four flaps become three faces
 *
 * The plane has three faces and the fortune teller has four quarters, so one has to go: the
 * north-east quarter collapses to the nose point and disappears under the wing, which is what the
 * last fold of a paper dart actually does. The colours are chosen so that no flap ever changes
 * colour — each quarter already wears the colour of the face it becomes, which is why the
 * fortune teller reads as alternating light and dark quarters in the first place.
 */
export function FortuneTeller({
  mode,
  className,
}: {
  /**
   * `pinch` loops the fortune teller working. `fold` runs once and ends as the plane. `mark` rests
   * *as* the plane and unfolds only while somebody points at it.
   */
  mode: 'pinch' | 'fold' | 'still' | 'mark';
  className?: string;
}) {
  /**
   * At rest the mark is the plane, so that is what sits in the markup.
   *
   * The `d` attribute is the resting pose in every mode — the animation overrides it while it
   * runs, and this is what shows when it is not running, or where a browser will not interpolate
   * `d` at all. For the top bar that resting frame is the logo, so it has to be exact.
   */
  const resting = mode === 'mark' ? MARK : CLOSED;
  return (
    <svg
      className={`ft ft--${mode}${className ? ` ${className}` : ''}`}
      viewBox="0 0 100 100"
      fill="none"
      /*
       * Always hidden from the accessibility tree.
       *
       * There was a `title` prop here that switched this to `role="img"` with a name, and nothing
       * ever passed one — every call site is a mark beside its own wording: the wordmark says
       * "Formwork", the loading indicator has its word next to it, the intro is decoration. An
       * unused prop implying an option nobody takes is worse than no prop.
       */
      aria-hidden="true"
      focusable="false"
    >
      {/*
        Drawn back to front in the plane's own stacking order, so the last pose needs no
        rearranging: the vanishing quarter is behind everything, then the top wing, the keel, and
        the near wing on top. Getting this wrong is invisible for the whole animation and then
        wrong in the one frame that stays on screen.
      */}
      <path className="ft__flap ft__flap--ne" d={resting.ne} />
      <path className="ft__flap ft__flap--nw" d={resting.nw} />
      <path className="ft__flap ft__flap--se" d={resting.se} />
      <path className="ft__flap ft__flap--sw" d={resting.sw} />
    </svg>
  );
}

/**
 * The two resting poses, as data rather than as four string literals in the markup.
 *
 * `MARK` is the mark itself — the three faces of the plane, plus the quarter the plane has no face
 * for collapsed onto the nose. It is the single source of truth for the logo's geometry:
 * `Logo` renders it, `scripts/generate-icons.ts` bakes the same numbers into the favicon, and the
 * fold's last keyframe lands on it. `logo-consistency.test.ts` holds all three together.
 */
const CLOSED = {
  ne: 'M50 50 L50 6 L94 50 Z',
  nw: 'M50 50 L6 50 L50 6 Z',
  se: 'M50 50 L94 50 L50 94 Z',
  sw: 'M50 50 L50 94 L6 50 Z',
} as const;

const MARK = {
  ne: 'M96 56 L96 56 L96 56 Z',
  nw: 'M20 62.5 L6 30 L96 56 Z',
  se: 'M46 79 L96 56 L26 73 Z',
  sw: 'M20 62.5 L18 82 L96 56 Z',
} as const;

/** The plane sits `MARK_OFFSET` lower than `Logo`'s own 100x64 drawing, to centre it in a square. */
export const MARK_OFFSET = 24;
export const MARK_FACES = MARK;
