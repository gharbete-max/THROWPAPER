import { FortuneTeller } from './FortuneTeller.js';

/**
 * The mark: a paper plane, folded from a fortune teller.
 *
 * ## Three faces, not two
 *
 * A dart seen from three-quarters above: the top wing sweeping back from the nose, the near wing
 * folded under it, and a sliver of the keel showing beneath them both.
 *
 * The third face is what the two-triangle version was missing. Two flat shapes meeting at a line
 * read as a chevron; the moment a little of the underside shows past the near wing, the eye reads
 * a folded sheet with a near side and a far side. It costs one more polygon and is the whole
 * difference between a shape and an object.
 *
 * Drawn in that order — top, keel, near wing — so the near wing covers all of the keel except the
 * sliver. The overlap does the work; there is no clipping and no mask.
 *
 * ## Two colours, not a colour and a hole
 *
 * The wings are `primary` and `accent`. The first version used the page's own background for the
 * near wing, which made the fold a *hole* in the shape — fine on white, and dead against anything
 * else. Two real colours give the fold a side that catches the light, which is the whole reason
 * the spin reads as paper turning rather than a triangle rotating.
 *
 * Both come from the Brand Kit, so an organisation's palette still drives it and `CLAUDE.md`
 * rule 4 is satisfied structurally rather than by remembering.
 */
export function Logo({
  className,
  title,
}: {
  className?: string;
  /** Give it a name where it stands alone. Omit where a wordmark sits beside it. */
  title?: string;
}) {
  /**
   * The mark is the fortune teller at rest.
   *
   * It used to be three static paths that span perpetually — `plane-spin`, eight seconds, infinite,
   * on every screen. A logo that never stops moving is a logo you learn to stop looking at, and it
   * was the only thing on a quiet page that would not hold still.
   *
   * Now it sits still and unfolds when somebody points at it: the paper comes apart into the
   * fortune teller, gets pinched once, and folds back. Same four quarters as the intro and the
   * loading indicator, so all three are one object, and the resting frame is the mark itself.
   */
  return (
    <FortuneTeller
      mode="mark"
      // `logo` carries the sizing; without it the SVG inherits `.ft`'s 100% and fills its parent.
      className={className ? `logo ${className}` : 'logo'}
      title={title}
    />
  );
}

/** The mark beside the product's name, for the sign-in screen and the top bar. */
export function Wordmark({ name }: { name: string }) {
  return (
    <span className="wordmark">
      <Logo />
      <strong>{name}</strong>
    </span>
  );
}
