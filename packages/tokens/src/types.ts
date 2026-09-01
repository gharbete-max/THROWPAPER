/**
 * Tokens are plain JSON, never CSS — SPEC-shared.md §packages/tokens.
 * One source, four compilers: web (CSS vars), email (inline styles), pdf (print CSS), native.
 * Only the web compiler exists in phase 0; the other three are phase 1 and are the riskiest bet
 * in the product (START-HERE.md phase 1).
 */
export interface ColourTokens {
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  surface: string;
  text: string;
  muted: string;
  border: string;
  success: string;
  warning: string;
  danger: string;
}

export interface TypographyTokens {
  headingFont: string;
  bodyFont: string;
  baseSize: string;
  scaleRatio: number;
  lineHeight: number;
  weightRegular: number;
  weightBold: number;
  /** How a question's label is set. Its own controls, because it is the text people read most. */
  labelWeight: number;
  labelStyle: 'normal' | 'italic';
  labelDecoration: 'none' | 'underline';
}

export interface TokenSet {
  colour: ColourTokens;
  typography: TypographyTokens;
  spacingUnit: string;
  radius: string;
  borderWidth: string;
  /** Height of a button or input. The single control that makes a form feel dense or roomy. */
  controlHeight: string;
  /** How wide a form is allowed to get before it stops growing. */
  contentWidth: string;
  shadowLevel: 0 | 1 | 2 | 3;
  buttonStyle: 'solid' | 'outline' | 'soft';
  logoLight: string | null;
  logoDark: string | null;
  favicon: string | null;
}
