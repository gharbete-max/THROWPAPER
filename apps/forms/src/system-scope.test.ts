import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The house style stops at the published form.
 *
 * A form belongs to the organisation that made it. Their members open it expecting their
 * association's registration page, and it is rendered in their palette, their language and their
 * wording. Our folding paper appearing on it is our design arriving somewhere nobody invited it —
 * and worse, it would be the one part of that page the organisation cannot switch off.
 *
 * So the paper language is scoped to `.system`, which goes on the surfaces that are Formwork's
 * own: the app shell, the marketing site, and the two sign-in screens. `PublicForm` renders
 * outside the shell entirely and never carries it.
 *
 * The failure this prevents is not hypothetical, it is one careless class away: a `.button` rule
 * written without the scope, or a `.system` added to the wrong container while moving a screen.
 * Both are invisible in the app — where everything is in scope — and only show up on a customer's
 * page.
 */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

const CSS = read('./styles.css');
const PUBLIC_FORM = read('./screens/PublicForm.tsx');
const FOLD = read('./lib/fold.ts');

describe('the paper language', () => {
  /**
   * Every rule the fold introduces has to name the scope.
   *
   * Checked against the block rather than the whole stylesheet, because plenty of unrelated rules
   * legitimately style `.button` — this is about the ones that fold it.
   */
  it('scopes every folding rule to .system', () => {
    const block = CSS.slice(CSS.indexOf('/* --- Buttons fold when pressed'));
    const selectors = [...block.matchAll(/^(\.[^\s{,]+[^{]*)\{/gm)].map((match) =>
      match[1]!.trim(),
    );

    expect(selectors.length).toBeGreaterThan(0);
    for (const selector of selectors) {
      expect(selector, `"${selector}" would fold a control on any page`).toContain('.system');
    }
  });

  it('never puts the scope on the public form', () => {
    expect(PUBLIC_FORM).not.toContain('system');
  });

  it('asks for the scope before decorating a press', () => {
    // Ancestry, not a bound root: a screen cannot acquire the effect by being moved.
    expect(FOLD).toContain("closest('.system')");
  });

  /**
   * The mark's own hover is scoped too.
   *
   * It is drawn on the public form's header in the organisation's colours, where it is their
   * brand mark rather than an animation of ours.
   */
  it('scopes the mark hover to .system', () => {
    const hover = CSS.slice(CSS.indexOf('.wordmark:hover'), CSS.indexOf('mark--intro'));
    expect(hover).toContain('.system');
  });
});
