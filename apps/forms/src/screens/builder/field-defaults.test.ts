import { describe, expect, it } from 'vitest';
import { FIELD_TYPES } from '@tp/shared/forms';
import { PALETTE_GROUPS } from './field-defaults.js';

describe('the palette', () => {
  /**
   * A field type that exists but is not in any group is invisible: nobody can add it, and nothing
   * else would notice. This is the check that makes adding a type force a decision about where it
   * belongs.
   */
  it('offers every field type exactly once', () => {
    const inPalette = PALETTE_GROUPS.flatMap((group) => group.types);
    expect([...inPalette].sort()).toEqual([...FIELD_TYPES].sort());
    expect(new Set(inPalette).size).toBe(inPalette.length);
  });

  it('keeps every group small enough to scan', () => {
    for (const group of PALETTE_GROUPS) {
      expect(group.types.length, group.id).toBeLessThanOrEqual(6);
      expect(group.types.length, group.id).toBeGreaterThan(0);
    }
  });
});
