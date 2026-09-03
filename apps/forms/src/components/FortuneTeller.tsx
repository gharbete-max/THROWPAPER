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
  /** `pinch` loops the fortune teller working. `fold` runs once and ends as the plane. */
  mode: 'pinch' | 'fold' | 'still';
  className?: string;
}) {
  return (
    <svg
      className={`ft ft--${mode}${className ? ` ${className}` : ''}`}
      viewBox="0 0 100 100"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      {/*
        Drawn back to front in the plane's own stacking order, so the last pose needs no
        rearranging: the vanishing quarter is behind everything, then the top wing, the keel, and
        the near wing on top. Getting this wrong is invisible for the whole animation and then
        wrong in the one frame that stays on screen.
      */}
      <path className="ft__flap ft__flap--ne" d="M50 50 L50 6 L94 50 Z" />
      <path className="ft__flap ft__flap--nw" d="M50 50 L6 50 L50 6 Z" />
      <path className="ft__flap ft__flap--se" d="M50 50 L94 50 L50 94 Z" />
      <path className="ft__flap ft__flap--sw" d="M50 50 L50 94 L6 50 Z" />
    </svg>
  );
}
