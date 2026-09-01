import type { TokenSet } from './types.js';
import { pxValue, spacing, typeScale } from './units.js';

/**
 * Native target — the fourth compiler `SPEC-shared.md` §packages/tokens asks for.
 *
 * Phase 1 built web, email and PDF and deferred this one because nothing consumed it. A mobile app
 * is now a stated direction (`ROADMAP.md` §Later), so it exists ahead of the app rather than being
 * discovered as missing halfway through building one.
 *
 * React Native's StyleSheet takes **unitless numbers**, not CSS lengths: `padding: 16`, never
 * `'16px'`. That single difference is the whole reason this cannot just reuse the web compiler,
 * and getting it wrong produces a layout that silently collapses.
 */
export interface NativeTokens {
  colour: Record<keyof TokenSet['colour'], string>;
  spacing: { xs: number; sm: number; md: number; lg: number; xl: number };
  radius: number;
  borderWidth: number;
  typography: {
    headingFamily: string;
    bodyFamily: string;
    size: { sm: number; base: number; lg: number; xl: number; xxl: number };
    lineHeight: number;
    weightRegular: string;
    weightBold: string;
  };
}

export function toNativeTokens(tokens: TokenSet): NativeTokens {
  const { colour, typography } = tokens;
  const unit = tokens.spacingUnit;
  const base = pxValue(typography.baseSize);

  return {
    // Colours pass through unchanged: React Native understands the same hex strings.
    colour: { ...colour },

    spacing: {
      xs: pxValue(spacing(unit, 0.5)),
      sm: pxValue(spacing(unit, 1)),
      md: pxValue(spacing(unit, 2)),
      lg: pxValue(spacing(unit, 3)),
      xl: pxValue(spacing(unit, 5)),
    },

    radius: pxValue(tokens.radius),
    borderWidth: pxValue(tokens.borderWidth),

    typography: {
      headingFamily: primaryFamily(typography.headingFont),
      bodyFamily: primaryFamily(typography.bodyFont),
      size: {
        sm: round(base * 0.875),
        base,
        lg: pxValue(typeScale(typography.baseSize, typography.scaleRatio, 1)),
        xl: pxValue(typeScale(typography.baseSize, typography.scaleRatio, 2)),
        xxl: pxValue(typeScale(typography.baseSize, typography.scaleRatio, 3)),
      },
      lineHeight: round(base * typography.lineHeight),
      // React Native wants weights as strings — 400 and 600, not numbers.
      weightRegular: String(typography.weightRegular),
      weightBold: String(typography.weightBold),
    },
  };
}

/**
 * "Inter, system-ui, sans-serif" -> "Inter".
 *
 * A native StyleSheet takes one family name, not a fallback stack: passing the whole stack renders
 * the system default and looks like nothing is wrong.
 */
function primaryFamily(stack: string): string {
  const first = stack.split(',')[0] ?? stack;
  return first.trim().replace(/^['"]|['"]$/g, '');
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
