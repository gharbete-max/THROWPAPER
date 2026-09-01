import defaults from './default-tokens.json' with { type: 'json' };
import type { TokenSet } from './types.js';

export type { TokenSet, ColourTokens, TypographyTokens } from './types.js';

/** Web target — CSS custom properties. */
export { toCssVariables, toCssBlock } from './compile-web.js';

/** Email target — resolved inline styles and table layout. Browser-safe, no dependencies. */
export { toEmailStyles, type EmailStyles } from './compile-email.js';

/** Native target — unitless numbers for a React Native StyleSheet. Browser-safe, no dependencies. */
export { toNativeTokens, type NativeTokens } from './compile-native.js';

export { pxValue, px, spacing, typeScale } from './units.js';

export {
  checkContrast,
  contrastRatio,
  luminance,
  parseHex,
  BOUNDARY_CONTRAST,
  TEXT_CONTRAST,
  type ContrastFinding,
} from './contrast.js';

/**
 * The PDF target lives at `@tp/tokens/pdf`, not here: it embeds font files from disk and so is
 * node-only. Keeping it off this entry point is what stops node:fs reaching the browser bundles.
 */

export const defaultTokens = defaults as TokenSet;
