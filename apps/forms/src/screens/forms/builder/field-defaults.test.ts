import { describe, expect, it } from 'vitest';
import { FIELD_TYPES } from '@tp/shared/forms';
import { PALETTE_GROUPS, uniqueKey } from './field-defaults.js';

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

describe('unique keys', () => {
  /**
   * Two fields sharing a key silently merge their answers into one column, and nobody finds that
   * until the export — so this is worth pinning rather than eyeballing.
   */
  it('leaves a free key alone', () => {
    expect(uniqueKey('email', [])).toBe('email');
    expect(uniqueKey('email', ['full_name'])).toBe('email');
  });

  it('numbers a collision', () => {
    expect(uniqueKey('email', ['email'])).toBe('email_2');
    expect(uniqueKey('email', ['email', 'email_2'])).toBe('email_3');
  });

  it('counts on from an already-numbered key rather than stacking suffixes', () => {
    // Duplicating a copy should give email_3, not email_2_2.
    expect(uniqueKey('email_2', ['email', 'email_2'])).toBe('email_3');
    expect(uniqueKey('email_3', ['email', 'email_2', 'email_3'])).toBe('email_4');
  });
});
