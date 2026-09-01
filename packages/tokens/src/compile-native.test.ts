import { describe, expect, it } from 'vitest';
import { defaultTokens, toNativeTokens } from './index.js';

const native = toNativeTokens(defaultTokens);

describe('native token compiler', () => {
  it('emits unitless numbers — a StyleSheet cannot take "16px"', () => {
    const numbers = [
      native.radius,
      native.borderWidth,
      ...Object.values(native.spacing),
      ...Object.values(native.typography.size),
      native.typography.lineHeight,
    ];
    for (const value of numbers) {
      expect(typeof value).toBe('number');
      expect(Number.isFinite(value)).toBe(true);
    }
    expect(JSON.stringify(native)).not.toContain('px');
  });

  it('passes colours through unchanged', () => {
    expect(native.colour.primary).toBe(defaultTokens.colour.primary);
    expect(JSON.stringify(native)).not.toContain('var(');
  });

  it('takes one font family, not the whole fallback stack', () => {
    // Passing "Inter, system-ui, sans-serif" to React Native renders the system default and looks
    // like nothing is wrong.
    expect(native.typography.bodyFamily).toBe('Inter');
    expect(native.typography.bodyFamily).not.toContain(',');
  });

  it('gives weights as strings, which is what React Native expects', () => {
    expect(native.typography.weightRegular).toBe('400');
    expect(native.typography.weightBold).toBe('600');
  });

  it('follows a primary colour change, like every other target', () => {
    const changed = { ...defaultTokens, colour: { ...defaultTokens.colour, primary: '#ff0000' } };
    expect(toNativeTokens(changed).colour.primary).toBe('#ff0000');
  });

  it('scales type from the same ratio the other targets use', () => {
    expect(native.typography.size.base).toBe(16);
    expect(native.typography.size.lg).toBe(20);
  });
});
