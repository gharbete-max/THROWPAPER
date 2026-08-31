import defaults from './default-tokens.json' with { type: 'json' };
import type { TokenSet } from './types.js';

export type { TokenSet, ColourTokens, TypographyTokens } from './types.js';
export { toCssVariables, toCssBlock } from './compile-web.js';

export const defaultTokens = defaults as TokenSet;
