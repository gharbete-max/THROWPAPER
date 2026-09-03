/**
 * A flag for a locale, drawn rather than typed.
 *
 * ## Why not the emoji
 *
 * The obvious implementation is the regional-indicator emoji — 🇸🇪 for `sv-SE` — in four lines.
 * It does not work: **Windows ships no flag glyphs at all**, so every one of them renders as two
 * boxed letters ("SE"), and this product is being built on Windows. Even where they do render,
 * the size and baseline are the font's business rather than ours, which makes a row of them
 * ragged next to text.
 *
 * These are 4:3 SVGs, one path or rect per band, sized by the caller. They line up, they scale,
 * and they look the same everywhere.
 *
 * ## Why a flag is not really a language
 *
 * A flag is a country and a language is not — Spanish is not only Spain, French is not only
 * France, and English under a Union Jack is a choice somebody will disagree with. That is why the
 * flag never appears **alone** in the site picker: it sits beside the endonym, as a way to find
 * your language at a glance in a list of twelve rather than as the name of it.
 *
 * On a public form, where space is tight and the reader is choosing between two or three, the
 * flag carries a `title` and an accessible name so it is never only a picture.
 */
export function Flag({ locale, className }: { locale: string; className?: string }) {
  /**
   * Keyed by the full locale, and only that.
   *
   * There was a second lookup here on the region — `locale.split('-')[1]`, so `SE` — as a fallback.
   * Every key in the table is a full locale, so it matched nothing and never could: a fallback that
   * had never once fired. `flag.test.ts` holds the table against the locale registry instead, which
   * is a guarantee rather than a guess.
   */
  const draw = FLAGS[locale] ?? null;

  return (
    <svg
      className={['flag', className].filter(Boolean).join(' ')}
      viewBox="0 0 24 18"
      aria-hidden="true"
      focusable="false"
      // A hairline keeps a white or very pale flag from disappearing into a pale background.
      style={{ borderRadius: 2 }}
    >
      {draw ?? <rect width="24" height="18" fill="var(--tp-colour-border)" />}
      <rect
        width="24"
        height="18"
        fill="none"
        stroke="rgb(0 0 0 / 0.18)"
        strokeWidth="1"
        rx="2"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/**
 * The twelve, by locale.
 *
 * Nordic crosses share a geometry and differ only in colour, so they are generated; the rest are
 * written out. Every one is the plain civil flag at 4:3 — no crests, no shading.
 */
function nordicCross(field: string, cross: string, inner?: string) {
  return (
    <>
      <rect width="24" height="18" fill={field} />
      <rect x="7" width="4" height="18" fill={cross} />
      <rect y="7" width="24" height="4" fill={cross} />
      {inner && (
        <>
          <rect x="8" width="2" height="18" fill={inner} />
          <rect y="8" width="24" height="2" fill={inner} />
        </>
      )}
    </>
  );
}

/**
 * A five-pointed star, optionally turned so that one point aims at something.
 *
 * The four small stars on the Chinese flag are each rotated to point at the large one — it is the
 * detail that distinguishes that flag from any other red flag with stars on it, and it is
 * specified rather than decorative. They were circles here, which is the one shortcut that makes
 * the drawing wrong rather than simplified.
 *
 * The inner radius is the golden section of the outer, which is what makes a pentagram regular
 * rather than a spiky asterisk.
 */
function star(cx: number, cy: number, radius: number, aimAt?: readonly [number, number]): string {
  const inner = radius * 0.381966;
  // The unrotated star points straight up, so the turn is measured from there.
  const turn = aimAt ? (Math.atan2(aimAt[1] - cy, aimAt[0] - cx) * 180) / Math.PI + 90 : 0;
  const round = (value: number) => Math.round(value * 100) / 100;
  const at = (index: number) => {
    const r = index % 2 === 0 ? radius : inner;
    const angle = ((-90 + turn + index * 36) * Math.PI) / 180;
    return `${round(cx + r * Math.cos(angle))} ${round(cy + r * Math.sin(angle))}`;
  };
  return `M${[...Array(10).keys()].map(at).join(' L')} Z`;
}

/** The large star's centre, which the other four point at. */
const CHINA_BIG = [4, 4.5] as const;

const FLAGS: Record<string, React.ReactNode> = {
  'en-GB': (
    <>
      <rect width="24" height="18" fill="#012169" />
      {/* The saltire, then the cross. Drawn with clipping-free strokes: at this size the exact
          proportions of the real flag are not resolvable anyway, and a recognisable one is the
          goal. */}
      <path d="M0 0 L24 18 M24 0 L0 18" stroke="#fff" strokeWidth="3.6" />
      <path d="M0 0 L24 18 M24 0 L0 18" stroke="#C8102E" strokeWidth="1.8" />
      <path d="M12 0 V18 M0 9 H24" stroke="#fff" strokeWidth="6" />
      <path d="M12 0 V18 M0 9 H24" stroke="#C8102E" strokeWidth="3.6" />
    </>
  ),
  'sv-SE': nordicCross('#006AA7', '#FECC00'),
  'da-DK': nordicCross('#C8102E', '#fff'),
  'nb-NO': nordicCross('#BA0C2F', '#fff', '#00205B'),
  'fi-FI': nordicCross('#fff', '#003580'),
  'is-IS': nordicCross('#02529C', '#fff', '#DC1E35'),
  'fr-FR': (
    <>
      <rect width="8" height="18" fill="#002395" />
      <rect x="8" width="8" height="18" fill="#fff" />
      <rect x="16" width="8" height="18" fill="#ED2939" />
    </>
  ),
  'de-DE': (
    <>
      <rect width="24" height="6" fill="#000" />
      <rect y="6" width="24" height="6" fill="#DD0000" />
      <rect y="12" width="24" height="6" fill="#FFCE00" />
    </>
  ),
  'es-ES': (
    <>
      <rect width="24" height="18" fill="#AA151B" />
      <rect y="4.5" width="24" height="9" fill="#F1BF00" />
    </>
  ),
  'zh-CN': (
    <>
      <rect width="24" height="18" fill="#EE1C25" />
      {/*
        Positions from the published specification's 30x20 grid, scaled to this one: the large star
        at (5,5) with radius 3, the four small ones at (10,2), (12,4), (12,7) and (10,9) with
        radius 1, each turned to point at the large one.

        The yellow is #FFDE00, the specified gold. It was #FFFF00 — pure yellow, a noticeably
        colder colour beside that red.
      */}
      <path d={star(CHINA_BIG[0], CHINA_BIG[1], 2.4)} fill="#FFDE00" />
      <path d={star(8, 1.8, 0.8, CHINA_BIG)} fill="#FFDE00" />
      <path d={star(9.6, 3.6, 0.8, CHINA_BIG)} fill="#FFDE00" />
      <path d={star(9.6, 6.3, 0.8, CHINA_BIG)} fill="#FFDE00" />
      <path d={star(8, 8.1, 0.8, CHINA_BIG)} fill="#FFDE00" />
    </>
  ),
  'ja-JP': (
    <>
      <rect width="24" height="18" fill="#fff" />
      <circle cx="12" cy="9" r="5.4" fill="#BC002D" />
    </>
  ),
  'ru-RU': (
    <>
      <rect width="24" height="6" fill="#fff" />
      <rect y="6" width="24" height="6" fill="#0039A6" />
      <rect y="12" width="24" height="6" fill="#D52B1E" />
    </>
  ),
};

/** The locales this component can draw. `flag.test.ts` holds it against the registry. */
export const FLAG_LOCALES = Object.keys(FLAGS);
