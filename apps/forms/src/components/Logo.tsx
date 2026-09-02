/**
 * The mark: a paper plane, spinning.
 *
 * ## The drawing
 *
 * Four points and one crease. A dart seen from three-quarters above — nose, far wingtip, the
 * notch where the belly folds, and the near tail. That is the whole shape, and it is why this
 * works where the previous mark did not: a plane is a silhouette everyone already knows, so it
 * survives being shrunk to a browser tab without any of the detail a drawn hand needs.
 *
 * ## Two faces
 *
 * The two wings are drawn as separate fills either side of the crease, one solid and one lighter.
 * That is what makes the spin read as a fold turning in space rather than a flat shape wobbling:
 * as it turns, the wing that catches the light swaps.
 *
 * Both tones come from the Brand Kit — `currentColor` and the page's own background — so the mark
 * inverts correctly on a dark theme and picks up an organisation's palette for free, exactly as
 * `Icon.tsx` requires of everything else.
 */
export function Logo({
  className,
  title,
}: {
  className?: string;
  /** Give it a name where it stands alone. Omit where a wordmark sits beside it. */
  title?: string;
}) {
  return (
    <span className="logo__frame">
      <svg
        className={className ? `logo ${className}` : 'logo'}
        viewBox="0 0 64 64"
        fill="none"
        role={title ? 'img' : undefined}
        aria-label={title}
        aria-hidden={title ? undefined : 'true'}
        focusable="false"
      >
        {/* The far wing: nose, wingtip, and back to the fold. */}
        <path
          d="M60 6 L4 28 L29 37 Z"
          fill="currentColor"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinejoin="round"
        />
        {/* The near wing, lighter, so the fold between them is visible without a drawn line. */}
        <path
          d="M60 6 L29 37 L36 59 Z"
          fill="var(--tp-colour-background)"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinejoin="round"
        />
      </svg>
    </span>
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
