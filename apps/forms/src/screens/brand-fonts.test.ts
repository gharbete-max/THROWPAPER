import { describe, expect, it } from 'vitest';
import { brand } from '@tp/shared';
import { defaultTokens } from '@tp/tokens';
import { FONT_STACKS } from './BrandKit.js';

/**
 * Every font the editor offers must be one the API will store.
 *
 * It was not. `FontStack` in `packages/shared` refuses quotes — the stack is interpolated into an
 * inline `style` attribute in email, where a quote ends the attribute early — and four of the six
 * stacks in the editor were quoted. Choosing Georgia, Segoe UI, Helvetica Neue or the monospace
 * stack produced a 400 from a dropdown that offered it.
 *
 * Nothing failed: the schema was right, the editor was right on its own terms, and no test held
 * the two lists against each other. This is that test.
 */
describe('the fonts the brand editor offers', () => {
  it.each(FONT_STACKS)('is one the API will accept: %s', (stack) => {
    const result = brand.BrandKit.safeParse({
      ...defaultTokens,
      typography: { ...defaultTokens.typography, headingFont: stack, bodyFont: stack },
    });
    expect(result.success, result.success ? '' : result.error.issues[0]?.message).toBe(true);
  });

  it('accepts the stack the product itself ships with', () => {
    expect(brand.BrandKit.safeParse(defaultTokens).success).toBe(true);
  });

  it('still refuses a quoted stack, because email is why the rule exists', () => {
    // Guarding the guard: if the refinement were ever relaxed, the test above would pass for the
    // wrong reason and the email bug would come back silently.
    const quoted = 'Georgia, "Times New Roman", serif';
    const result = brand.BrandKit.safeParse({
      ...defaultTokens,
      typography: { ...defaultTokens.typography, headingFont: quoted, bodyFont: quoted },
    });
    expect(result.success).toBe(false);
  });
});
