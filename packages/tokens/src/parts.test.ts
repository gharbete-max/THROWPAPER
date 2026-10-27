import { describe, expect, it } from 'vitest';
import { TEXT_CONTRAST, contrastRatio } from './contrast.js';
import { PARTS, PART_HUES, partCssVariables } from './parts.js';

describe('the four parts’ colours', () => {
  it.each(PARTS)('%s: its ink reads on its fill', (part) => {
    const { fill, ink } = PART_HUES[part];
    expect(contrastRatio(ink, fill) ?? 0).toBeGreaterThanOrEqual(TEXT_CONTRAST);
  });

  it('are four different colours', () => {
    expect(new Set(PARTS.map((part) => PART_HUES[part].fill)).size).toBe(4);
  });

  it('become eight custom properties', () => {
    const variables = partCssVariables();
    expect(Object.keys(variables)).toHaveLength(8);
    expect(variables['--tp-part-sign']).toBe(PART_HUES.sign.fill);
    expect(variables['--tp-part-sign-ink']).toBe(PART_HUES.sign.ink);
  });
});
