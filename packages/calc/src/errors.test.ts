import { describe, expect, it } from 'vitest';
import { isCalcError, propagate } from './index.js';

describe('calc error values', () => {
  it('recognises typed errors and not ordinary strings', () => {
    expect(isCalcError('#DIV0')).toBe(true);
    expect(isCalcError('DIV0')).toBe(false);
  });

  it('propagates the first error rather than collapsing to a value', () => {
    expect(propagate(1, '#MISSING', '#UNIT')).toBe('#MISSING');
    expect(propagate(1, 2)).toBeNull();
  });
});
