import { z } from 'zod';
import { AssetPath } from '../assets.js';

/**
 * The brand kit: what an organisation may set, and what it may not.
 *
 * This is the schema, not the compiler. `packages/tokens` turns a token set into CSS, inline email
 * styles, print CSS and a native stylesheet; this decides what is allowed to arrive in the first
 * place, because these values are written by a customer and then interpolated into four different
 * output formats.
 *
 * Colours are hex and nothing else. `red`, `rgb(...)` and `var(--x)` are all rejected — not out of
 * fussiness, but because a token is pasted into an email's `style` attribute and into print CSS,
 * and "whatever the browser makes of it" is not a specification. Hex is the format every one of
 * the four targets agrees on.
 */
const Hex = z
  .string()
  .trim()
  .regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'Use a hex colour such as #1B263B')
  /** Stored lower case and expanded, so two spellings of one colour compare equal. */
  .transform((value) => {
    const digits = value.slice(1).toLowerCase();
    const full =
      digits.length === 3
        ? digits
            .split('')
            .map((digit) => digit + digit)
            .join('')
        : digits;
    return `#${full}`;
  });

/**
 * A CSS length in pixels. Not an arbitrary CSS value: the PDF and email compilers do arithmetic on
 * these (the type scale, the spacing scale), and `1.5rem` or `calc(...)` would silently produce
 * NaN somewhere downstream rather than fail here.
 */
const Px = z
  .string()
  .trim()
  .regex(/^\d+(\.\d+)?px$/, 'Use a pixel value such as 16px');

/**
 * A pixel value with a floor that a theme may not go under, clamped rather than rejected.
 *
 * These are the accessibility guarantees that survive theming. They are not taste — a 30px control
 * is a target a thumb misses, and a 13px input is one iOS zooms the page for on focus, moving the
 * form under the finger of the person filling it in. A customer who sets them has not decided to
 * exclude anybody; they have picked a number that looked tidy in a preview on a laptop.
 *
 * **Clamped, not rejected**, and the difference matters here. `resolveTokens` falls back to the
 * *entire* default kit when a stored row fails to parse, so rejecting would answer "your control
 * height is 30px" by silently discarding the organisation's colours, fonts and logo as well. A
 * floor keeps every choice that is theirs to make and holds the one that is not.
 *
 * The editor is where somebody should be told, and `checkContrast` is the pattern for that:
 * advisory there, absolute here.
 */
const PxAtLeast = (floor: number, why: string) =>
  Px.transform((value) => {
    const measured = Number.parseFloat(value);
    return Number.isFinite(measured) && measured < floor ? `${floor}px` : value;
  }).describe(why);

/**
 * A font stack. Length-capped and quote-free — this string is interpolated into an inline `style`
 * attribute in email, where an unescaped quote ends the attribute early.
 *
 * No slash, star or backslash either: the same string lands verbatim inside a `<style>` block the
 * server inlines, where `/*` opens a comment that swallows every declaration after it. Not an
 * escape — the CSP and the tag boundary hold — but a palette that silently stops at the font.
 */
const FontStack = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine(
    (value) => !/["'<>;{}/*\\]/.test(value),
    'Font names cannot contain quotes or punctuation',
  );

export const ColourTokens = z.object({
  primary: Hex,
  secondary: Hex,
  accent: Hex,
  background: Hex,
  surface: Hex,
  text: Hex,
  muted: Hex,
  border: Hex,
  success: Hex,
  warning: Hex,
  danger: Hex,
});

export const TypographyTokens = z.object({
  headingFont: FontStack,
  bodyFont: FontStack,
  /**
   * 16px or larger, and this one is a mobile bug rather than a preference.
   *
   * Safari on iOS zooms the page when a text input smaller than 16px takes focus, and does not zoom
   * back out. Somebody filling in a form on a phone gets the layout jumping under their finger at
   * the first field and stays zoomed for the rest of it. The base size drives the input size
   * through the type scale, so this is where it is held.
   */
  baseSize: PxAtLeast(16, 'Inputs below 16px make iOS zoom the page on focus'),
  /** A type scale below 1 shrinks headings below body text; above 2 they leave the page. */
  scaleRatio: z.number().min(1).max(2),
  lineHeight: z.number().min(1).max(2.5),
  weightRegular: z.number().int().min(100).max(900),
  weightBold: z.number().int().min(100).max(900),
  /**
   * A question's label has its own weight, slant and underline, because it is the text people
   * read most and the one an author most often wants to set apart.
   */
  labelWeight: z.number().int().min(100).max(900).default(400),
  labelStyle: z.enum(['normal', 'italic']).default('normal'),
  labelDecoration: z.enum(['none', 'underline']).default('none'),
});

export const BrandKit = z.object({
  colour: ColourTokens,
  typography: TypographyTokens,
  spacingUnit: Px,
  radius: Px,
  /**
   * At least a hairline. `0px` is a legal-looking value that deletes every boundary in the product
   * at once — the edge of an input, the line under a table header, the rule between sections — and
   * WCAG 1.4.11 wants a control's edge to be discernible. A theme that wants to look borderless
   * has `shadowLevel` and `surface` for it.
   */
  borderWidth: PxAtLeast(1, 'A border of 0 leaves controls with no visible edge'),
  /**
   * Defaulted rather than required: a brand kit stored before these existed still parses, which is
   * the same reason `appearance` is defaulted on a field.
   *
   * 44px is the floor because that is the target size a thumb hits reliably, and this product is
   * used at a door on a phone in bad weather.
   */
  controlHeight: PxAtLeast(44, 'Controls below 44px are targets a thumb misses').default('44px'),
  contentWidth: Px.default('640px'),
  shadowLevel: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
  buttonStyle: z.enum(['solid', 'outline', 'soft']),
  /**
   * Logos and favicon, as paths into this application's own asset store.
   *
   * **Not arbitrary URLs.** A brand kit is written by a customer and its values end up in `src`
   * attributes on a public page and in email. Accepting any URL would let one organisation point
   * every form it publishes at a third-party host — which leaks the visitor's IP address to that
   * host on every page load, and hands whoever controls it the ability to change what the form
   * appears to say. The upload endpoint exists so there is somewhere legitimate to put these.
   *
   * The key is the SHA-256 of the file's content, which is what makes the path safe to hard-code
   * here: it cannot encode a path, a host or anything else the uploader chose.
   */
  logoLight: AssetPath.nullable().default(null),
  logoDark: AssetPath.nullable().default(null),
  favicon: AssetPath.nullable().default(null),

  /**
   * White-label: whether this organisation's people see their own identity instead of ours.
   *
   * A separate flag rather than "has a logo", because the two questions are different. Somebody
   * uploads a logo, looks at the preview, and decides on Tuesday whether to turn it on — and
   * turning it off again must not mean deleting the assets they uploaded. Inferring the mode from
   * the presence of a file makes the off switch destructive.
   *
   * It governs the app shell, the sign-in screens and email. It deliberately does **not** govern
   * the marketing site, which is ours and which their members never visit.
   */
  clientMode: z.boolean().default(false),

  /**
   * The name shown in the corner when client mode is on, and the `alt` text for their logo.
   *
   * Capped rather than free: it sits in a top bar next to navigation, and a paragraph pasted in
   * here would push the rest of the bar off a phone. Null means fall back to the organisation's
   * own name, which the app already knows — this exists for the case where the legal entity and
   * the brand are not the same word.
   *
   * No character restriction beyond length. It is rendered as text and as an `alt` attribute,
   * both of which React escapes; the quote-free rule that `FontStack` carries exists because a
   * font stack is interpolated into inline CSS, and nothing here is.
   */
  wordmark: z.string().trim().min(1).max(60).nullable().default(null),
});

export type BrandKit = z.infer<typeof BrandKit>;

/**
 * What a contrast check reports. Advisory, never a validation error: refusing to save somebody's
 * brand because one border is subtle would be obnoxious, and saying nothing would be negligent.
 */
export const ContrastFinding = z.object({
  token: z.string(),
  against: z.string(),
  ratio: z.number(),
  required: z.number(),
  kind: z.enum(['text', 'boundary']),
});

export const BrandKitResponse = z.object({
  tokens: BrandKit,
  /** `false` when no kit has been saved and these are the shipped defaults. */
  customised: z.boolean(),
  updatedAt: z.string().datetime().nullable(),
  warnings: z.array(ContrastFinding),
});
