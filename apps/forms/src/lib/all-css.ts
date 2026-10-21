import { readFileSync, readdirSync } from 'node:fs';

/**
 * The whole stylesheet as the browser ends up with it: the entry's `styles.css` followed by the
 * per-screen files in `styles/` (docs/plan/SIMPLIFY.md, proposal 5). For tests that assert that a
 * rule exists somewhere, not where; a rule that must be in the entry is read from `styles.css`.
 */
export function allCss(): string {
  const dir = new URL('../styles/', import.meta.url);
  return [
    readFileSync(new URL('../styles.css', import.meta.url), 'utf8'),
    ...readdirSync(dir)
      .filter((name) => name.endsWith('.css'))
      .sort()
      .map((name) => readFileSync(new URL(name, dir), 'utf8')),
  ].join('\n');
}
