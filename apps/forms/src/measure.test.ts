import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * How wide a line of text is allowed to get.
 *
 * `.shell` capped the column at 52rem — a reading measure — until the layout overhaul deleted it
 * along with the padding and the auto margins, on the grounds that the grid owned all three. The
 * grid owns the *frame*. It does not own the measure, and nothing else did either: every document
 * screen ran to 1137px of prose at a laptop width, which is roughly twice a readable line, and
 * nothing failed because no test knew a measure existed.
 *
 * Restoring it as a plain `max-inline-size` then broke the other direction, which is the part worth
 * pinning: `.shell` is declared at the end of the stylesheet and `--roomy` and `--wide` are
 * declared earlier, so at equal specificity the base rule won and the lists came out at the reading
 * measure too. A custom property is immune to that, because the variant sets it on the same element
 * rather than competing with it.
 */
const CSS = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

describe('the reading measure', () => {
  it('caps the content column', () => {
    expect(CSS).toContain('max-inline-size: var(--tp-measure, 52rem)');
  });

  it.each([
    ['--tp-measure: 68rem', '.shell--roomy', 'lists of cards'],
    ['--tp-measure: 76rem', '.shell--wide', 'the builder and the response grid'],
    ['--tp-measure: var(--tp-content-width)', '.shell--narrow', 'a public form'],
  ])('lets %s widen it for %s (%s)', (declaration) => {
    expect(CSS).toContain(declaration);
  });

  /**
   * The variants must not go back to competing on `max-width`.
   *
   * That is the form the bug took: same specificity as the base rule, decided by which happened to
   * be written last, and invisible until somebody looked at a list screen and a document screen in
   * the same session.
   */
  it('sets the variants through the variable, not by out-declaring the base rule', () => {
    for (const variant of ['--roomy', '--wide', '--narrow']) {
      const block = CSS.slice(CSS.indexOf(`.shell${variant} {`));
      const body = block.slice(0, block.indexOf('}'));
      expect(body, `.shell${variant} should set --tp-measure`).toContain('--tp-measure');
      expect(body, `.shell${variant} should not set max-width directly`).not.toContain('max-width');
    }
  });
});
