import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  THEME_PRESETS,
  TEXT_CONTRAST,
  contrastRatio,
  defaultTokens,
  mix,
  toCssVariables,
  toDark,
  type TokenSet,
} from '@tp/tokens';

const STYLES = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

/** Every palette the product ships, light and derived dark. */
const SHIPPED: Array<[string, TokenSet]> = [
  ['default', defaultTokens],
  ...THEME_PRESETS.map((preset): [string, TokenSet] => [preset.id, preset.tokens]),
];
const PALETTES: Array<[string, TokenSet['colour']]> = SHIPPED.flatMap(([name, tokens]) => [
  [`${name} light`, tokens.colour],
  [`${name} dark`, toDark(tokens).colour],
]);

/**
 * The testimonial band, which was the least readable section on the page.
 *
 * It painted paper on the brand's primary — 2.12:1 under the shipped seafoam, with an eyebrow at
 * 1.08 — under a comment asserting the accent "has the contrast". The fix is the page turned over:
 * ink ground, paper text, and the accent pulled toward the band's own text. This holds that in
 * place for every shipped palette in both schemes, and pins the stylesheet to the same arithmetic
 * the test does, so the two cannot drift apart.
 */
describe('the testimonial band', () => {
  const band = STYLES.slice(STYLES.indexOf('.site__band {'), STYLES.indexOf('.quote {'));

  it('is the page inverted, not the brand', () => {
    expect(band).toMatch(/\.site__band \{[^}]*background: var\(--tp-colour-text\);/);
    expect(band).toMatch(/\.site__band \{[^}]*color: var\(--tp-colour-background\);/);
    expect(band).toContain('color: var(--tp-colour-accent-on-ink);');
  });

  it.each(PALETTES)('reads on every palette: %s', (_name, colour) => {
    const ground = colour.text;
    expect(contrastRatio(colour.background, ground) ?? 0).toBeGreaterThanOrEqual(TEXT_CONTRAST);
    const eyebrow = toCssVariables({ ...defaultTokens, colour })['--tp-colour-accent-on-ink']!;
    expect(contrastRatio(eyebrow, ground) ?? 0, 'eyebrow').toBeGreaterThanOrEqual(TEXT_CONTRAST);
    // The same mix the stylesheet declares for the figcaption: 72% of the band's text colour.
    const figcaption = mix(colour.background, colour.text, 0.72);
    expect(contrastRatio(figcaption, ground) ?? 0, 'figcaption').toBeGreaterThanOrEqual(
      TEXT_CONTRAST,
    );
  });
});

/**
 * The language switcher is rendered twice and exactly one copy is shown at any width.
 *
 * The rule that hides the footer copy has to come *before* the media query that shows it, or —
 * at equal specificity — the later rule wins and a phone gets no switcher at all. That is the bug
 * the first draft of this had, so it is the order this test holds.
 */
describe('the language switcher', () => {
  it('hides the footer copy by default and shows it only on narrow screens', () => {
    const hidden = STYLES.indexOf('.site__langs--foot {\n  display: none;');
    const narrow = STYLES.indexOf('@media (max-width: 60rem)');
    const shown = STYLES.indexOf('.site__langs--foot {\n    display: flex;');
    const barHidden = STYLES.indexOf('.site__langs--bar {\n    display: none;');
    expect(hidden).toBeGreaterThan(-1);
    expect(hidden).toBeLessThan(narrow);
    expect(shown).toBeGreaterThan(narrow);
    expect(barHidden).toBeGreaterThan(narrow);
  });
});
