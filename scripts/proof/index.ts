/**
 * The phase 1 checkpoint, by hand:
 *
 *   pnpm tokens:proof
 *   pnpm tokens:proof --primary '#ff0000'
 *
 * Renders one card definition through all three compilers and writes a side-by-side page to
 * proof-out/. START-HERE.md: "If one token change does not reach web, PDF and email, stop and
 * solve that." proof.test.ts asserts the same thing automatically; this is the version you look at.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { defaultTokens, type TokenSet } from '@tp/tokens';
import { renderWeb } from './render-web.js';
import { renderEmail } from './render-email.js';
import { renderPdf } from './render-pdf.js';

const OUT_DIR = resolve('proof-out');

function tokensFromArgs(argv: readonly string[]): TokenSet {
  const index = argv.indexOf('--primary');
  const primary = index >= 0 ? argv[index + 1] : undefined;
  if (!primary) return defaultTokens;
  if (!/^#[0-9a-fA-F]{6}$/.test(primary)) {
    throw new Error(`--primary expects a six-digit hex colour, got "${primary}"`);
  }
  return { ...defaultTokens, colour: { ...defaultTokens.colour, primary } };
}

const tokens = tokensFromArgs(process.argv.slice(2));

await mkdir(OUT_DIR, { recursive: true });

const web = renderWeb(tokens);
const email = await renderEmail(tokens);
const { pdf, headingColour } = await renderPdf(tokens);

await Promise.all([
  writeFile(resolve(OUT_DIR, 'web.html'), web, 'utf8'),
  writeFile(resolve(OUT_DIR, 'email.html'), email, 'utf8'),
  writeFile(resolve(OUT_DIR, 'card.pdf'), pdf),
  writeFile(resolve(OUT_DIR, 'index.html'), sideBySide(tokens), 'utf8'),
]);

console.log(`primary token      ${tokens.colour.primary}`);
console.log(`chromium computed  ${headingColour}`);
console.log(`written            ${OUT_DIR}`);
console.log('\nOpen proof-out/index.html and check all three panels moved together.');

function sideBySide(current: TokenSet): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Tokens — three targets</title>
<style>
  body { margin: 0; padding: 16px; font: 14px system-ui, sans-serif; background: #14181f; color: #e8ebf0; }
  h1 { font-size: 16px; margin: 0 0 4px; }
  .note { color: #99a2b0; margin: 0 0 16px; }
  .swatch { display: inline-block; width: 12px; height: 12px; vertical-align: -1px;
            border-radius: 2px; background: ${current.colour.primary}; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; align-items: start; }
  section { background: #1d222b; border: 1px solid #2c3340; border-radius: 8px; overflow: hidden; }
  h2 { font-size: 13px; margin: 0; padding: 8px 12px; border-bottom: 1px solid #2c3340; color: #99a2b0; }
  iframe, embed { width: 100%; height: 620px; border: 0; background: #fff; display: block; }
  @media (max-width: 1100px) { .grid { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<h1>One token set, three targets</h1>
<p class="note">
  primary <span class="swatch"></span> <code>${current.colour.primary}</code> —
  web reads CSS custom properties, email resolves to inline styles and tables, PDF is a print
  stylesheet with embedded fonts. Change the token and all three must move.
</p>
<div class="grid">
  <section><h2>Web — CSS custom properties</h2><iframe src="web.html"></iframe></section>
  <section><h2>Email — inline styles, table layout</h2><iframe src="email.html"></iframe></section>
  <section><h2>PDF — print stylesheet, embedded fonts</h2><embed src="card.pdf" type="application/pdf" /></section>
</div>
</body>
</html>
`;
}
