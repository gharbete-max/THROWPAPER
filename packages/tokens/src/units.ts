/**
 * Token values are CSS lengths like "16px". The email and PDF targets need arithmetic on them —
 * email clients cannot compute `calc()`, and print needs resolved sizes.
 *
 * Uses Number() on a matched numeric substring rather than the global parseFloat, which the lint
 * config bans repo-wide (CLAUDE.md rule 5). These are typographic lengths, not money or
 * measurements, so binary floating point is the right representation here.
 */
export function pxValue(length: string): number {
  const match = /^(-?\d+(?:\.\d+)?)px$/.exec(length.trim());
  if (!match?.[1]) throw new Error(`Expected a px length, got "${length}"`);
  return Number(match[1]);
}

export function px(value: number): string {
  return `${Math.round(value * 1000) / 1000}px`;
}

/** Multiples of the spacing unit, resolved to a literal length. */
export function spacing(unit: string, multiplier: number): string {
  return px(pxValue(unit) * multiplier);
}

/** Step `n` up the typographic scale from the base size. */
export function typeScale(baseSize: string, ratio: number, step: number): string {
  return px(pxValue(baseSize) * ratio ** step);
}
