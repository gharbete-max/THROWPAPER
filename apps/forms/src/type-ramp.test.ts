import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Font sizes come from the ramp, not from whatever looked right that afternoon.
 *
 * `CLAUDE.md` rule 4 has said so since phase 0, and the stylesheet had drifted to 33 hand-written
 * sizes against 26 tokenised ones. Nothing caught it because the rule lived in prose: a size typed
 * as `0.9375rem` is indistinguishable from a considered decision until somebody counts them and
 * finds four different values doing one job.
 *
 * The cost was not tidiness. A brand raising `scaleRatio` in the Brand Kit moved the headings and
 * left every one of those 33 declarations behind, which is the ratio control silently doing half
 * its job.
 */
const CSS = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

/** Anything that is not a token, a `clamp()` or the iOS `max()` guard. */
const HAND_WRITTEN = /font-size: (?!var|max|clamp)([^;]+);/g;

describe('font sizes', () => {
  it('come from the ramp', () => {
    const literals = [...CSS.matchAll(HAND_WRITTEN)].map((match) => match[1]);

    /**
     * The two exceptions, and why they are exceptions.
     *
     * Both are a glyph centred in a circle of fixed pixel size — 22px inside 48, 20px inside 44.
     * They are sized to the circle, not to a line of text, so putting them on the reading ramp
     * would let a brand raising the ratio push the glyph past the edge of its own background.
     */
    expect(literals.sort()).toEqual(['20px', '22px']);
  });

  it('has a step for interface text', () => {
    // The gap between sm and base is where rows, labels, badges and help text live.
    expect(CSS).toContain('var(--tp-text-ui)');
  });
});
