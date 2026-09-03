import { buttonSurface, shadow, toDark } from './derive.js';
import type { TokenSet } from './types.js';
import { px, pxValue, typeScale } from './units.js';

/**
 * Web target: CSS custom properties. Components consume variables only — CLAUDE.md rule 4.
 *
 * Two groups come out of here. The **set** tokens are what an organisation edited, one variable
 * each, unchanged since phase 0. The **derived** tokens are the scales computed from them in
 * `derive.ts` — a radius family from one radius, a type scale from one size and a ratio, an
 * elevation ramp from one level.
 *
 * Deriving rather than storing is what lets the interface get a proper set of scales without the
 * brand kit growing a single new control, and without one migration.
 */
export function toCssVariables(tokens: TokenSet): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const [key, value] of Object.entries(tokens.colour)) vars[`--tp-colour-${key}`] = value;
  for (const [key, value] of Object.entries(tokens.typography)) {
    vars[`--tp-type-${kebab(key)}`] = String(value);
  }
  vars['--tp-spacing-unit'] = tokens.spacingUnit;
  vars['--tp-radius'] = tokens.radius;
  vars['--tp-border-width'] = tokens.borderWidth;
  vars['--tp-control-height'] = tokens.controlHeight;
  vars['--tp-content-width'] = tokens.contentWidth;

  /**
   * A radius family, not one corner for everything.
   *
   * A card, a text input and a badge share a radius in this app today, which is the single
   * clearest tell that a design has one number where it needs three. The family keeps the
   * relationship the author chose: set 0 and everything stays square, set 16 and the whole
   * interface softens together.
   */
  const radius = safePx(tokens.radius, 6);
  vars['--tp-radius-sm'] = px(radius * 0.5);
  vars['--tp-radius-lg'] = px(radius * 1.75);
  vars['--tp-radius-xl'] = px(radius * 2.5);
  // A pill is not a multiple of anything; it is "as round as it goes".
  vars['--tp-radius-pill'] = '999px';

  /**
   * The type scale the ratio always implied.
   *
   * `scaleRatio` has been a token since phase 0 and reached the page as a bare number no rule
   * could use. Every heading size in the stylesheet was therefore picked by hand, which is why
   * changing the ratio in the brand editor did nothing visible.
   */
  const { baseSize, scaleRatio } = tokens.typography;
  vars['--tp-text-xs'] = typeScale(baseSize, scaleRatio, -2);
  vars['--tp-text-sm'] = typeScale(baseSize, scaleRatio, -1);
  vars['--tp-text-base'] = baseSize;
  vars['--tp-text-lg'] = typeScale(baseSize, scaleRatio, 1);
  vars['--tp-text-xl'] = typeScale(baseSize, scaleRatio, 2);
  vars['--tp-text-2xl'] = typeScale(baseSize, scaleRatio, 3);
  vars['--tp-text-3xl'] = typeScale(baseSize, scaleRatio, 4);

  /**
   * Elevation. `--tp-shadow` is the theme's resting height and is `none` on a flat theme;
   * `--tp-shadow-overlay` is what floats above the page and is never `none`, because a dialog with
   * no shadow on a flat theme is a dialog nobody can see the edge of.
   */
  vars['--tp-shadow'] = shadow(tokens.shadowLevel);
  vars['--tp-shadow-raised'] = shadow(Math.max(1, tokens.shadowLevel));
  vars['--tp-shadow-overlay'] = shadow(3);

  // The button style, resolved to paint. See `buttonSurface` — this is the token that never
  // reached the page.
  const button = buttonSurface(tokens);
  vars['--tp-button-background'] = button.background;
  vars['--tp-button-text'] = button.text;
  vars['--tp-button-border'] = button.border;

  /**
   * Motion, in the tokens rather than invented in the stylesheet.
   *
   * These were three hard-coded values in `styles.css`, which meant the one thing a brand cannot
   * currently change is the one thing that most decides whether an interface feels expensive.
   * They are constants for now — no control sets them — but they live here so a "reduce motion"
   * or "snappier" preference has somewhere to go that reaches email and native too.
   */
  vars['--tp-ease'] = 'cubic-bezier(0.2, 0, 0, 1)';
  vars['--tp-motion-fast'] = '110ms';
  vars['--tp-motion'] = '180ms';
  vars['--tp-motion-slow'] = '320ms';

  return vars;
}

export function toCssBlock(tokens: TokenSet, selector = ':root'): string {
  const body = Object.entries(toCssVariables(tokens))
    .map(([name, value]) => `  ${name}: ${value};`)
    .join('\n');
  return `${selector} {\n${body}\n}\n`;
}

/**
 * The whole theme: light, and the derived dark under both the media query and an explicit opt-in.
 *
 * Three states, because two is not enough. `data-theme` set to `light` or `dark` is somebody's
 * stated choice and must win in *both* directions; absent, the operating system decides. A dark
 * mode that can only be turned on, never off, is the common bug and it is this selector that
 * prevents it.
 */
export function toThemedCssBlock(tokens: TokenSet): string {
  const dark = toCssBlock(toDark(tokens), ':root[data-theme="dark"]');
  const auto = toCssBlock(toDark(tokens), ':root:not([data-theme="light"])');
  return `${toCssBlock(tokens)}\n@media (prefers-color-scheme: dark) {\n${indent(auto)}}\n\n${dark}`;
}

function indent(block: string): string {
  return block
    .split('\n')
    .map((line) => (line ? `  ${line}` : line))
    .join('\n');
}

/** A length the brand kit may have stored as something other than px. Falls back rather than throws. */
function safePx(length: string, fallback: number): number {
  try {
    return pxValue(length);
  } catch {
    return fallback;
  }
}

function kebab(value: string): string {
  return value.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}
