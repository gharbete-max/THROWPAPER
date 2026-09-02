import { useReducedMotion, useReveal } from '../lib/motion.js';
import type { ReactNode } from 'react';

/**
 * The moment a form is done: a signature draws itself across a sheet, and a tick lands.
 *
 * This is the one animation in the product with a job beyond decoration. Submitting a form ends
 * with a screen that says "thank you" and a reference code, and the complaint about that screen is
 * always the same — people are not sure it worked. A line being *drawn* is a different kind of
 * confirmation from a line that was already there: it says something happened just now.
 *
 * The stroke is drawn with `stroke-dasharray`, so there is no image and nothing to load; under
 * reduced motion the same signature is simply already complete, which reads as a signed document
 * rather than as a missing effect.
 */
export function Signed() {
  const reduced = useReducedMotion();

  return (
    <svg
      className={reduced ? 'signed signed--still' : 'signed'}
      viewBox="0 0 120 80"
      fill="none"
      aria-hidden="true"
    >
      {/* The sheet, flat and square-cornered like everything else. */}
      <rect
        x="8"
        y="6"
        width="104"
        height="68"
        rx="2"
        fill="var(--tp-colour-background)"
        stroke="currentColor"
        strokeWidth="2.5"
      />
      {/* Two ruled lines standing in for whatever was filled in. */}
      <path
        d="M20 22 H88 M20 32 H72"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        opacity="0.35"
      />

      {/* The signature. One continuous stroke, so it draws as a single gesture. */}
      <path
        className="signed__stroke"
        d="M22 58 C30 44 34 44 38 54 C42 64 46 64 52 50 C56 40 62 42 64 52 C66 62 72 60 78 50 C82 44 88 44 92 52"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* The tick, landing after the signature finishes. */}
      <path
        className="signed__tick"
        d="M92 30 L99 37 L112 22"
        stroke="var(--tp-colour-success)"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Slides its children up into place the first time they are scrolled to.
 *
 * A wrapper rather than a class, because the content must never depend on the effect running:
 * `useReveal` starts revealed under reduced motion, without `IntersectionObserver`, and in any
 * environment where it cannot observe. The worst case is text that is simply there.
 */
export function Reveal({ children, className }: { children: ReactNode; className?: string }) {
  const { ref, revealed } = useReveal<HTMLDivElement>();
  return (
    <div
      ref={ref}
      className={[className, 'reveal', revealed && 'reveal--in'].filter(Boolean).join(' ')}
    >
      {children}
    </div>
  );
}
