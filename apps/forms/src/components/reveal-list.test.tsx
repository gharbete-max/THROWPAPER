import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Reveal } from './Signed.js';

/**
 * A list is a list only if its items are the list's children.
 *
 * Responses wrapped every `<li>` in `<Reveal>`, which is a `<div>`, so the DOM read
 * `<ul><div><li>`: a screen reader stops counting items, and `.inbox__row + .inbox__row` — the
 * rule that draws the divider between rows — matched nothing, because no row was ever the
 * sibling of another. The effect has to run *as* the item, not around it.
 *
 * Rendered with `react-dom/server` rather than checked in the source alone: there is no DOM in
 * this workspace, but a static render is enough to see what element the wrapper becomes. With no
 * `matchMedia` the hook assumes reduced motion, so the item renders already revealed.
 */
describe('Reveal inside a list', () => {
  it('renders as the list item when asked to', () => {
    const html = renderToStaticMarkup(
      createElement(
        'ul',
        null,
        createElement(Reveal, { as: 'li', className: 'row', children: 'one' }),
      ),
    );
    expect(html).toBe('<ul><li class="row reveal reveal--in">one</li></ul>');
  });

  it('is still a div everywhere else', () => {
    const html = renderToStaticMarkup(createElement(Reveal, { children: 'card' }));
    expect(html).toBe('<div class="reveal reveal--in">card</div>');
  });

  it('never puts a wrapper between the Responses list and its rows', () => {
    const source = readFileSync(new URL('../screens/Inbox.tsx', import.meta.url), 'utf8');
    // `<Reveal>` followed by `<li` is the shape that was wrong.
    expect(source).not.toMatch(/<Reveal[^>]*>\s*<li\b/);
    expect(source).toMatch(/<Reveal[^>]*\bas="li"/);
  });
});
