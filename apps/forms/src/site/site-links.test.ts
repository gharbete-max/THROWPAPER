import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isSiteRoute } from './routes.js';

/**
 * The public site links with anchors, and the reason is a bug that only the demo could show.
 *
 * `Site` is a different tree from `App`, behind a different mount. `SITE_ROUTES` says which URLs
 * it owns; `/login` and the whole signed-in shell are not among them. React-router's `Link`
 * navigates inside whichever router is above it, so "Open the demo" changed the URL to `/login`
 * and then found no matching route — header, footer, and a blank page between them, with a
 * console warning nobody watching a demo is reading.
 *
 * It could not be seen in production. There the site is server-rendered and deliberately not
 * hydrated, so no router is mounted and `Link` is already just the anchor it renders as. It
 * appeared only under `pnpm demo`, where Vite serves the shell and the site is client-mounted —
 * the one build whose entire purpose is to be looked at.
 *
 * This is the fourth instance of the failure mode `dev-proxy.test.ts` names: `200 text/html`, no
 * error, and the wrong document. Nothing catches it but a person opening the page, so the rule
 * gets written down here instead of relied upon.
 *
 * Read as text rather than by rendering, because the property is about which element is authored,
 * and a rendered `Link` and a rendered `<a>` are the same DOM node. That is the whole trap.
 */
const SOURCE = readFileSync(new URL('./Site.tsx', import.meta.url), 'utf8');

describe('the public site', () => {
  it('never imports react-router Link', () => {
    const imports = SOURCE.match(/^import \{([^}]*)\} from 'react-router';/m)?.[1] ?? '';
    expect(imports).not.toMatch(/\bLink\b/);
  });

  it('authors no <Link> elements', () => {
    expect(SOURCE).not.toMatch(/<Link[\s>]/);
  });

  /**
   * `to=` is `Link`'s prop and no anchor's. Catching it separately means a `Link` reintroduced
   * under an alias — or a `NavLink` — still fails, rather than slipping past a check for one name.
   */
  it('navigates by href rather than by router prop', () => {
    expect(SOURCE).not.toMatch(/\sto=\{?["'{]/);
  });

  /**
   * The premise the whole file rests on: the demo entry point is genuinely the app's URL, not a
   * site page somebody forgot to register. If `/login` were ever added to `SITE_ROUTES`, the
   * anchors would still work and this reasoning would need re-reading.
   */
  it('sends "Open the demo" to an address the site does not own', () => {
    expect(SOURCE).toContain('href="/login"');
    expect(isSiteRoute('/login')).toBe(false);
  });
});
