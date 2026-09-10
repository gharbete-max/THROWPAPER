import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { shouldPlayIntro } from './motion.js';

/**
 * Motion has one hard rule, and it is worth a test rather than a comment.
 *
 * `prefers-reduced-motion` is not a taste setting. For somebody with a vestibular disorder a page
 * that zooms, pans and slides can cause real nausea — and this product's public surface is filled
 * in by members of the public who never chose to be here. An animation added without the switch
 * is an accessibility regression that nothing else would catch.
 */
const STYLES = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

describe('the reduced-motion switch', () => {
  it('turns off every animation and transition, not a hand-listed few', () => {
    const block = /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/g;
    const blocks = [...STYLES.matchAll(block)].map((match) => match[1]!);
    expect(blocks.length).toBeGreaterThan(0);

    // The universal selector is what makes this hold for animations nobody has written yet.
    const universal = blocks.join('\n');
    expect(universal).toContain('*');
    expect(universal).toMatch(/animation-duration:\s*0\.001ms\s*!important/);
    expect(universal).toMatch(/transition-duration:\s*0\.001ms\s*!important/);
  });

  it('leaves revealed content visible rather than stuck at zero opacity', () => {
    // The failure this prevents is the worst kind: a page that is simply blank for one reader.
    const reduced = STYLES.slice(STYLES.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduced).toMatch(/\.reveal\s*\{[^}]*opacity:\s*1/);
  });
});

/**
 * The interface moves the way the mark moves, and nothing else.
 *
 * The brand ships exactly two curves — `unfurl` for paper opening out, `chomp` for a pocket closing
 * and opening again — and they are the easings the fortune teller's own animation is built from.
 * An interface that reaches for a fourth curve is not obviously wrong on any one screen; it is
 * wrong across the product, which is precisely the kind of drift a comment does not survive.
 *
 * So the rule is mechanical: a stylesheet that writes its own `cubic-bezier` has invented a motion
 * the product does not have. There were three — the Material standard curve twice and an ad-hoc
 * overshoot on `.reveal` — and they are now the tokens.
 */
describe('the easing vocabulary', () => {
  it('writes no curve of its own', () => {
    // Comments may discuss a curve; rules may not declare one.
    const declarations = STYLES.split('\n').filter(
      (line) => line.includes('cubic-bezier') && !line.trimStart().startsWith('*'),
    );
    expect(declarations).toEqual([]);
  });

  it('animates the mark with the brand curves rather than the neutral one', () => {
    // `mark-work` is the chomp: it is the pocket, so it takes the pocket's easing.
    for (const match of STYLES.matchAll(/animation:\s*mark-work[^;]*;/g)) {
      expect(match[0]).toContain('--tp-ease-chomp');
    }
    expect(STYLES).toContain('--tp-ease-unfurl');
  });
});

describe('deciding whether the intro plays', () => {
  const withStorage = (getItem: () => string | null) => {
    // A stand-in for `window`, so this stays a plain function test like everything else here.
    (globalThis as unknown as { window: unknown }).window = {
      localStorage: { getItem, setItem: () => undefined },
    };
  };

  it('never plays when motion is unwelcome', () => {
    withStorage(() => null);
    expect(shouldPlayIntro(true)).toBe(false);
  });

  it('plays once, then never again', () => {
    withStorage(() => null);
    expect(shouldPlayIntro(false)).toBe(true);
    withStorage(() => '1');
    expect(shouldPlayIntro(false)).toBe(false);
  });

  /**
   * A private window refuses storage. Playing anyway would replay the intro on *every* load, which
   * is the exact opposite of the charm it is there for — so a refusal means "already seen".
   */
  it('does not play when storage refuses, rather than replaying forever', () => {
    withStorage(() => {
      throw new Error('storage disabled');
    });
    expect(shouldPlayIntro(false)).toBe(false);
  });
});
