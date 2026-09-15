import { describe, expect, it } from 'vitest';
import { render } from '../entry-server.js';
import { FEATURE_SLUGS } from './content.js';
import { copyFor } from './copy/index.js';

/**
 * An address the site does not have is a page, in the visitor's language, with a 404 on it.
 *
 * Rendered for real rather than stubbed: `serve-app.test.ts` proves the server puts the status on
 * the wire, and this proves the bundle it asks produces the right one — the two halves of the
 * same guarantee.
 */
describe('the site’s not-found page', () => {
  it('is a 404 with the site chrome and a way onward', () => {
    const { html, head, status, lang } = render('/features/nothing', 'https://x.test');
    expect(status).toBe(404);
    expect(lang).toBe('en-GB');
    expect(head).toContain(`<title>${copyFor('en-GB').notFound.title}`);
    expect(html).toContain('class="site__bar"');
    for (const slug of FEATURE_SLUGS) expect(html).toContain(`href="/features/${slug}"`);
  });

  it('speaks the language of the address', () => {
    const { status, lang, html } = render('/de/login', 'https://x.test');
    expect(status).toBe(404);
    expect(lang).toBe('de-DE');
    expect(html).toContain(copyFor('de-DE').notFound.title);
  });

  it('leaves a real page at 200', () => {
    expect(render('/', 'https://x.test').status).toBe(200);
    expect(render('/sv/features/events', 'https://x.test').status).toBe(200);
  });
});
