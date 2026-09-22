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

  /**
   * Both brand curves are in use, named rather than counted.
   *
   * This asserted that every `mark-work` animation took the chomp — which was true, and became
   * vacuous the moment the mark stopped being eight CSS triangles: a loop over no matches passes.
   * A test that cannot fail is worse than no test, because it reads like cover.
   *
   * So it checks the two curves are actually reached for. `unfurl` is the button's press fold and
   * the scroll reveal; `chomp` is what is left for a press or a pocket closing.
   */
  it('uses both brand curves', () => {
    expect(STYLES).toContain('var(--tp-ease-unfurl)');
    expect(STYLES).toContain('var(--tp-ease-chomp)');
  });
});

/**
 * The hero animation is withheld, not hidden.
 *
 * The landing page is server-rendered and `main.tsx` never hydrates it, so there is no effect to
 * remove a motion layer on this surface — reduced motion has to be honoured by the markup itself.
 * A `<source>` whose media query does not match is never fetched, so the query is what makes the
 * 673 KB animation genuinely absent for somebody who asked for less motion.
 *
 * The failure being prevented is the plausible one: hiding the animation with CSS instead. That
 * looks identical in a screenshot, still downloads the file, and still spends the battery decoding
 * it — the reader asked for less motion and paid for all of it anyway.
 */
describe('the hero mark', () => {
  const SITE = readFileSync(new URL('../site/Site.tsx', import.meta.url), 'utf8');

  it('fetches the animation only when motion is welcome', () => {
    // Real tags only: the prose above the markup mentions `<source>` too.
    const sources = [...SITE.matchAll(/<source\s[^>]*\/>/g)].map((match) => match[0]);
    expect(sources.length, 'the hero has no <source> to gate').toBeGreaterThan(0);

    // Every one of them, not just the first: an ungated fallback source defeats the whole gate.
    for (const source of sources) {
      expect(source).toContain('(prefers-reduced-motion: no-preference)');
      expect(source).toContain('.webp');
    }
  });

  /**
   * A 2x animation, if one is offered, is a desktop offer and not a density offer.
   *
   * `2x` alone would send a megabyte to any retina phone — most of them — on the connection least
   * able to take it, to sharpen a mark that is *smaller* there than on desktop. There is no 2x
   * source today (the gold render ships at 256 only); this holds the gate for the day it returns,
   * and cannot pass by finding nothing because the first test above already requires a source.
   */
  it('keeps any retina variant off phones', () => {
    for (const source of SITE.match(/<source\b[^>]*\b2x\b[\s\S]*?\/>/g) ?? []) {
      const gate = Number(/min-width:\s*(\d+)px/.exec(source)?.[1]);
      expect(gate, source).toBeGreaterThanOrEqual(900);
    }
  });

  it('falls back to the poster, which is the animation frozen at frame 0', () => {
    // Not a different drawing: a cross-fade between them would invent a transition to cover.
    expect(SITE).toContain('/mark-poster-256.png');
  });

  it('reserves the figure so the largest thing on the page cannot shift it', () => {
    const img = /<img\b[\s\S]*?hero__mark[\s\S]*?\/>/.exec(SITE)?.[0];
    expect(img).toBeDefined();
    expect(img).toMatch(/width=\{?256/);
    expect(img).toMatch(/height=\{?256/);
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
