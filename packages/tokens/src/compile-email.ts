import type { TokenSet } from './types.js';
import { pxValue, px, spacing, typeScale } from './units.js';

/**
 * Email target — SPEC-shared.md §packages/tokens.
 *
 * Email clients support neither CSS custom properties nor modern layout, so this never reuses
 * compile-web.ts output. Every value here is literal and resolved, layout is table-based, and
 * there is no flex, grid, or var(). The unit test asserts exactly that.
 *
 * Return types are inferred rather than widened to Record<string, unknown> so the objects stay
 * assignable to React's CSSProperties without a cast at the call site.
 */
export function toEmailStyles(tokens: TokenSet) {
  const { colour, typography } = tokens;
  const unit = tokens.spacingUnit;
  const radius = tokens.radius;
  const border = `${tokens.borderWidth} solid ${colour.border}`;

  return {
    body: {
      margin: '0',
      padding: '0',
      backgroundColor: colour.surface,
      color: colour.text,
      fontFamily: typography.bodyFont,
      fontSize: typography.baseSize,
      lineHeight: String(typography.lineHeight),
      WebkitTextSizeAdjust: '100%',
      msTextSizeAdjust: '100%',
    },

    /** Outer full-width table. Centring a block element is unreliable in Outlook. */
    wrapper: {
      width: '100%',
      backgroundColor: colour.surface,
      borderCollapse: 'collapse' as const,
    },

    /** Fixed-width content table — the closest thing email has to a container. */
    container: {
      width: '600px',
      maxWidth: '600px',
      margin: '0 auto',
      borderCollapse: 'collapse' as const,
      backgroundColor: colour.background,
    },

    cell: {
      padding: spacing(unit, 3),
    },

    card: {
      backgroundColor: colour.background,
      border,
      borderRadius: radius,
      padding: spacing(unit, 3),
    },

    heading: {
      margin: `0 0 ${spacing(unit, 1)} 0`,
      fontFamily: typography.headingFont,
      fontSize: typeScale(typography.baseSize, typography.scaleRatio, 2),
      fontWeight: String(typography.weightBold),
      lineHeight: String(typography.lineHeight),
      color: colour.primary,
    },

    text: {
      margin: `0 0 ${spacing(unit, 2)} 0`,
      fontFamily: typography.bodyFont,
      fontSize: typography.baseSize,
      fontWeight: String(typography.weightRegular),
      lineHeight: String(typography.lineHeight),
      color: colour.text,
    },

    muted: {
      margin: '0',
      fontFamily: typography.bodyFont,
      fontSize: px(pxValue(typography.baseSize) * 0.875),
      lineHeight: String(typography.lineHeight),
      color: colour.muted,
    },

    /** Bulletproof-ish button: a padded anchor, no background images, no border-radius reliance. */
    button: buttonStyle(tokens),

    divider: {
      width: '100%',
      height: '1px',
      margin: `${spacing(unit, 3)} 0`,
      borderTop: border,
      borderBottom: 'none',
      borderLeft: 'none',
      borderRight: 'none',
      fontSize: '0',
      lineHeight: '0',
    },

    footer: {
      padding: spacing(unit, 3),
      fontFamily: typography.bodyFont,
      fontSize: px(pxValue(typography.baseSize) * 0.8125),
      lineHeight: String(typography.lineHeight),
      color: colour.muted,
      textAlign: 'center' as const,
    },
  };
}

function buttonStyle(tokens: TokenSet) {
  const { colour, typography } = tokens;
  const paddingY = spacing(tokens.spacingUnit, 1.5);
  const paddingX = spacing(tokens.spacingUnit, 3);

  const base = {
    display: 'inline-block',
    padding: `${paddingY} ${paddingX}`,
    fontFamily: typography.bodyFont,
    fontSize: typography.baseSize,
    fontWeight: String(typography.weightBold),
    lineHeight: String(typography.lineHeight),
    borderRadius: tokens.radius,
    textDecoration: 'none',
    textAlign: 'center' as const,
    msoPaddingAlt: '0',
  };

  switch (tokens.buttonStyle) {
    case 'outline':
      return {
        ...base,
        backgroundColor: tokens.colour.background,
        color: colour.primary,
        border: `${tokens.borderWidth} solid ${colour.primary}`,
      };
    case 'soft':
      return {
        ...base,
        backgroundColor: colour.surface,
        color: colour.primary,
        border: `${tokens.borderWidth} solid ${colour.surface}`,
      };
    case 'solid':
    default:
      return {
        ...base,
        backgroundColor: colour.primary,
        color: colour.background,
        border: `${tokens.borderWidth} solid ${colour.primary}`,
      };
  }
}

export type EmailStyles = ReturnType<typeof toEmailStyles>;
