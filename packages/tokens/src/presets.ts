import defaults from './default-tokens.json' with { type: 'json' };
import type { TokenSet } from './types.js';

/**
 * Ready-made looks.
 *
 * An empty brand editor is the wrong place to start. Eleven colour pickers, three sliders and a
 * font stack is a design brief, not a setting, and the honest outcome is that most people change
 * the primary colour and leave the rest — so the form ends up looking like the default with one
 * odd blue in it. A preset is a whole coherent look you can then adjust.
 *
 * ## The rules these follow
 *
 * **Flat.** No gradients anywhere, which is the stated direction and also the one treatment that
 * cannot be recomputed for a customer's palette.
 *
 * **Legible by construction.** `presets.test.ts` runs the WCAG contrast check over every preset,
 * so a theme that ships is a theme somebody can read. That is a promise worth keeping in code:
 * "we checked it by eye once" does not survive the fourth preset.
 *
 * **Complete.** Each carries a full token set, so applying one never leaves a value from the
 * previous theme behind — which is how you get a warm palette with one cold border in it.
 */
export interface ThemePreset {
  /** Stable id. Also the message key: `theme.<id>` names it in the editor. */
  id: string;
  tokens: TokenSet;
}

const base = defaults as TokenSet;

/** Everything except the colours and the few shape values each preset overrides. */
function preset(
  id: string,
  colour: TokenSet['colour'],
  over: Partial<Omit<TokenSet, 'colour'>> = {},
): ThemePreset {
  return {
    id,
    tokens: {
      ...base,
      ...over,
      colour,
      typography: { ...base.typography, ...(over.typography ?? {}) },
      // A logo belongs to the organisation, not to the theme, so a preset never carries one.
      logoLight: null,
      logoDark: null,
      favicon: null,
    },
  };
}

export const THEME_PRESETS: ThemePreset[] = [
  // The shipped look, named so it can be chosen again after trying another.
  preset('default', base.colour),

  /**
   * Midnight, saddle, cognac, parchment and gold — the palette this product was sketched in.
   * Warm neutrals against a deep navy, with no pure white anywhere.
   */
  preset(
    'midnight',
    {
      primary: '#1b263b',
      secondary: '#415a77',
      accent: '#a8763e',
      background: '#f6f2e9',
      surface: '#ece5d8',
      text: '#1b1b1b',
      muted: '#5a5348',
      border: '#938b7c',
      success: '#3a6b45',
      warning: '#8a6100',
      danger: '#9b2c2c',
    },
    { radius: '4px', shadowLevel: 0, buttonStyle: 'solid' },
  ),

  /** Ink on paper: one colour, hard edges, no shadow. For forms that should look like documents. */
  preset(
    'minimal',
    {
      primary: '#111111',
      secondary: '#3d3d3d',
      accent: '#111111',
      background: '#ffffff',
      surface: '#f4f4f4',
      text: '#111111',
      muted: '#5c5c5c',
      border: '#949494',
      success: '#1f6b3a',
      warning: '#8a5a00',
      danger: '#a32020',
    },
    { radius: '0px', shadowLevel: 0, buttonStyle: 'outline' },
  ),

  /** Rounded and green, with soft buttons. The friendliest of the five. */
  preset(
    'garden',
    {
      primary: '#2f6b4f',
      secondary: '#448261',
      accent: '#b4622a',
      background: '#ffffff',
      surface: '#eef4ef',
      text: '#17251d',
      muted: '#556b5e',
      border: '#8d9791',
      success: '#2f6b4f',
      warning: '#8a6100',
      danger: '#a32c26',
    },
    { radius: '14px', shadowLevel: 2, buttonStyle: 'soft' },
  ),

  /** High contrast and heavy type, for a form that has to be read across a room. */
  preset(
    'bold',
    {
      primary: '#5a189a',
      secondary: '#7b2cbf',
      accent: '#c1121f',
      background: '#ffffff',
      surface: '#f3edf9',
      text: '#12101a',
      muted: '#544d63',
      border: '#9a91a6',
      success: '#1f6b45',
      warning: '#8a5a00',
      danger: '#c1121f',
    },
    {
      radius: '10px',
      shadowLevel: 3,
      buttonStyle: 'solid',
      typography: { ...base.typography, weightBold: 700, labelWeight: 600 },
    },
  ),
];

export const THEME_PRESET_IDS = THEME_PRESETS.map((theme) => theme.id);
