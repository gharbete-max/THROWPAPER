/**
 * The mark: a hand holding a crumpled sheet of paper.
 *
 * ## The drawing
 *
 * Agitprop, not illustration. Flat fills, hard angles, no shading, no gradients — a shape that
 * still reads as a fist holding paper at 20 pixels in a browser tab, which is where a logo
 * actually has to work. Everything decorative was removed until only that was left: a blocky
 * grip, three knuckle notches, a thumb, and an irregular ball with three creases.
 *
 * ## Two tones, both from the Brand Kit
 *
 * The hand is `currentColor` and the paper is the page's own background, so the mark inverts
 * correctly on a dark theme and picks up an organisation's palette for free — the same reason
 * `Icon.tsx` gives for never letting an icon carry a colour of its own. `CLAUDE.md` rule 4 is
 * satisfied structurally rather than by remembering.
 *
 * The paper is the *hole* in the shape rather than a lighter fill, which is what keeps it legible
 * against a parchment background as well as a white one.
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
    <svg
      className={className ? `logo ${className}` : 'logo'}
      viewBox="0 0 64 64"
      fill="none"
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : 'true'}
      focusable="false"
    >
      {/**
       * Order matters here, and it is the whole trick.
       *
       * The sheet is drawn *first* and the fingers *over* it, so the hand closes in front of the
       * paper. Drawn the other way round — a ball sitting above a fist — it reads as a balloon on
       * a mitten, which is exactly what the first attempt looked like.
       */}
      <path
        d="M32 4 L43 8 L48 20 L44 32 L33 37 L21 33 L16 21 L21 8 Z"
        fill="var(--tp-colour-background)"
        stroke="currentColor"
        strokeWidth={3}
        strokeLinejoin="round"
      />
      {/* Three creases. Enough to say "crumpled"; a fourth is noise at 20 pixels. */}
      <path
        d="M32 4 L34 21 L48 20 M34 21 L21 33 M34 21 L44 32"
        stroke="currentColor"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* The palm: one solid mass, because a fist drawn as separate fingers dissolves when small. */}
      <path
        d="M14 44 Q14 38 21 38 L43 38 Q50 38 50 44 L50 52 Q50 60 41 60 L23 60 Q14 60 14 52 Z"
        fill="currentColor"
      />
      {/* Three fingers closing over the front of the sheet. This is what makes it *held*. */}
      <path
        d="M23 43 L23 34 M32 43 L32 33 M41 43 L41 34"
        stroke="currentColor"
        strokeWidth={7}
        strokeLinecap="round"
      />
      {/* Hairline gaps between them, in the page colour, so three fingers read as three. */}
      <path
        d="M27.5 43 L27.5 35 M36.5 43 L36.5 35"
        stroke="var(--tp-colour-background)"
        strokeWidth={1.5}
        strokeLinecap="round"
      />
      {/* The thumb, crossing the grip — the one detail that stops it reading as a brick. */}
      <path
        d="M14 47 Q8 49 10 55 Q12 59 18 57"
        stroke="currentColor"
        strokeWidth={6}
        strokeLinecap="round"
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
