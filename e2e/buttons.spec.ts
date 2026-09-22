import { expect, test } from '@playwright/test';
import { contrastRatio } from '@tp/tokens';

/**
 * Buttons, measured as they are painted rather than as they are written.
 *
 * Both findings here were invisible to a stylesheet reading. The filled tier's hover rule existed,
 * was correct, and never reached the page — a later rule of equal specificity repainted it — so a
 * test asserting "the CSS says hover swaps the ink" would have passed throughout. The only way to
 * know what a button does is to hover one and read what the browser computed.
 */
/**
 * A computed colour → `#rrggbb`, because `contrastRatio` speaks hex.
 *
 * Chromium answers in two forms: `rgb(206, 168, 92)` with 0–255 channels, and
 * `color(srgb 0.907 0.905 0.898)` with 0–1 ones. Reading the second as though it were the first
 * rounds every channel to 0 or 1 — near black — and turns a failing 2.1:1 into a passing 9.32:1.
 * That is a guard that reports the opposite of the truth, which is worse than no guard.
 */
function hex(computed: string): string {
  const parts = computed.match(/\d+(\.\d+)?/g);
  if (!parts || parts.length < 3) throw new Error(`Not a colour: ${computed}`);
  const scale = computed.startsWith('color(') ? 255 : 1;
  return `#${parts
    .slice(0, 3)
    .map((part) =>
      Math.round(Number(part) * scale)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

test('a filled button changes when the pointer is on it', async ({ page }) => {
  /*
   * The site, for the same reason the quiet test uses it.
   *
   * A public form wears the organisation's brand kit, and the demo's `primary` and `text` are both
   * `#1b263b` — so the hover swaps the fill to a colour identical to the one already there and
   * nothing moves, whether or not the rule works. The shipped palette has a gold primary and a
   * near-black ink, where the swap is the whole point.
   */
  await page.goto('/');

  const filled = page
    .locator('.button:not(.button--quiet):not(.button--danger):not(.button--bare)')
    .first();
  await expect(filled).toBeVisible();

  const resting = await filled.evaluate((node) => getComputedStyle(node).backgroundColor);
  await filled.hover();
  const hovered = await filled.evaluate((node) => getComputedStyle(node).backgroundColor);

  expect(hovered, `the filled tier paints ${resting} whether or not it is hovered`).not.toBe(
    resting,
  );
});

test('a quiet button hovers to an edge somebody can see', async ({ page }) => {
  /*
   * The marketing site, not a public form.
   *
   * A form wears the organisation's brand kit, and the demo's primary is a navy that clears 3:1 on
   * its own surface — so this passes there whatever the rule says, and proves nothing. The site is
   * painted in the shipped Loppa palette, where `primary` is the gold that measures 2.14:1 and the
   * finding was made. Checking the wrong surface is how a guard becomes decoration.
   */
  await page.goto('/');

  // The site's quiet tier is on anchors — a link styled as a button is still the tier.
  const quiet = page.locator('.button--quiet').first();
  await expect(quiet).toBeVisible();
  await quiet.hover();

  const [edge, behind] = await quiet.evaluate((node) => {
    const style = getComputedStyle(node);
    return [style.borderTopColor, style.backgroundColor];
  });

  // The repo's own function, so the number agrees with the guard in packages/tokens rather than
  // with a calculator.
  const ratio = contrastRatio(hex(edge), hex(behind));
  expect(ratio, `the hover edge ${edge} is ${ratio}:1 on ${behind}`).not.toBeNull();
  expect(ratio!).toBeGreaterThanOrEqual(3);
});
