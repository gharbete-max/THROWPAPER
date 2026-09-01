import { z } from 'zod';

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
 * A font stack. Length-capped and quote-free — this string is interpolated into an inline `style`
 * attribute in email, where an unescaped quote ends the attribute early.
 */
const FontStack = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine((value) => !/["'<>;{}]/.test(value), 'Font names cannot contain quotes or punctuation');

/** `/public/assets/<sha256>.<ext>` and nothing else. See the note on `logoLight`. */
const AssetPath = z
  .string()
  .trim()
  .regex(
    /^\/public\/assets\/[0-9a-f]{64}\.(png|jpg|webp|gif)$/,
    'Upload an image and use the path it returns',
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
  baseSize: Px,
  /** A type scale below 1 shrinks headings below body text; above 2 they leave the page. */
  scaleRatio: z.number().min(1).max(2),
  lineHeight: z.number().min(1).max(2.5),
  weightRegular: z.number().int().min(100).max(900),
  weightBold: z.number().int().min(100).max(900),
});

export const BrandKit = z.object({
  colour: ColourTokens,
  typography: TypographyTokens,
  spacingUnit: Px,
  radius: Px,
  borderWidth: Px,
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
