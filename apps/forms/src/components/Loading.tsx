import { useReducedMotion } from '../lib/motion.js';
import { useT } from '../lib/i18n.js';

/**
 * Waiting: a hand bouncing a paper ball, the way you do while thinking.
 *
 * Replaces a line of text that said "Laddar…" and nothing else. A spinner says "something is
 * happening"; this says the same thing in the product's own vocabulary, which is the whole point
 * of having one.
 *
 * ## What it does when motion is unwelcome
 *
 * It stops bouncing and becomes a still hand holding the ball, with the word beside it. Not a
 * different component and not nothing — the same picture, standing still. Somebody who turns
 * motion off should get a quieter product, not a plainer one.
 *
 * The word is always there, and it is what a screen reader announces: an animated hand is not an
 * accessible way to say "loading", and `aria-live` on the text is.
 */
export function Loading({ label }: { label?: string }) {
  const t = useT();
  const reduced = useReducedMotion();
  const text = label ?? t('app.loading');

  return (
    <p className={reduced ? 'loading loading--still' : 'loading'} role="status">
      <svg className="loading__scene" viewBox="0 0 48 40" fill="none" aria-hidden="true">
        {/* The ball, bouncing between the top of the frame and the palm. */}
        <g className="loading__ball">
          <path
            d="M8 3 L13 5 L15 9 L13 14 L8 16 L3 14 L1 9 L3 5 Z"
            fill="var(--tp-colour-background)"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <path d="M8 3 L9 9 L15 9 M9 9 L3 14" stroke="currentColor" strokeWidth="1.5" />
        </g>

        {/* The hand: the same grip as the mark, cut down to what reads at this size. */}
        <g className="loading__hand">
          <path
            d="M10 28 Q10 24 15 24 L33 24 Q38 24 38 28 L38 33 Q38 38 32 38 L16 38 Q10 38 10 33 Z"
            fill="currentColor"
          />
          <path
            d="M10 30 Q4 31 5 35 Q6 38 11 37"
            stroke="currentColor"
            strokeWidth="4"
            strokeLinecap="round"
          />
        </g>
      </svg>
      <span className="muted">{text}</span>
    </p>
  );
}
