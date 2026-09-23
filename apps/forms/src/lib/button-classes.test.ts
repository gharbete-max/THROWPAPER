import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
const SOURCE = fileURLToPath(new URL('../', import.meta.url));

/** `button--quiet`, `button--danger`… as written in a `className`, wherever it appears. */
function tiersAskedFor(source: string): string[] {
  return [...source.matchAll(/\bbutton--[a-z0-9-]+/g)].map((match) => match[0]);
}

describe('button tiers', () => {
  const stylesheet = readFileSync(join(SOURCE, 'styles.css'), 'utf8');
  const defined = new Set(tiersAskedFor(stylesheet));

  it('defines every tier the screens ask for', () => {
    const missing = new Map<string, string[]>();

    const screens = readdirSync(SOURCE, { recursive: true, encoding: 'utf8' }).filter((f) =>
      f.endsWith('.tsx'),
    );
    for (const file of screens) {
      for (const tier of tiersAskedFor(readFileSync(join(SOURCE, file), 'utf8'))) {
        if (defined.has(tier)) continue;
        const at = file.replace(/\\/g, '/');
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
