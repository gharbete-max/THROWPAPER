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
   * Logos and favicon are URLs, and stay `null` until there is somewhere to upload them —
   * `SPEC-forms.md` §7 defers object storage. Kept in the shape so the schema does not change
   * when they arrive.
   */
  logoLight: z.string().url().nullable().default(null),
  logoDark: z.string().url().nullable().default(null),
  favicon: z.string().url().nullable().default(null),
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
