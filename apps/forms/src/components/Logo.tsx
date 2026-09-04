import { Mark } from './Mark.js';

/**
 * The mark: a P, folded from nine triangles.
 *
 * ## Why a letter and not a picture
 *
 * The previous mark was a paper plane, which was a nice object and a poor logo: at 16px in a
 * browser tab a dart is a grey smudge pointing somewhere, and it said nothing about the product
 * beyond "paper". A letterform survives being small because a reader is not identifying a shape,
 * they are recognising a letter they already know.
 *
 * ## Why the bowl is a triangle
 *
 * Because the house language is folding, every crease is straight, and a curve would be the one
 * thing in the product that is not a fold. The bowl is a triangle with a triangular counter cut
 * out of it — the ring between them divides into six even facets, one pair per side. A round bowl
 * needs a dozen facets before it stops looking faceted; a triangular one needs six and looks like
 * a decision.
 *
 * The counter is the part that matters at small sizes. Without a hole a P is a blob on a stick,
 * and it is sized so it survives being 24px in a launcher.
 *
 * Both colours come from the Brand Kit, so an organisation's palette drives it and rule 4 holds
 * structurally rather than by being remembered.
 */
export function Logo() {
  // `logo` carries the sizing; without it the SVG fills whatever it is put in.
  return <Mark mode="open" className="logo" />;
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
