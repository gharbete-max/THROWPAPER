import { describe, expect, it } from 'vitest';
import { toCssVariables } from './compile-web.js';
import { defaultTokens } from './index.js';

/**
 * The ramp has to cover the sizes the product actually uses.
 *
 * It did not. `scaleRatio` is 1.25, which puts a clean jump between 12.8 and 16 — fine for display
 * type and wrong for interface chrome, which lives inside that gap. The stylesheet solved it by
 * hand: 21 of its 33 hand-written font sizes sat between 12 and 15px, spread over four values that
 * no rule could reproduce and that a brand changing the ratio could not move.
 *
 * `ui` is that gap, derived as a half step rather than nailed to 14px, so it stays a function of
 * the brand rather than a constant that happens to suit the shipped one.
 */
describe('the type ramp', () => {
  const vars = toCssVariables(defaultTokens);

  it('offers a step between sm and base', () => {
    const size = (name: string) => Number.parseFloat(vars[name]!);
    expect(size('--tp-text-ui')).toBeGreaterThan(size('--tp-text-sm'));
    expect(size('--tp-text-ui')).toBeLessThan(size('--tp-text-base'));
  });

  it('derives that step from the ratio rather than fixing it at 14px', () => {
    /**
     * Widening the ratio opens the gap downward — base holds still and `sm` drops away from it —
     * so the step that fills the gap drops too, from 14.31 to 13.06. It stays halfway between the
     * two in ratio terms, which is the property worth having: a brand that wants dramatic headings
     * gets interface text that keeps its proportion to them rather than a constant 14px.
     */
    const wider = toCssVariables({
      ...defaultTokens,
      typography: { ...defaultTokens.typography, scaleRatio: 1.5 },
    });
    const step = (set: Record<string, string>, name: string) => Number.parseFloat(set[name]!);

    expect(step(wider, '--tp-text-ui')).toBeLessThan(step(vars, '--tp-text-ui'));
    // Still in the gap, not collapsed onto either edge of it.
    expect(step(wider, '--tp-text-ui')).toBeGreaterThan(step(wider, '--tp-text-sm'));
    expect(step(wider, '--tp-text-ui')).toBeLessThan(step(wider, '--tp-text-base'));
  });

  it('follows the base size', () => {
    const bigger = toCssVariables({
      ...defaultTokens,
      typography: { ...defaultTokens.typography, baseSize: '20px' },
    });
    expect(Number.parseFloat(bigger['--tp-text-ui']!)).toBeGreaterThan(
      Number.parseFloat(vars['--tp-text-ui']!),
    );
  });
});
