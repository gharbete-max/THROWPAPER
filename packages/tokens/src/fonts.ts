/**
 * Font embedding for the PDF target.
 *
 * NODE ONLY — this module reads font files from disk. It is deliberately not re-exported from
 * `@tp/tokens`; import it via `@tp/tokens/pdf` so the browser bundles never pull in node:fs.
 *
 * PDFs must render Nordic characters correctly (SPEC-shared.md §packages/tokens). Referencing a
 * font by name and hoping the rendering host has it is how å ä ö become boxes on a Linux
 * container, so the bytes are embedded as data: URIs instead.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

interface EmbeddableFont {
  family: string;
  /** Subsets to embed. `latin` carries å ä ö æ ø; `latin-ext` adds the rest of the region. */
  subsets: readonly string[];
  specifier: (weight: number, subset: string) => string;
}

/** Families we ship font files for. Anything else falls back to the host's system fonts. */
export const EMBEDDABLE_FONTS: Readonly<Record<string, EmbeddableFont>> = {
  Inter: {
    family: 'Inter',
    subsets: ['latin', 'latin-ext'],
    specifier: (weight, subset) => `@fontsource/inter/files/inter-${subset}-${weight}-normal.woff2`,
  },
};

/** "Inter, system-ui, sans-serif" -> "Inter". */
export function primaryFamily(stack: string): string {
  const first = stack.split(',')[0] ?? stack;
  return first.trim().replace(/^['"]|['"]$/g, '');
}

/**
 * `@font-face` rules with the font bytes inlined. Families with no shipped files are skipped —
 * the stack's own fallbacks then apply, which is the correct degradation.
 */
export function fontFaceCss(stacks: readonly string[], weights: readonly number[]): string {
  const families = [...new Set(stacks.map(primaryFamily))];
  const blocks: string[] = [];

  for (const name of families) {
    const font = EMBEDDABLE_FONTS[name];
    if (!font) continue;

    for (const weight of weights) {
      for (const subset of font.subsets) {
        const encoded = readFontBase64(font.specifier(weight, subset));
        if (!encoded) continue;
        blocks.push(
          [
            '@font-face {',
            `  font-family: '${font.family}';`,
            '  font-style: normal;',
            `  font-weight: ${weight};`,
            '  font-display: block;',
            `  src: url(data:font/woff2;charset=utf-8;base64,${encoded}) format('woff2');`,
            '}',
          ].join('\n'),
        );
      }
    }
  }

  return blocks.join('\n');
}

function readFontBase64(specifier: string): string | null {
  try {
    return readFileSync(require.resolve(specifier)).toString('base64');
  } catch {
    // A missing subset is not fatal — the remaining subsets still cover the common range.
    return null;
  }
}
