import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The hero animation costs 1,120 KB, and the rule is that no phone pays it.
 *
 * This is a regression test for a defect that shipped and survived a design critique: the 2x
 * variant was gated to desktop widths and the animation itself was not, so every phone without a
 * reduced-motion preference downloaded half a megabyte of WebP for a decoration 256 CSS px wide.
 * The expensive file was the cheap-sounding one, which is why reading the markup did not catch it.
 *
 * Asserted against the source text rather than a render, which is how `site-chrome.test.ts` checks
 * the stylesheet: the property is about what the markup *says*, and a `<source>` whose media query
 * does not match is never fetched — so the query is the whole mechanism.
 */
const SITE = readFileSync(new URL('./Site.tsx', import.meta.url), 'utf8');
const STYLES = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

/** The breakpoint below which the hero does not move. One number, asserted in both files. */
const BREAKPOINT = 700;

/** Every `<source>` element in the site, as text. */
const sources = SITE.match(/<source\b[^>]*\/>/gs) ?? [];

/** …and the ones that would fetch an animation. */
const animated = sources.filter((source) => /mark-loop-\d+\.webp/.test(source));

describe('the hero animation', () => {
  it('is served by at least one source, so this test cannot pass by finding nothing', () => {
    expect(animated.length).toBeGreaterThan(0);
  });

  /**
   * The invariant. Not "the second source has a gate" — *every* source that fetches an animation
   * has one, so adding a third cannot reintroduce the defect by omission.
   */
  it.each(animated.map((source, index) => [index, source] as const))(
    'source %i reaches no phone: it carries a min-width gate',
    (_index, source) => {
      const gate = /min-width:\s*(\d+)px/.exec(source);
      expect(gate, `no min-width in: ${source}`).not.toBeNull();
      expect(Number(gate?.[1])).toBeGreaterThanOrEqual(BREAKPOINT);
    },
  );

  /** Reduced motion was already honoured and must stay honoured: it is the other way out. */
  it.each(animated.map((source, index) => [index, source] as const))(
    'source %i still honours a reduced-motion preference',
    (_index, source) => {
      expect(source).toContain('prefers-reduced-motion: no-preference');
    },
  );

  /**
   * The poster is the fallback a phone actually gets, so it must not be an animation itself.
   */
  it('falls back to a still image, not another loop', () => {
    const img = /<img[^>]*className="hero__mark"[^>]*\/>/s.exec(SITE)?.[0];
    expect(img).toBeDefined();
    expect(img).toContain('mark-poster');
    expect(img).not.toContain('mark-loop');
  });
});

describe('the pause control', () => {
  /**
   * WCAG 2.2.2 asks for a way to stop motion, not for a button that stops nothing. Below the
   * breakpoint the hero is a still, so a pause control there is a promise the page does not keep.
   *
   * The stylesheet uses `not all and (min-width: …)` rather than a `max-width` one pixel below, so
   * the two rules are written from the same number and cannot disagree at a fractional width.
   */
  it('is hidden below the same breakpoint the animation starts at', () => {
    const rule = new RegExp(
      `@media not all and \\(min-width:\\s*${BREAKPOINT}px\\)\\s*\\{[^}]*\\.hero__pause`,
      's',
    );
    expect(STYLES).toMatch(rule);
  });

  it('is still hidden under a reduced-motion preference', () => {
    expect(STYLES).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*\{[^}]*\.hero__pause[^}]*display:\s*none/s,
    );
  });
});
