/**
 * The house mark, and the only place it is drawn in the interface.
 *
 * ## Why this is a picture and not the geometry
 *
 * It used to be the eight triangles from `mark-geometry.ts`, folded in three dimensions by CSS.
 * That was a good piece of work and it drew the wrong pose: the flat rosette is the animation's
 * *first frame*, not the mark. Seen from directly overhead a fortune teller is a flat rosette, and
 * the object it is a picture of — folded paper, held, mid-choice — disappears. The whole reason
 * the mark is this toy is the folding, and top-down is the one angle that hides it.
 *
 * So the resting mark is the three-quarter view, and it is a render rather than a drawing because
 * what makes it read as paper is the shading — a lit surface, a fold catching more light than the
 * one beside it, a shadow underneath. None of that is expressible as flat fills, which is exactly
 * why the flat version had to state the fold with a value step instead of showing it.
 *
 * ## What the geometry is still for
 *
 * `mark-geometry.ts` has not moved and is not dead. It is the *small* mark: the favicon and the
 * launcher icons, where a shaded three-quarter render at 16px is mud and a flat drawing with four
 * blunt flaps is legible. Two drawings for two jobs, which is the trade that file already makes
 * between its full and reduced forms.
 *
 * ## Why the colours are fixed, which they were not before
 *
 * The facets used to fill from `--tp-colour-primary`, so the mark wore whatever palette it was
 * rendered in. That was written for a published form — where the organisation's brand should
 * win — but nothing puts the mark on a form: `PublicForm` shows the organisation's own logo, or
 * their name, and never this. Under client mode the whole corner becomes the customer's logo
 * rather than a recoloured version of ours.
 *
 * So this is Paloppa's mark in Paloppa's colours, and white-label replaces it instead of tinting
 * it. A brand that can be repainted by whoever installs it is not a brand.
 */
export function Mark({
  motion = false,
  className,
}: {
  /**
   * Whether the paper is working.
   *
   * Off is the resting three-quarter still, which is what a logo in a top bar should be — a mark
   * that moves while somebody is trying to read the page beside it is a distraction wearing a
   * brand. On is the loop, for the two places where motion is the message: something is loading,
   * or the app is arriving.
   */
  motion?: boolean;
  className?: string;
}) {
  const source = motion ? '/mark-loop-256.webp' : '/mark-angled-256.png';

  return (
    <img
      className={`mark${className ? ` ${className}` : ''}`}
      src={source}
      /*
       * The intrinsic size, so the box is reserved before the bytes arrive.
       *
       * Both files are 256 square. Every use is smaller than that and downscales, which is the
       * direction that stays sharp; the header box is about 50px, so it has three times the pixels
       * it needs even on a retina screen.
       */
      width={256}
      height={256}
      /*
       * Hidden from the accessibility tree at every call site.
       *
       * Each one already carries its own wording: the wordmark says "Paloppa" beside it, the
       * loading indicator has its label, the intro is decoration over a page that announces itself.
       * A mark that names itself a second time is a screen reader saying the product's name twice.
       */
      alt=""
      aria-hidden="true"
      decoding="async"
    />
  );
}
