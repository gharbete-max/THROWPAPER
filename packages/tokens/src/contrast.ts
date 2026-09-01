import type { TokenSet } from './types.js';

/**
 * Contrast, because a product whose selling point is "choose your own colours" is a product where
 * somebody will eventually choose two that cannot be read together.
 *
 * Catching it while they are choosing is cheap. Catching it after the form has gone out to four
 * hundred people is not, and the person who suffers is the one filling it in, not the one who
 * picked the colour.
 *
 * WCAG 2.1 relative luminance and contrast ratio, which is the same maths every checker uses.
 */

export interface ContrastFinding {
  /** Dotted path of the token at fault, e.g. `colour.muted`. */
  token: string;
  /** What it was measured against. */
  against: string;
  ratio: number;
  required: number;
  /** `text` must be readable; `boundary` only has to be discernible. */
  kind: 'text' | 'boundary';
}

/** Normal-size body text. WCAG AA. */
export const TEXT_CONTRAST = 4.5;
/** Non-text boundaries — borders, focus rings. WCAG 1.4.11. */
export const BOUNDARY_CONTRAST = 3;

export function parseHex(value: string): [number, number, number] | null {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (!match?.[1]) return null;

  const digits = match[1];
  const full =
    digits.length === 3
      ? digits
          .split('')
          .map((digit) => digit + digit)
          .join('')
      : digits;

  const number = Number.parseInt(full, 16);
  return [(number >> 16) & 255, (number >> 8) & 255, number & 255];
}

/** WCAG relative luminance. */
export function luminance(colour: string): number | null {
  const rgb = parseHex(colour);
  if (!rgb) return null;

  const [r, g, b] = rgb.map((channel) => {
    const s = channel / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];

  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Contrast ratio between two colours, 1 to 21. Order does not matter.
 *
 * Returns `null` rather than a wrong number when either colour cannot be read — a checker that
 * silently reports 21:1 for a typo is worse than one that says it does not know.
 */
export function contrastRatio(a: string, b: string): number | null {
  const first = luminance(a);
  const second = luminance(b);
  if (first === null || second === null) return null;

  const [lighter, darker] = first > second ? [first, second] : [second, first];
  return round((lighter + 0.05) / (darker + 0.05));
}

/**
 * Every combination the app actually paints, checked.
 *
 * Deliberately **not** every pair of colours in the set: `accent` against `danger` is not a
 * combination anything renders, and reporting it would train people to ignore the warnings.
 */
export function checkContrast(tokens: TokenSet): ContrastFinding[] {
  const { colour } = tokens;

  const pairs: Array<[string, string, string, ContrastFinding['kind']]> = [
    ['colour.text', colour.text, colour.background, 'text'],
    ['colour.text on surface', colour.text, colour.surface, 'text'],
    ['colour.muted', colour.muted, colour.background, 'text'],
    ['colour.muted on surface', colour.muted, colour.surface, 'text'],
    ['colour.success', colour.success, colour.background, 'text'],
    ['colour.warning', colour.warning, colour.background, 'text'],
    ['colour.danger', colour.danger, colour.background, 'text'],
    // A solid button paints the page background colour on top of the primary.
    ['colour.background on primary', colour.background, colour.primary, 'text'],
    ['colour.background on secondary', colour.background, colour.secondary, 'text'],
    ['colour.border', colour.border, colour.background, 'boundary'],
  ];

  const findings: ContrastFinding[] = [];
  for (const [token, foreground, background, kind] of pairs) {
    const ratio = contrastRatio(foreground, background);
    const required = kind === 'text' ? TEXT_CONTRAST : BOUNDARY_CONTRAST;
    // An unreadable colour is a validation problem, not a contrast one; it is reported there.
    if (ratio !== null && ratio < required) {
      findings.push({ token, against: background, ratio, required, kind });
    }
  }
  return findings;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
