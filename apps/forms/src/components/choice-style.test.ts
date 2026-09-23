import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CHOICE_ACCENTS, CHOICE_COLUMNS, CHOICE_SHAPES, CHOICE_SIZES } from '@tp/shared/forms';
import { choiceClasses } from './FieldInput.js';

const SOURCE = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const stylesheet = readFileSync(join(SOURCE, 'styles.css'), 'utf8');

/** Each rule as `[selector, body]`, comments removed. Flat enough for this stylesheet. */
function rules(css: string): Array<[string, string]> {
  const plain = css.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...plain.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => [match[1]!.trim(), match[2]!]);
}

describe('a chosen answer is marked at 3:1, whatever the brand', () => {
  /**
   * The edge that says "this one" was the raw brand colour, and Loppa's gold is 2.14:1 on white.
   * `packages/tokens` now derives an edge per brand role and holds it to 3:1; this holds the
   * stylesheet to using it, so a new chosen-state rule cannot quietly reach for the raw colour.
   */
  it('never paints a checked or chosen state with a raw brand colour', () => {
    const offenders = rules(stylesheet)
      .filter(([selector]) => /:checked|--on\b/.test(selector))
      .filter(([, body]) =>
        /(border|box-shadow|outline|accent-color)[^;]*var\(--tp-colour-(primary|secondary|accent)\)/.test(
          body,
        ),
      )
      .map(([selector]) => selector);
    expect(offenders).toEqual([]);
  });
});

describe('choice style classes', () => {
  it('adds nothing to a question that never set a style', () => {
    expect(choiceClasses('buttons', undefined)).toBe('choice choice--buttons');
  });

  it('names every setting, and the stylesheet defines every name it can produce', () => {
    const classes = new Set<string>();
    for (const shape of CHOICE_SHAPES)
      for (const size of CHOICE_SIZES)
        for (const accent of CHOICE_ACCENTS)
          for (const columns of CHOICE_COLUMNS)
            for (const name of choiceClasses('cards', { shape, size, accent, columns }).split(' '))
              classes.add(name);

    // The defaults are the theme itself, so they need no rule of their own.
    const needsNoRule = new Set([
      'choice',
      'choice--cards',
      'choice--shape-theme',
      'choice--size-regular',
      'choice--accent-primary',
      'choice--columns-auto',
    ]);
    const undefinedClasses = [...classes].filter(
      (name) => !needsNoRule.has(name) && !stylesheet.includes(`.${name}`),
    );
    expect(undefinedClasses).toEqual([]);
  });

  it('has no size that goes under the 44px target', () => {
    // Every size rule may only raise the floor set on `.choice__option`.
    const sizes = rules(stylesheet).filter(([selector]) => selector.includes('choice--size-'));
    for (const [, body] of sizes) {
      const height = body.match(/min-height:\s*(\d+)px/);
      if (height) expect(Number(height[1])).toBeGreaterThanOrEqual(44);
    }
    expect(stylesheet).toMatch(/\.choice__option \{[^}]*min-height: 44px/);
  });
});
