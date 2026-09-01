/**
 * The icon set.
 *
 * Three decisions worth stating, because each one is what keeps icons from becoming a maintenance
 * problem later:
 *
 * **Inline SVG, never a font or an image.** An icon font needs a network request and renders as a
 * missing glyph until it arrives; an image cannot change colour. These are markup, so they cost
 * nothing extra to load and they are part of the page.
 *
 * **`currentColor`, never a colour of their own.** An icon takes the colour of the text it sits
 * beside, which means it is themed by the Brand Kit for free and `CLAUDE.md` rule 4 — no
 * hard-coded colours — is satisfied structurally rather than by remembering. Change the brand and
 * every icon follows.
 *
 * **Stroked, not filled, and no gradients anywhere.** The stated visual direction is flat and
 * quiet. Uniform stroke weight at a common size is what makes a set look like a set.
 *
 * Sized in `em` so an icon scales with whatever text it accompanies rather than needing a size
 * prop at every call site.
 */

export type IconName =
  // Field types — one per entry in FIELD_TYPES. `icons.test.ts` proves the mapping is total.
  | 'short_text'
  | 'long_text'
  | 'number'
  | 'email'
  | 'phone'
  | 'date'
  | 'single_select'
  | 'multi_select'
  | 'yes_no'
  | 'section_break'
  | 'page_break'
  | 'rich_text'
  | 'image'
  | 'hidden'
  // Actions and navigation.
  | 'arrow-left'
  | 'arrow-right'
  | 'arrow-up'
  | 'arrow-down'
  | 'check'
  | 'close'
  | 'plus'
  | 'copy'
  | 'trash'
  | 'drag'
  | 'events'
  | 'forms'
  | 'brand'
  | 'preview'
  | 'save'
  | 'publish'
  | 'warning'
  | 'search';

/** 24×24 paths, stroke-width 2, round caps. */
const PATHS: Record<IconName, string> = {
  short_text: 'M4 9h16M4 15h9',
  long_text: 'M4 6h16M4 12h16M4 18h10',
  number: 'M6 4 4 20M14 4l-2 16M3 9h17M3 15h17',
  email: 'M3 6h18v12H3zM3 7l9 6 9-6',
  phone: 'M8 3H5a2 2 0 0 0-2 2c0 8 8 16 16 16a2 2 0 0 0 2-2v-3l-4-2-2 3a14 14 0 0 1-6-6l3-2z',
  date: 'M4 6h16v14H4zM4 10h16M9 3v4M15 3v4',
  single_select: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  multi_select: 'M4 5h16v14H4zM8 12l3 3 5-6',
  yes_no: 'M8 6h8a6 6 0 0 1 0 12H8A6 6 0 0 1 8 6zM16 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  section_break: 'M3 12h18M6 7h12M6 17h12',
  page_break: 'M3 12h4M10 12h4M17 12h4M12 3v4M12 17v4',
  rich_text: 'M5 5h14M5 10h14M5 15h9M5 20h6',
  image: 'M3 5h18v14H3zM3 16l5-5 4 4 3-3 6 6',
  hidden: 'M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6zM4 4l16 16',

  'arrow-left': 'M20 12H4M10 6l-6 6 6 6',
  'arrow-right': 'M4 12h16M14 6l6 6-6 6',
  'arrow-up': 'M12 20V4M6 10l6-6 6 6',
  'arrow-down': 'M12 4v16M6 14l6 6 6-6',
  check: 'M4 13l5 5L20 6',
  close: 'M6 6l12 12M18 6 6 18',
  plus: 'M12 5v14M5 12h14',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  trash: 'M4 7h16M10 4h4M6 7l1 13h10l1-13M10 11v5M14 11v5',
  drag: 'M9 6h.01M9 12h.01M9 18h.01M15 6h.01M15 12h.01M15 18h.01',
  events: 'M4 6h16v14H4zM4 10h16M9 3v4M15 3v4M8 14h3v3H8z',
  forms: 'M6 3h9l4 4v14H6zM15 3v4h4M9 12h7M9 16h5',
  brand:
    'M12 3a9 9 0 1 0 1 17.9c1-.1 1.4-1.3.7-2a2 2 0 0 1 1.4-3.4H18a3 3 0 0 0 3-3.2A9 9 0 0 0 12 3zM7.5 12a1 1 0 1 0 0-.01M10 8a1 1 0 1 0 0-.01M15 8a1 1 0 1 0 0-.01',
  preview: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  save: 'M5 4h11l3 3v13H5zM8 4v6h7V4M8 20v-6h8v6',
  publish: 'M12 20V6M6 12l6-6 6 6M4 3h16',
  warning: 'M12 4 2 20h20L12 4zM12 10v5M12 18h.01',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM16 16l4 4',
};

export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg
      className={className ? `icon ${className}` : 'icon'}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      /**
       * Decorative by default. Every icon in this app sits beside its own label, so announcing it
       * would make a screen reader say everything twice. An icon-only control names itself with
       * `aria-label` on the button, which is where the name belongs.
       */
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

export const ICON_NAMES = Object.keys(PATHS) as IconName[];
