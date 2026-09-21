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

  /** The way onward, in every language, posting without script to the one path it may land on. */
  it('renders the contact form as a plain post with a held redirect', () => {
    const { html, status } = render('/de/contact', 'https://x.test');
    expect(status).toBe(200);
    expect(html).toContain('method="post"');
    expect(html).toContain('action="/api/public/contact"');
    expect(html).toContain('name="next" value="/de/contact/sent"');
    expect(html).toContain('name="website"');
    expect(render('/de/contact/sent', 'https://x.test').status).toBe(200);
  });

  it('leaves a real page at 200', () => {
    expect(render('/', 'https://x.test').status).toBe(200);
    expect(render('/sv/features/events', 'https://x.test').status).toBe(200);
  });
});

/**
 * What the third critique asked of the chrome and the feature pages, held in the rendered HTML.
 */
describe('the site, as rendered', () => {
  it('marks the page being read in the bar, with the conventional token', () => {
    const { html } = render('/features/events', 'https://x.test');
    expect(html).toContain('href="/features/events" aria-current="page"');
    expect(html).not.toContain('href="/features/forms" aria-current');
    // The language switcher used `aria-current="true"`; a page is a page.
    expect(html).not.toContain('aria-current="true"');
    expect(html).toContain('aria-current="page"');
  });

  it('fills exactly one button on the landing page, the hero’s', () => {
    const { html } = render('/', 'https://x.test');
    const filled = html.match(/class="button"/g) ?? [];
    // The hero and the closing panel; the bar's is quiet now. Never two in one viewport.
    expect(filled).toHaveLength(2);
    expect(html).toContain('class="button button--quiet" href="/login"');
  });

  it('gives a feature page an action and a way back that says so', () => {
    const { html } = render('/features/events', 'https://x.test');
    expect(html).toContain('class="site__pointsActions"');
    expect(html).toContain(`${copyFor('en-GB').featurePage.back}</a>`);
    expect(html).not.toContain(copyFor('en-GB').featurePage.backToAll);
  });

  it('does not read "Read more" aloud six times', () => {
    const { html } = render('/', 'https://x.test');
    expect(html.match(/class="feature-card__more" aria-hidden="true"/g)).toHaveLength(
      FEATURE_SLUGS.length,
    );
  });
});
