import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LEGAL_DOCUMENTS, PENDING_PATTERN, legalDocument } from './legal.js';
import { SERVER_RENDERED_PATHS, SITE_ROUTES, isSiteRoute } from './routes.js';

/**
 * The policy pages, and the two ways they can quietly become wrong.
 *
 * The first is drift: the pages state token lifetimes, a storage inventory and a claim that there
 * are no third-party trackers. Every one of those is a fact about the code, and a policy that
 * describes a system nobody built is worse than no policy — the first person to check finds it
 * false in the part they were checking.
 *
 * The second is a placeholder shipping. `CLAUDE.md` rule 8 keeps legal wording with a human, and
 * the parts a human still owes are marked rather than invented. A marker that renders as ordinary
 * prose would defeat the whole arrangement.
 */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('the policy pages', () => {
  it.each(['about', 'faq', 'privacy', 'cookies', 'terms'])('publishes /%s', (slug) => {
    const document = legalDocument(slug);
    expect(document, `no document for ${slug}`).toBeDefined();
    expect(document!.sections.length).toBeGreaterThan(0);
    expect(isSiteRoute(`/${slug}`), `/${slug} is not a site route`).toBe(true);
  });

  /**
   * Server-rendered, which for these pages is the whole point.
   *
   * A privacy policy that needs JavaScript is a privacy policy a regulator's fetch, an archiver or
   * a text browser cannot read. These are static prose; nothing about them should require a runtime.
   */
  it.each(['about', 'faq', 'privacy', 'cookies', 'terms'])(
    '/%s is served by the server, not the precache',
    (slug) => {
      expect(SERVER_RENDERED_PATHS.some((pattern) => pattern.test(`/${slug}`))).toBe(true);
    },
  );

  it('leaves the app to the service worker', () => {
    // Deriving the denylist from the routes must not have swallowed the application.
    for (const appRoute of ['/forms', '/events', '/brand', '/login']) {
      expect(SERVER_RENDERED_PATHS.some((pattern) => pattern.test(appRoute))).toBe(false);
    }
  });

  it('derives the denylist from the routes rather than restating them', () => {
    for (const route of SITE_ROUTES) {
      expect(
        SERVER_RENDERED_PATHS.some((pattern) => pattern.test(route)),
        `${route} is a site route the worker would answer from cache`,
      ).toBe(true);
    }
  });
});

describe('what the pages claim about the software', () => {
  const privacy = legalDocument('privacy')!;
  const cookies = legalDocument('cookies')!;
  const everything = (slug: string) =>
    legalDocument(slug)!
      .sections.flatMap((section) => [...section.body, ...(section.rows ?? []).flat()])
      .join('\n');

  /**
   * The lifetimes on the page are the constants the server runs on.
   *
   * Written as a comparison rather than as a copy: if somebody shortens the refresh token to seven
   * days, the page saying thirty becomes a false statement about retention, which is the kind of
   * false statement that matters.
   */
  it('states the token lifetimes the code actually enforces', () => {
    const tokens = read('../../../api-forms/src/auth/tokens.ts');
    const text = everything('privacy');

    expect(tokens).toContain('ACCESS_TOKEN_TTL_SECONDS = 15 * 60');
    expect(tokens).toContain('REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60');
    expect(tokens).toContain('MAGIC_LINK_TTL_SECONDS = 15 * 60');

    expect(text).toContain('15 minutes');
    expect(text).toContain('30 days');
  });

  /**
   * The strongest claim on any of these pages, and the easiest to invalidate by accident.
   *
   * One `<script src="https://...">` added to the shell, one analytics snippet, and the cookie page
   * becomes untrue. The CSP would refuse to load it, so this is a second lock on the same door.
   */
  it('is telling the truth about there being no third parties', () => {
    const shell = read('../../index.html');
    expect(shell).not.toMatch(/src=["']https?:\/\//);

    const text = everything('cookies');
    expect(text).toContain('no cookies');
    expect(text.toLowerCase()).toContain('no advertising');
  });

  it('lists every stored item, and no more', () => {
    // Five keys are written by the app; the page's table has a row for each.
    const inventory = cookies.sections.find((section) => section.rows)?.rows ?? [];
    expect(inventory).toHaveLength(5);
  });

  it('keeps the controller and processor split, which is the part people get wrong', () => {
    const text = everything('privacy');
    expect(text).toContain('controller');
    expect(text).toContain('processor');
  });

  it('names the supervisory authority a Swedish complaint would go to', () => {
    expect(everything('privacy')).toContain('Integritetsskyddsmyndigheten');
  });

  it('does not invent a database location', () => {
    // Where it is hosted is undecided, and a policy page is the wrong place to decide it.
    const text = everything('privacy');
    expect(text).toMatch(PENDING_PATTERN);
    expect(privacy.sections.some((section) => section.heading === 'Who else processes it')).toBe(
      true,
    );
  });
});

describe('the facts a human still owes', () => {
  /**
   * Every gap is marked, and the marker is what the page renders.
   *
   * The failure this prevents is a placeholder that reads like an answer — "Formwork AB" sitting
   * where a real company name belongs, shipped because it looked plausible in review.
   */
  it('marks them rather than guessing', () => {
    const source = read('./legal.ts');
    const marked = [...source.matchAll(/pending\('([^']+)'\)/g)].map((match) => match[1]!);

    expect(marked.length).toBeGreaterThanOrEqual(15);
    for (const gap of marked) {
      // A marker has to say what is missing, or it is just a blank with a colour.
      expect(gap.length, `"${gap}" does not describe what is needed`).toBeGreaterThan(10);
    }
  });

  it('is written down somewhere a person will find it', () => {
    const review = read('../../../../LEGAL-REVIEW.md');
    for (const required of [
      'organisation number',
      'hosting provider',
      'sub-processor',
      'legal basis',
      'Governing law',
    ]) {
      expect(review.toLowerCase()).toContain(required.toLowerCase());
    }
  });

  it('never renders a marker as ordinary prose', () => {
    const site = read('./Site.tsx');
    // `withPending` splits on the pattern and wraps the odd parts; without it the brackets would show.
    expect(site).toContain('PENDING_PATTERN');
    expect(site).toContain('className="pending"');
  });
});

describe('every document', () => {
  it.each(LEGAL_DOCUMENTS.map((document) => [document.slug, document] as const))(
    '%s says when it was last reviewed',
    (_slug, document) => {
      // A policy with no date is a policy nobody can tell is stale.
      expect(document.updated).toMatch(/\d{4}/);
      expect(document.lede.length).toBeGreaterThan(20);
    },
  );
});
