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
  const draw = FLAGS[locale] ?? FLAGS[locale.split('-')[1] ?? ''] ?? null;

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
      {/* One large star and four small ones. At 24px the small stars are dots — which is what
          they look like at this size on any flag, drawn or photographed. */}
      <path
        d="M5 2.2 L5.9 4.7 L8.5 4.7 L6.4 6.3 L7.2 8.8 L5 7.3 L2.8 8.8 L3.6 6.3 L1.5 4.7 L4.1 4.7 Z"
        fill="#FFFF00"
      />
      <circle cx="9.8" cy="2.2" r="0.9" fill="#FFFF00" />
      <circle cx="11.6" cy="4.3" r="0.9" fill="#FFFF00" />
      <circle cx="11.6" cy="7.1" r="0.9" fill="#FFFF00" />
      <circle cx="9.8" cy="9.1" r="0.9" fill="#FFFF00" />
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
