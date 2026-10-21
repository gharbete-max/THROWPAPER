import { useReducedMotion } from '../lib/motion.js';
import { useT } from '../lib/i18n.js';

/**
 * Waiting: a paper fortune teller, worked between two fingers.
 *
 * Replaces a line of text that said "Laddar…" and nothing else. A spinner says "something is
 * happening"; this says the same thing in the product's own vocabulary, which is the whole point
 * of having one.
 *
 * It is the same four quarters that fold into the mark in `Intro`, working rather than folding —
 * so the thing you watch while waiting and the thing that becomes the logo are one object. See
 * `mark-geometry.ts`.
 *
 * ## What it does when motion is unwelcome
 *
 * It stops working and becomes a still fortune teller, closed, with its creases showing and the
 * word beside it. Not a different component and not nothing — the same picture, standing still. Somebody who turns
 * motion off should get a quieter product, not a plainer one.
 *
 * The word is always there, and it is what a screen reader announces: a folding square is not an
 * accessible way to say "loading", and `aria-live` on the text is.
 */
export function Loading({ label }: { label?: string }) {
  const t = useT();
  const reduced = useReducedMotion();
  const text = label ?? t('app.loading');

  return (
    <p className={reduced ? 'loading loading--still' : 'loading'} role="status">
      {/* Still under reduced motion: a spinner that does not spin is better than nausea. */}
      {/*
        The brand bundle's vector spinner (1.4 KB, `docs/brand/css/loppa-spinner.svg`), not the
        animated mark: that loop is 1.1 MB, was fetched by every web page that ever waited, and is
        drawn at 40 pixels here. The file stops its own animation under reduced motion.
      */}
      <img
        className="mark loading__mark"
        src="/loppa-spinner.svg"
        width={256}
        height={256}
        alt=""
        aria-hidden="true"
        decoding="async"
      />
      <span className="muted">{text}</span>
    </p>
  );
}
