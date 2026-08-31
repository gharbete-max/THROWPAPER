import { describe, expect, it } from 'vitest';
import { defaultTokens, toEmailStyles } from './index.js';

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
    expect(styles.heading.color).toBe(defaultTokens.colour.primary);
    expect(styles.button.backgroundColor).toBe(defaultTokens.colour.primary);
    expect(styles.text.color).toBe(defaultTokens.colour.text);
  });

  it('follows a primary colour change', () => {
    const changed = {
      ...defaultTokens,
      colour: { ...defaultTokens.colour, primary: '#ff0000' },
    };
    expect(toEmailStyles(changed).heading.color).toBe('#ff0000');
  });

  it('renders the outline button style without a filled background', () => {
    const outline = toEmailStyles({ ...defaultTokens, buttonStyle: 'outline' });
    expect(outline.button.backgroundColor).toBe(defaultTokens.colour.background);
    expect(outline.button.color).toBe(defaultTokens.colour.primary);
  });

  it('resolves spacing to literal multiples of the spacing unit', () => {
    // spacingUnit is 8px, and the card pads by 3 units.
    expect(styles.card.padding).toBe('24px');
  });
});
