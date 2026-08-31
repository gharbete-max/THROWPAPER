import { describe, expect, it } from 'vitest';
import { defaultTokens, toCssBlock, toCssVariables } from './index.js';

describe('web token compiler', () => {
  it('emits a custom property for every colour token', () => {
    const vars = toCssVariables(defaultTokens);
    for (const key of Object.keys(defaultTokens.colour)) {
      expect(vars).toHaveProperty(`--tp-colour-${key}`);
    }
  });

  it('changing the primary colour changes the compiled output', () => {
    const changed = { ...defaultTokens, colour: { ...defaultTokens.colour, primary: '#ff0000' } };
    expect(toCssBlock(changed)).toContain('--tp-colour-primary: #ff0000;');
    expect(toCssBlock(changed)).not.toBe(toCssBlock(defaultTokens));
  });
});
