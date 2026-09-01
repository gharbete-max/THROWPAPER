/**
 * Generates the PWA icons from the brand tokens.
 *
 * Checked-in binaries that nobody can regenerate go stale the moment the brand changes. This is a
 * script so a token change can reproduce them — `pnpm icons` — and so the mark is defined in one
 * place rather than in a design file nobody has.
 *
 * Flat, no gradients, no corner ornament: the treatment SPEC-shared.md §Brand direction asks for.
 */
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { defaultTokens } from '@tp/tokens';

const SIZES = [192, 512];
const OUT_DIR = resolve('apps/forms/public');

const markup = (size: number) => `<!doctype html>
<html><head><meta charset="utf-8" /><style>
  html, body { margin: 0; padding: 0; }
  .icon {
    width: ${size}px; height: ${size}px;
    background: ${defaultTokens.colour.primary};
    display: flex; align-items: center; justify-content: center;
  }
  .glyph {
    color: ${defaultTokens.colour.background};
    font-family: ${defaultTokens.typography.headingFont};
    font-weight: ${defaultTokens.typography.weightBold};
    /* Generous padding so the maskable variant survives a circular crop. */
    font-size: ${Math.round(size * 0.44)}px;
    line-height: 1;
    letter-spacing: -0.04em;
  }
</style></head>
<body><div class="icon"><span class="glyph">F</span></div></body></html>`;

const browser = await chromium.launch();
try {
  for (const size of SIZES) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(markup(size), { waitUntil: 'load' });
    await page.evaluate(
      '(async () => { await document.fonts.ready; })()' as unknown as () => Promise<void>,
    );
    const png = await page.screenshot({ type: 'png' });
    await writeFile(resolve(OUT_DIR, `icon-${size}.png`), png);
    await page.close();
    console.log(`icon-${size}.png`);
  }
} finally {
  await browser.close();
}
