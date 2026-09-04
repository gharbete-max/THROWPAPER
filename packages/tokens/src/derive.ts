import {
  BOUNDARY_CONTRAST,
  contrastRatio,
  luminance,
  parseHex,
  TEXT_CONTRAST,
} from './contrast.js';
import type { ColourTokens, TokenSet } from './types.js';

/**
 * Values computed from the tokens somebody actually set.
 *
 * ## Why derive rather than add fields
 *
 * A modern interface needs more than one radius, one text size and one shadow: a pill and a card
 * do not share a corner, a caption and a page title do not share a size. The obvious move is to
 * add `radiusSmall`, `radiusLarge`, `fontSizeCaption` … to `TokenSet`.
 *
 * That move is a trap here. `TokenSet` is a Zod schema on the wire, a row in every organisation's
 * brand kit, a form in the brand editor, and an input to four compilers. Every field added is a
 * migration, a control somebody has to understand, and one more way for two organisations to end
 * up with incoherent scales.
 *
 * So the scales are *derived*. An organisation sets one radius and gets a family; sets one text
 * size and a ratio and gets a scale. Nothing migrates, the brand editor does not grow, and a kit
 * saved a year ago picks all of this up the moment it is recompiled.
 *
 * Everything resolves to a literal. `presets.test.ts` asserts the compiled CSS contains no `var(`,
 * because the email and PDF targets cannot follow one.
 */

function toHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b]
    .map((c) =>
      Math.max(0, Math.min(255, Math.round(c)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

/** `amount` of `a` against `b`, in plain sRGB. Enough for tints; nobody is printing these. */
export function mix(a: string, b: string, amount: number): string {
  const left = parseHex(a);
  const right = parseHex(b);
  if (!left || !right) return a;
  return toHex([
    left[0] * amount + right[0] * (1 - amount),
    left[1] * amount + right[1] * (1 - amount),
    left[2] * amount + right[2] * (1 - amount),
  ]);
}

/**
 * Whichever of the theme's own light and dark reads better on `background`.
 *
 * Not "white if it is dark, black if it is light": a parchment theme wants its own cream on a navy
 * button, not `#fff`, or the button is the one pure white thing in a palette that has none.
 */
export function readableOn(background: string, light: string, dark: string): string {
  const bg = luminance(background);
  const l = luminance(light);
  const d = luminance(dark);
  if (bg === null || l === null || d === null) return dark;
  const ratio = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  return ratio(bg, l) >= ratio(bg, d) ? light : dark;
}

/** How light a colour is, 0–1, by the same maths the contrast checker uses. */
function lightness(colour: string): number {
  return luminance(colour) ?? 0.5;
}

/**
 * sRGB to HSL, and back.
 *
 * Here so that a colour can be made lighter without being made greyer. Every other operation in
 * this file is a mix, which is the right tool for a tint and the wrong one for a lift.
 */
export function toHsl(colour: string): [number, number, number] | null {
  const rgb = parseHex(colour);
  if (!rgb) return null;
  const [r, g, b] = rgb.map((channel) => channel / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const delta = max - min;
  if (delta === 0) return [0, 0, l];

  const s = delta / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = ((g - b) / delta) % 6;
  else if (max === g) h = (b - r) / delta + 2;
  else h = (r - g) / delta + 4;
  return [(h * 60 + 360) % 360, s, l];
}

/** Internal: only `lift` needs it, so it is not part of the package's surface. */
function fromHsl([h, s, l]: [number, number, number]): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const sector = Math.floor((((h % 360) + 360) % 360) / 60);
  const [r, g, b] = (
    [
      [c, x, 0],
      [x, c, 0],
      [0, c, x],
      [0, x, c],
      [x, 0, c],
      [c, 0, x],
    ] as const
  )[sector] ?? [0, 0, 0];
  return toHex([(r + m) * 255, (g + m) * 255, (b + m) * 255]);
}

/**
 * A dark palette derived from a light one.
 *
 * Dark mode is the most-asked-for feature in any product with a text field in it, and the usual
 * implementation is a second hand-authored palette. That cannot work here: the palette belongs to
 * the customer, there are as many of them as there are organisations, and nobody is going to
 * hand-author a dark variant of a brand kit somebody edits in a browser.
 *
 * So it is derived, and every organisation gets a dark theme the moment this ships — including the
 * ones who set their colours a year ago.
 *
 * **The derivation is not an inversion.** Inverting a palette gives you a muddy grey-brown page
 * and brand colours too dark to see. What actually reads:
 *
 * - The page becomes a very dark tint *of the brand's own text colour*, so a warm palette stays
 *   warm and a cool one stays cool. A neutral `#111` for everybody is what makes dark modes look
 *   like a different product.
 * - Surfaces sit **above** the page, not below it. On light backgrounds a card is darker than the
 *   page; on dark ones it must be lighter, or every card reads as a hole.
 * - Brand colours are lifted toward the light end until they carry on a dark ground. A navy
 *   primary at 0.05 luminance is invisible on a dark page and unusable as a button.
 *
 * `derive.test.ts` runs the contrast checker over the dark form of every shipped preset, so a
 * derivation that produces something unreadable fails the build rather than shipping.
 */
export function toDarkColours(colour: ColourTokens): ColourTokens {
  // The darkest ink in the palette is the hue the page should be tinted with.
  const ink =
    lightness(colour.text) <= lightness(colour.background) ? colour.text : colour.background;

  const background = mix(ink, '#000000', 0.34);
  const surface = mix(ink, '#000000', 0.52);
  // The paper colour becomes the ink, pulled off pure white so it is not glaring at night.
  const paper =
    lightness(colour.background) >= lightness(colour.text) ? colour.background : colour.text;
  const text = mix(paper, '#ffffff', 0.82);

  /**
   * Lift a brand colour until it carries on the dark page, keeping its hue.
   *
   * Done in HSL, not by mixing toward the page's text colour. Mixing was the first attempt and it
   * turned the midnight navy `#1b2a45` into `#b0b2b5` — a dead grey. Of course it did: mixing a
   * dark colour with near-white walks it up the *neutral* axis, so the lighter it gets the less of
   * it is left. Saturation is the thing that has to survive, and only a hue-preserving space keeps
   * it.
   *
   * Saturation is nudged up rather than merely held, because a light colour reads as less
   * saturated than a dark one of the same value — the same reason a pastel needs more pigment than
   * it looks like it should.
   */
  const lift = (value: string): string => {
    if (lightness(value) >= 0.32) return value;
    const hsl = toHsl(value);
    if (!hsl) return value;
    const [h, s, l] = hsl;
    return fromHsl([h, Math.min(1, s * 1.12), Math.max(l, 0.66)]);
  };

  return {
    primary: lift(colour.primary),
    secondary: lift(colour.secondary),
    accent: lift(colour.accent),
    background,
    surface,
    text,
    muted: mix(text, background, 0.62),
    // Borders on dark are lighter than the surface they sit on, never darker.
    border: mix(text, surface, 0.34),
    success: lift(colour.success),
    warning: lift(colour.warning),
    danger: lift(colour.danger),
  };
}

/**
 * The accent, dark enough to be read as words.
 *
 * `accent` is decoration in the app — the second wing of the mark, the edge of a quote — so
 * `checkContrast` deliberately never tests it against the background: reporting a pair nothing
 * renders trains people to ignore the warnings.
 *
 * Then the site used it as text. A small uppercase label in the shipped accent came out at 3.57:1
 * against parchment, under the 4.5 that normal text needs, and nothing could have caught it:
 * the checker was right not to look, and the stylesheet was the first place the colour became
 * words.
 *
 * So there is a token for that use. It walks the accent toward the palette's own ink until it
 * clears the bar, which terminates at `text` — a colour the checker *does* hold to 4.5:1 against
 * the background, so the worst case is legible by something already guaranteed. The hue survives
 * for every palette where it can.
 */
export function accentInk(colour: ColourTokens): string {
  for (let step = 0; step <= 10; step += 1) {
    const candidate = mix(colour.accent, colour.text, 1 - step / 10);
    if ((contrastRatio(candidate, colour.background) ?? 0) >= TEXT_CONTRAST) return candidate;
  }
  return colour.text;
}

/**
 * The glass an overlay is made of.
 *
 * Liquid glass, done with the platform rather than with WebGL. The library that inspired this
 * screenshots the page with `html2canvas` and refracts it through a WebGL surface, which is
 * beautiful and wrong for this product: it re-rasterises on every scroll and theme change, it
 * renders nothing on the server, and its buttons are a canvas rather than a `<button>` — no focus
 * ring, no accessible name, on a product with a check-in screen used at a door.
 *
 * What actually reads as glass is four things, and a browser does all of them natively:
 *
 * 1. A **translucent tint** of the surface behind, so the page shows through.
 * 2. **Blur and saturation** on what is behind — the saturation matters more than people expect,
 *    because real glass concentrates colour as well as scattering it.
 * 3. A **bright inner hairline** along the top edge, which is the specular highlight that makes a
 *    pane look like it has thickness rather than being a coloured rectangle.
 * 4. A **shadow beneath**, because glass floats.
 *
 * Derived per palette so it works in both themes without a second set of values: on a light theme
 * the tint leans toward the page's own background and the highlight is white; on a dark one the
 * tint is deeper and the highlight is a much quieter white, because a bright edge on a dark pane
 * reads as a mistake rather than as light.
 */
export function glassSurface(colour: ColourTokens): {
  tint: string;
  edge: string;
  hairline: string;
} {
  // A dark palette is one whose page is darker than its ink.
  const dark = lightness(colour.background) < lightness(colour.text);

  return {
    /** The pane itself. Kept off full opacity, or there is no glass — only a panel. */
    tint: withAlpha(mix(colour.background, colour.surface, dark ? 0.4 : 0.7), dark ? 0.72 : 0.68),
    /** The outer edge: the border, picked up from the palette rather than invented. */
    edge: withAlpha(colour.border, dark ? 0.55 : 0.7),
    /** The specular highlight along the top. Much quieter on dark, where light is scarcer. */
    hairline: dark ? 'rgb(255 255 255 / 0.10)' : 'rgb(255 255 255 / 0.55)',
  };
}

/** `#rrggbb` to `rgb(r g b / a)`, so a token can carry transparency without a second field. */
function withAlpha(hex: string, alpha: number): string {
  const rgb = parseHex(hex);
  if (!rgb) return hex;
  return `rgb(${rgb[0]} ${rgb[1]} ${rgb[2]} / ${alpha})`;
}

export function toDark(tokens: TokenSet): TokenSet {
  return { ...tokens, colour: toDarkColours(tokens.colour) };
}

/**
 * What a button of this theme's `buttonStyle` is actually painted with.
 *
 * `buttonStyle` has been in `TokenSet` since phase 1, and four of the five shipped presets set it
 * to something other than `solid` — `minimal` asks for outline, `garden` for soft. None of it ever
 * reached the page, because the web compiler never emitted it and no stylesheet asked. Choosing
 * "Minimal" gave you the same solid button as everything else.
 *
 * Resolving it here rather than in CSS is what fixes it for every target at once: a CSS custom
 * property cannot drive a selector, but it can carry a colour, and email and PDF can read the same
 * three values without knowing the word "outline".
 */
/**
 * The brand colour, taken far enough from the page that a filled shape reads as a shape.
 *
 * `accentInk` solves the same problem for *text*. This is the other half, and it was missing: a
 * filled button whose label is perfectly readable can still be invisible as a button, because
 * nothing was checking the fill against the page behind it. WCAG asks for 3:1 on the boundary of a
 * control for exactly this reason.
 *
 * It matters much more now than it did. The Brand Kit reads an organisation's logo and offers its
 * dominant colour as the primary, so the palette is no longer something a person chose by looking
 * at it — a pale yellow wordmark yields a pale yellow primary, and a pale yellow button on
 * parchment is a rectangle nobody can see the edge of.
 *
 * ## Why this moves lightness rather than mixing toward the ink
 *
 * Mixing toward `text` was the first implementation and it fails the one property that matters
 * here: the shipped ink is a near-black with a blue cast, so a pale yellow walked toward it comes
 * out greener and then bluer. The organisation whose logo that yellow came from would be right to
 * ask what happened to it.
 *
 * Moving along lightness in HSL keeps hue and saturation exactly, which is what "the same colour,
 * darker" means to everybody except a computer. Toward whichever end of the scale the page is not:
 * a pale brand on a pale page darkens, and the same brand on a dark page lightens instead.
 */
export function brandFill(colour: ColourTokens): string {
  if ((contrastRatio(colour.primary, colour.background) ?? 0) >= BOUNDARY_CONTRAST) {
    return colour.primary;
  }

  const hsl = toHsl(colour.primary);
  const pageLuminance = luminance(colour.background);
  /*
   * A colour neither of these can read is a colour there is no basis for changing.
   *
   * Without the page's luminance there is no way to tell which direction is away from it, and a
   * guess would be a brand darkened on a dark page — worse than leaving it alone.
   */
  if (!hsl || pageLuminance === null) return colour.primary;
  /* Named to avoid shadowing this module's own `lightness`, which reads a colour rather than a step. */
  const [hue, saturation, startLightness] = hsl;

  /* Away from the page: darken on a light page, lighten on a dark one. */
  const target = pageLuminance > 0.5 ? 0 : 1;

  let candidate = colour.primary;
  for (let step = 1; step <= 20; step += 1) {
    const moved = startLightness + (target - startLightness) * (step / 20);
    candidate = fromHsl([hue, saturation, moved]);
    if ((contrastRatio(candidate, colour.background) ?? 0) >= BOUNDARY_CONTRAST) return candidate;
  }
  return candidate;
}

export function buttonSurface(tokens: TokenSet): {
  background: string;
  text: string;
  border: string;
} {
  const { background, text } = tokens.colour;
  /* Not `colour.primary`: see `brandFill`. A button has to be visible as well as legible. */
  const primary = brandFill(tokens.colour);
  const onPrimary = readableOn(primary, background, text);

  switch (tokens.buttonStyle) {
    case 'outline':
      return { background: 'transparent', text: primary, border: primary };
    case 'soft':
      /*
       * A soft button is a tint of the brand, which is fainter still, so its border carries the
       * boundary contrast instead of its fill. Without one it is a slightly different shade of
       * page.
       */
      return { background: mix(primary, background, 0.14), text: primary, border: primary };
    default:
      return { background: primary, text: onPrimary, border: primary };
  }
}

/**
 * The elevation ramp.
 *
 * Modern elevation is two soft layers at low opacity — a tight shadow for the contact edge and a
 * wide one for the ambient cast. One hard `0 2px 4px rgb(0 0 0 / 0.3)` is what dates an interface
 * fastest.
 */
const SHADOWS = [
  'none',
  '0 1px 2px rgb(0 0 0 / 0.04), 0 1px 3px rgb(0 0 0 / 0.06)',
  '0 2px 4px rgb(0 0 0 / 0.04), 0 6px 16px rgb(0 0 0 / 0.08)',
  '0 4px 8px rgb(0 0 0 / 0.05), 0 16px 32px rgb(0 0 0 / 0.12)',
] as const;

export function shadow(level: number): string {
  return SHADOWS[Math.max(0, Math.min(3, Math.round(level)))] ?? 'none';
}
