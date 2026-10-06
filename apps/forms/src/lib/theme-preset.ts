import { THEME_PRESETS, type ThemePreset, type TokenSet } from '@tp/tokens';

/**
 * A ready-made look applied over the organisation's kit: every token replaced, except the logo and
 * favicon, which belong to the organisation rather than to a theme. Merging instead would leave a
 * warm palette with one cold border in it and no way to tell where that border came from.
 *
 * One function for the Brand screen's gallery and the guided builder's colour question (owner
 * question 8), so the two cannot apply the same preset differently.
 */
export function withPreset(theme: ThemePreset, current: TokenSet): TokenSet {
  return {
    ...theme.tokens,
    logoLight: current.logoLight,
    logoDark: current.logoDark,
    favicon: current.favicon,
  };
}

/** A preset by its id, or undefined. */
export const presetById = (id: string): ThemePreset | undefined =>
  THEME_PRESETS.find((theme) => theme.id === id);
