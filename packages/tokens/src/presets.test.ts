import { describe, expect, it } from 'vitest';
import { THEME_PRESETS } from './presets.js';
import { checkContrast } from './contrast.js';
import { toCssBlock } from './compile-web.js';

/**
 * A shipped theme is a promise that somebody can read the form.
 *
 * Checking a preset by eye works until the fourth one, and then it works right up until the first
 * person who cannot read it. The contrast maths already exists for the colours a customer picks;
 * running it over our own is the cheapest possible way to keep the promise.
 */
const describeFindings = (findings: ReturnType<typeof checkContrast>) =>
  findings
    .map((finding) => `${finding.token} on ${finding.against} is ${finding.ratio.toFixed(2)}:1`)
    .join('; ');

describe('every theme we ship', () => {
  it.each(THEME_PRESETS.map((theme) => theme.id))('has readable text: %s', (id) => {
    const theme = THEME_PRESETS.find((candidate) => candidate.id === id)!;
    const text = checkContrast(theme.tokens).filter((finding) => finding.kind === 'text');
    expect(text, describeFindings(text)).toEqual([]);
  });

  /**
   * The new themes clear the boundary bar too — `default` is the one exception.
   *
   * `contrast.test.ts` records the deliberate decision that the shipped default keeps a pale
   * border at 1.36:1 against white, because reaching 3:1 means a heavy grey around every input and
   * the stated visual direction for this product is flat and quiet. That decision is about the
   * *default*; a theme somebody actively chooses has no such history, so these are held to the
   * full WCAG 1.4.11 bar and every one of them meets it.
   */
  it.each(THEME_PRESETS.filter((theme) => theme.id !== 'default').map((theme) => theme.id))(
    'has discernible boundaries: %s',
    (id) => {
      const theme = THEME_PRESETS.find((candidate) => candidate.id === id)!;
      const findings = checkContrast(theme.tokens);
      expect(findings, describeFindings(findings)).toEqual([]);
    },
  );

  it('compiles to CSS with no leftover variable references', () => {
    for (const theme of THEME_PRESETS) {
      const css = toCssBlock(theme.tokens);
      // A `var(` in the output means a token resolved to another token rather than to a value —
      // which the email and PDF targets cannot follow.
      expect(css.includes('var('), theme.id).toBe(false);
      expect(css).toContain(theme.tokens.colour.primary);
    }
  });

  it('carries no logo, because a logo belongs to the organisation and not to a theme', () => {
    for (const theme of THEME_PRESETS) {
      expect(theme.tokens.logoLight, theme.id).toBeNull();
      expect(theme.tokens.favicon, theme.id).toBeNull();
    }
  });

  it('has unique ids', () => {
    const ids = THEME_PRESETS.map((theme) => theme.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
