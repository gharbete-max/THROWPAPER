import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

/**
 * The waiting indicator is the brand bundle's vector spinner. Every web page that waits shows it,
 * so it must stay small: the animated mark it replaced was 1.1 MB (measured 2026-10-21).
 */
describe('the loading indicator', () => {
  it('draws the 1.4 KB vector spinner, not the animated mark', () => {
    const source = readFileSync(here('./Loading.tsx'), 'utf8');
    expect(source).toContain('/loppa-spinner.svg');
    expect(source).not.toContain('mark-loop');
    expect(source).not.toMatch(/<Mark\b/);
    expect(statSync(here('../../public/loppa-spinner.svg')).size).toBeLessThan(4096);
  });

  it('is the brand bundle file as it came, and stops itself under reduced motion', () => {
    const shipped = readFileSync(here('../../public/loppa-spinner.svg'), 'utf8');
    const bundle = readFileSync(here('../../../../docs/brand/css/loppa-spinner.svg'), 'utf8');
    expect(shipped.replace(/\r\n/g, '\n')).toBe(bundle.replace(/\r\n/g, '\n'));
    expect(shipped).toContain('prefers-reduced-motion: reduce');
  });

  it('leaves the 1.1 MB loop to the one place it plays: the intro', () => {
    const intro = readFileSync(here('./Intro.tsx'), 'utf8');
    expect(intro).toMatch(/<Mark motion/);
    // Nothing else in the components asks for the animated mark.
    for (const file of ['Loading.tsx', 'Logo.tsx', 'Masthead.tsx']) {
      expect(readFileSync(here(`./${file}`), 'utf8')).not.toMatch(/<Mark motion/);
    }
  });
});
