import { describe, expect, it } from 'vitest';
import { buttonSurface, defaultTokens, toEmailStyles } from './index.js';

const styles = toEmailStyles(defaultTokens);
const serialised = JSON.stringify(styles);

describe('email token compiler', () => {
  it('resolves every value literally — email clients do not support custom properties', () => {
    expect(serialised).not.toContain('var(');
    expect(serialised).not.toContain('--tp-');
  });

  it('avoids layout email clients cannot render', () => {
    expect(serialised).not.toContain('"display":"flex"');
    expect(serialised).not.toContain('"display":"grid"');
    expect(serialised).not.toContain('calc(');
  });

  it('lays out with collapsed tables', () => {
    expect(styles.wrapper.borderCollapse).toBe('collapse');
    expect(styles.container.borderCollapse).toBe('collapse');
    expect(styles.container.width).toBe('600px');
  });

  it('carries the token colours through as literals', () => {
    // The shipped primary is a pastel and cannot carry a heading; the ink does. See `headingInk`.
    expect(styles.heading.color).toBe(defaultTokens.colour.text);
    expect(styles.button.backgroundColor).toBe(defaultTokens.colour.primary);
    expect(styles.text.color).toBe(defaultTokens.colour.text);
  });

  it('follows a primary colour change, when the primary can be read', () => {
    const changed = {
      ...defaultTokens,
      colour: { ...defaultTokens.colour, primary: '#1b263b' },
    };
    expect(toEmailStyles(changed).heading.color).toBe('#1b263b');
  });

  it('renders the outline button style without a filled background', () => {
    const tokens = { ...defaultTokens, buttonStyle: 'outline' as const };
    const outline = toEmailStyles(tokens);
    // The same paint the web resolves, not a second switch: see `buttonSurface`.
    expect(outline.button.backgroundColor).toBe(defaultTokens.colour.background);
    expect(outline.button.color).toBe(buttonSurface(tokens).text);
  });

  it('resolves spacing to literal multiples of the spacing unit', () => {
    // spacingUnit is 8px, and the card pads by 3 units.
    expect(styles.card.padding).toBe('24px');
  });
});
