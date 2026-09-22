import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Every button tier a screen asks for has to exist in the stylesheet.
 *
 * `RepeatingGroup.tsx` asked for `button--secondary` and no stylesheet defined it, so "Add a guest"
 * rendered as the filled tier — two primaries stacked above one another on the last page of the
 * public form. Nothing failed: an undefined class is not an error in CSS, it is simply nothing.
 *
 * Fixing the one call site would close the row and leave the trap, because the next screen
 * reaching for a tier that sounds plausible gets a second primary in exactly the same silence.
 * This is the mechanism instead of the row.
 */
const SOURCE = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

function filesUnder(directory: string, extension: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return filesUnder(path, extension);
    return entry.name.endsWith(extension) ? [path] : [];
  });
}

/** `button--quiet`, `button--danger`… as written in a `className`, wherever it appears. */
function tiersAskedFor(source: string): string[] {
  return [...source.matchAll(/\bbutton--[a-z0-9-]+/g)].map((match) => match[0]);
}

describe('button tiers', () => {
  const stylesheet = readFileSync(join(SOURCE, 'styles.css'), 'utf8');
  const defined = new Set(tiersAskedFor(stylesheet));

  it('defines every tier the screens ask for', () => {
    const missing = new Map<string, string[]>();

    for (const file of filesUnder(SOURCE, '.tsx')) {
      for (const tier of tiersAskedFor(readFileSync(file, 'utf8'))) {
        if (defined.has(tier)) continue;
        const at = file.slice(SOURCE.length).replace(/\\/g, '/');
        missing.set(tier, [...(missing.get(tier) ?? []), at]);
      }
    }

    expect(
      [...missing],
      [...missing]
        .map(([tier, files]) => `${tier} is used in ${files.join(', ')} and defined nowhere`)
        .join('; '),
    ).toEqual([]);
  });

  /** The guard is worth nothing if it cannot see a class that is not there. */
  it('notices a tier that does not exist', () => {
    expect(defined.has('button--secondary')).toBe(false);
    expect(tiersAskedFor('<button className="button button--invented" />')).toEqual([
      'button--invented',
    ]);
  });
});
