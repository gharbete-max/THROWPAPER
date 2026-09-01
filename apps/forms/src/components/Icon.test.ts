import { describe, expect, it } from 'vitest';
import { FIELD_TYPES } from '@tp/shared/forms';
import { ICON_NAMES } from './Icon.js';

describe('the icon set', () => {
  /**
   * Same guard as the message catalogue: a field type without an icon renders nothing at all in
   * the palette, and nothing else notices. Driven by the schema so adding a type forces the
   * decision rather than leaving a hole somebody finds on screen.
   */
  it('has an icon for every field type', () => {
    const missing = FIELD_TYPES.filter((type) => !ICON_NAMES.includes(type));
    expect(missing).toEqual([]);
  });

  it('defines no duplicate names', () => {
    expect(new Set(ICON_NAMES).size).toBe(ICON_NAMES.length);
  });
});
