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
        {/* The far wing, in the darker of the two. */}
        <path d="M60 6 L4 28 L29 37 Z" fill="var(--tp-colour-primary)" />
        {/* The near wing, in the accent — the side the light is on. */}
        <path d="M60 6 L29 37 L36 59 Z" fill="var(--tp-colour-accent)" />
      </svg>
    </span>
  );
}

/**
 * The dashed path a thrown plane leaves behind it.
 *
 * Decorative, and drawn in `border` rather than a brand colour on purpose: it has to sit quietly
 * behind whatever it decorates on a light page *and* on a dark one, which is the one job a neutral
 * token exists for. Never announced — it carries nothing a reader needs.
 *
 * The dashes march slowly along the path rather than the line drawing itself. A line that draws
 * once is an entrance, and an entrance repeated on every screen becomes a tic; dashes that drift
 * read as flight and can sit there indefinitely without demanding attention.
 *
 * `variant` picks the curve. Two lengths rather than one squashed to fit, because a wide header
 * and a narrow card want different geometry, not the same geometry at a different aspect ratio.
 */
export function FlightTrail({
  variant = 'long',
  className,
}: {
  variant?: 'long' | 'short';
  className?: string;
}) {
  const long = variant === 'long';
  return (
    <svg
      className={['trail', className].filter(Boolean).join(' ')}
      viewBox={long ? '0 0 360 110' : '0 0 214 66'}
      fill="none"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        className="trail__path"
        d={
          long
            ? 'M2 74 C40 96 72 22 128 30 C186 38 196 92 250 78 C300 66 320 40 358 34'
            : 'M4 46 C40 60 62 12 110 22 C152 30 168 52 210 40'
        }
        stroke="var(--tp-colour-border)"
        strokeWidth={3}
        strokeLinecap="round"
        strokeDasharray="9 11"
      />
    </svg>
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
