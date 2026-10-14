import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The digital copy reads a page on this device (`docs/plan/CAVEATS.md` #43, `privacy`) and never
 * asks a model (ADR 0019): the files that read or show it cannot reach the server. Only `keep.ts`
 * does, for a PDF the person asked for, which the server draws and keeps nowhere. The pure parts
 * (`@tp/shared/import`, `scan/`) import nothing but each other.
 */
const SCREEN = new URL('./', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const PURE = new URL(
  '../../../../../packages/shared/src/import/scan/',
  import.meta.url,
).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const sources = (dir: string) =>
  readdirSync(dir).filter(
    (name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && name !== 'fixtures.ts',
  );

describe('the digital copy', () => {
  it('reads and shows a page without reaching the server: only keep.ts may', () => {
    const files = sources(SCREEN).filter((name) => name !== 'keep.ts');
    expect(files).toEqual(expect.arrayContaining(['read.ts', 'Sheet.tsx', 'DigitalCopy.tsx']));
    for (const name of files) {
      expect(readFileSync(join(SCREEN, name), 'utf8'), name).not.toMatch(
        /lib\/api|fetch\(|XMLHttpRequest|sendBeacon|WebSocket|localStorage|sessionStorage|indexedDB/,
      );
    }
  });

  it('keeps its pure parts pure: relative imports only, and no clock, dice or transcendental', () => {
    for (const name of sources(PURE)) {
      const source = readFileSync(join(PURE, name), 'utf8');
      for (const [, from] of source.matchAll(/from '([^']+)'/g)) {
        expect(from!.startsWith('.'), `${name} imports ${from}`).toBe(true);
      }
      expect(source, name).not.toMatch(
        /Date\.now|Math\.random|Math\.exp|Math\.log|Math\.pow|document\.|window\./,
      );
    }
  });

  it('is a lazy chunk: Scan reaches it only with a dynamic import', () => {
    const scan = readFileSync(join(SCREEN, '..', 'Scan.tsx'), 'utf8');
    expect(scan).toContain("lazy(() => import('./digital-copy/DigitalCopy.js'))");
    expect(scan).not.toMatch(/^import .*digital-copy/m);
  });
});
