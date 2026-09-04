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
   * Anything that decorates an interaction has to name the scope.
   *
   * This was written as "every rule after the fold's own heading", which held only while that block
   * happened to be the last thing in the file. Adding the policy pages after it broke the test
   * without breaking the property — the worst kind of failure, because the obvious repair is to
   * move the slice and carry on.
   *
   * So it asks the question that actually matters instead of the one that was convenient: a rule
   * that fires on hover, on press, or on the folding class is decoration, and decoration is what
   * must not reach somebody else's registration page. Where it sits in the stylesheet is not the
   * point.
   *
   * The mark's own colours are deliberately outside this. The mark is drawn on a published form in
   * the organisation's palette, where it is their brand and not our animation; only its motion is
   * ours to withhold.
   */
  it('scopes every rule in the house-style region to .system', () => {
    const start = CSS.indexOf('/* system-scope:start');
    const end = CSS.indexOf('/* system-scope:end');
    expect(start, 'the scoped region is not marked in the stylesheet').toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);

    const region = CSS.slice(start, end);
    const selectors = [...region.matchAll(/^(\.[^\s{,][^{]*)\{/gm)].map((match) =>
      match[1]!.trim(),
    );

    /*
     * The mark itself is deliberately outside the rule, and only the mark.
     *
     * It is drawn on a published form in the organisation's own palette, where it is their brand
     * mark and not our animation — so its box and its four surfaces travel. Everything that *moves*
     * it is withheld, including the intro fold, which nothing puts on a form today and which is
     * scoped anyway. A rule that is safe because it is unused is a bug waiting for a use.
     */
    const structural = /^\.mark(__facet|\s*$|,)/;
    const decoration = selectors.filter((selector) => !structural.test(selector));
    const unscoped = decoration.filter((selector) => !selector.includes('.system'));

    expect(decoration.length).toBeGreaterThan(3);
    expect(unscoped, 'these would apply the house style to a published form').toEqual([]);
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
