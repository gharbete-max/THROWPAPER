import { Route, Routes, useLocation } from 'react-router';
import { FEATURE_ICONS, FEATURE_SLUGS, type FeatureSlug, type SiteCopy } from './content.js';
import { LEGAL_DOCUMENTS, PENDING_PATTERN, type LegalDocument } from './legal.js';
import { SITE_DEFAULT_LOCALE, SITE_LOCALES, localePath } from './locale.js';
import { siteLocaleLabel } from './locale-labels.js';
import { copyFor } from './copy/index.js';
import { Icon } from '../components/Icon.js';
import { Logo } from '../components/Logo.js';

/**
 * The public site: a landing page and one page per thing the product does, in every language the
 * site is published in.
 *
 * ## Why this is a separate tree from the app
 *
 * It renders on the server, and the app cannot. The app is behind a bearer token held in
 * `localStorage`, fetches a brand kit and a session before it can draw anything, and is read by
 * exactly one person who is already signed in — there is no crawler to serve and no first paint to
 * win. Server-rendering it would mean teaching the server to be signed in as somebody.
 *
 * These pages have the opposite shape: no session, no fetch, no state. They are a pure function of
 * `locale` and `copy/`, which is what makes `renderToString` on them trivial and what makes them
 * worth rendering at all — this is the surface a search engine and a link preview actually read.
 *
 * So the two trees stay apart. `entry-server.tsx` renders this one; `main.tsx` hydrates it where
 * the server has already drawn it, and mounts the app everywhere else.
 *
 * ## The locale is a prop, and the router carries a basename
 *
 * `/de/features/events` is a real address — see `locale.ts` for why the language is in the path and
 * not in a cookie. The router is given `basename="/de"`, so every `<Route>` below is written once,
 * unprefixed, and matching is unaffected by which language is being served.
 *
 * Anchors are the exception and have to say the prefix out loud, because `basename` only rewrites
 * react-router's own `Link` and this tree deliberately has none. That is what `localePath` is for,
 * and using it is not optional: a hand-written `/features/forms` in a German page is a trapdoor
 * back into English that nothing else would catch.
 *
 * ## Why every link here is `<a href>` and never react-router's `Link`
 *
 * `SITE_ROUTES` is the list of URLs this tree owns. Everything else — `/login`, `/f/:slug`, the
 * whole signed-in shell — belongs to `App`, which is a *different tree behind a different mount*.
 * A `Link` client-navigates within whichever router is above it, so a `Link` to an address this
 * tree does not own changes the URL and then finds nothing to render: header, footer, and a blank
 * page between them.
 *
 * That is what "Open the demo" did. It is invisible in production, because a server-rendered site
 * page is never hydrated — with no router mounted, `Link` had already degraded to the anchor it
 * renders as — so it only appeared where the site *is* client-mounted, which is `pnpm demo`. The
 * demo is the one build whose whole job is to be looked at.
 *
 * Anchors everywhere, rather than anchors for the off-site half, because "which links are ours"
 * is a question nobody should have to re-answer per link. The site has no state to preserve
 * across a navigation, and a full load is what production does for every one of these anyway.
 * `Routes` below still earns its place: it picks the page in development, where Vite serves the
 * shell and the server render never happened.
 */
export function Site({ locale = SITE_DEFAULT_LOCALE }: { locale?: string }) {
  const copy = copyFor(locale);

  return (
    <div className="site system">
      <SiteHeader locale={locale} copy={copy} />
      <Routes>
        <Route path="/" element={<Landing locale={locale} copy={copy} />} />
        {FEATURE_SLUGS.map((slug) => (
          <Route
            key={slug}
            path={`/features/${slug}`}
            element={<FeaturePage slug={slug} locale={locale} copy={copy} />}
          />
        ))}
        {LEGAL_DOCUMENTS.map((document) => (
          <Route
            key={document.slug}
            path={`/${document.slug}`}
            element={<LegalPage document={document} locale={locale} copy={copy} />}
          />
        ))}
        <Route path="/contact" element={<ContactPage locale={locale} copy={copy} />} />
        <Route path="/contact/sent" element={<ContactSentPage locale={locale} copy={copy} />} />
        {/* The catch the comment above warns about: header, footer, and something between. */}
        <Route path="*" element={<NotFoundPage locale={locale} copy={copy} />} />
      </Routes>
      <SiteFooter locale={locale} copy={copy} />
    </div>
  );
}

function SiteHeader({ locale, copy }: { locale: string; copy: SiteCopy }) {
  // The page being read, so the bar can say so. Rendered on the server like everything here.
  const { pathname } = useLocation();
  return (
    <header className="site__bar">
      {/*
        First in the tab order, so it is reachable before the bar it skips. Every page on this site
        opens with these same links; without this they are several presses somebody repeats on
        every navigation.
      */}
      <a className="skip-link" href="#main">
        {copy.chrome.skipToContent}
      </a>

      <a className="site__mark" href={localePath(locale)}>
        <Logo />
        <strong>Loppa</strong>
      </a>

      <nav className="site__nav" aria-label={copy.chrome.siteNavLabel}>
        {/*
          Three of the six, not all of them. A bar that lists every page is a table of contents; the
          landing page already has one, further down, with a sentence each.
        */}
        {(['forms', 'events', 'languages'] as const).map((slug) => {
          const href = localePath(locale, `/features/${slug}`);
          return (
            <a key={slug} href={href} aria-current={href === pathname ? 'page' : undefined}>
              {copy.features[slug].name}
            </a>
          );
        })}
      </nav>

      <SiteLanguages locale={locale} copy={copy} place="bar" />

      {/*
        Quiet here. The page had three filled "Open the demo" and a phone showed two at once; the
        hero's is the one that is filled, and this one is the same door in the corner.
      */}
      <a className="button button--quiet" href="/login">
        {copy.chrome.openTheDemo}
      </a>
    </header>
  );
}

/**
 * The language switcher: plain links to the same page in another language.
 *
 * A `<select>` or a disclosure would need JavaScript, and this tree is deliberately never hydrated
 * in production — the control would be inert on the one surface it exists for. Links also give a
 * crawler the alternates in the markup rather than only in the head, and let somebody open Swedish
 * in a new tab.
 *
 * `useLocation` rather than the raw pathname: the router strips the basename, so this is the page
 * without its language on the front, which is exactly what the other languages need appending to
 * theirs. Switching language on `/features/events` therefore lands on `/de/features/events`, not
 * back at the front page — losing your place is the usual failure of a language switcher and it is
 * the reason people stop using them.
 *
 * It is rendered twice — in the bar and in the footer — and the stylesheet shows exactly one of
 * them at any width. On a phone the bar hides its nav and five wrapping language links were what
 * remained: a 214px sticky header, a quarter of the screen, on every page, with the headline first
 * appearing at y=518. The footer already holds the policy links, which is where a phone user looks
 * for this anyway. Two renders rather than one moved by script, because nothing here runs script;
 * `display: none` also takes the hidden copy out of the accessibility tree, so nobody hears it
 * twice.
 */
function SiteLanguages({
  locale,
  copy,
  place,
}: {
  locale: string;
  copy: SiteCopy;
  place: 'bar' | 'foot';
}) {
  const { pathname } = useLocation();

  return (
    <nav className={`site__langs site__langs--${place}`} aria-label={copy.chrome.languageLabel}>
      {SITE_LOCALES.map((option) => (
        <a
          key={option}
          href={localePath(option, pathname)}
          /* The endonym is in that language, so it is marked as being in that language. */
          lang={option}
          hrefLang={option}
          className={option === locale ? 'site__lang site__lang--on' : 'site__lang'}
          aria-current={option === locale ? 'page' : undefined}
        >
          {siteLocaleLabel(option)}
        </a>
      ))}
    </nav>
  );
}

function Landing({ locale, copy }: { locale: string; copy: SiteCopy }) {
  /*
   * One `<main>`, and each section owns its own container.
   *
   * The whole page used to sit inside a single centred column, which meant no section could reach
   * the edges of the window — so every band had the same width, the same ground, and the page read
   * as one long beige field with rules across it. A quiet page is not the same as a flat one.
   */
  return (
    <main className="site__flow" id="main" tabIndex={-1}>
      <section className="hero-band">
        <div className="site__inner hero">
          <div className="hero__words">
            <p className="hero__eyebrow">{copy.hero.eyebrow}</p>
            <h1 className="hero__title">{copy.hero.title}</h1>
            <p className="hero__body">{copy.hero.body}</p>
            <div className="hero__actions">
              {/* The demo is the app, which has its own language picker and no locale prefix. */}
              <a className="button" href="/login">
                {copy.chrome.openTheDemo}
              </a>
              <a className="button button--quiet" href="#features">
                {copy.hero.secondary}
              </a>
            </div>
          </div>

          {/*
            The mark, folding, at the size it was drawn for.

            A stock photograph of somebody at a laptop would say nothing this page does not already
            say in words. The fold says the one thing worth saying without words: this is paper, and
            it is being made into something.

            ## Why this is a `<picture>` and not the `<Mark>` component

            The rendered loop is the real toy — shaded paper turning in three dimensions — and the
            vector mark is its flat first frame. The hero is the one place worth paying for the
            former, so this is the brand's own 256px animation rather than eight CSS triangles.

            It has to work with **no JavaScript**. `main.tsx` deliberately never hydrates this tree
            in production: the site is server-rendered, has no state and moves with CSS, so a React
            effect here would run in development and be dead on the live page — which is the exact
            shape of bug this codebase keeps writing comments about.

            So reduced motion is honoured by the `media` attribute rather than by an effect, and
            that is not a workaround, it is the better mechanism. A `<source>` whose query does not
            match is **never fetched**, so somebody who asked for less motion does not quietly
            download 673 KB of animation for it to be hidden — the motion layer is genuinely absent
            rather than merely invisible.

            No cross-fade between the two. The animation's first frame is the poster, so there is
            nothing to hide; fading would invent a transition the object does not have.

            `width` and `height` are the intrinsic size and stop the figure collapsing before the
            image arrives — this is the only element on the page large enough to cost real layout
            shift. Browsers stop decoding an animated image once it scrolls out of view, so the
            "pause offscreen" requirement is the browser's rather than ours to implement.
          */}
          <div className="hero__figure">
            {/*
              A pause control, with no script.

              WCAG 2.2.2: anything that moves for more than five seconds needs a way to stop it,
              and honouring `prefers-reduced-motion` is not that — it is a setting most people
              never find. A checkbox is the one stateful control HTML has without JavaScript, and
              `:checked` is enough CSS to swap the loop for its own first frame. The control is
              hidden when reduced motion is on, because there is nothing left to pause.

              Outside the `aria-hidden` wrapper, so a screen reader can reach the one thing here
              that does something, and not the decoration it acts on.
            */}
            <input type="checkbox" id="hero-pause" className="hero__pause visually-hidden" />
            <div className="hero__art" aria-hidden="true">
              <picture>
                {/*
                The retina variant is gated to desktop widths, not offered by density alone.

                `2x` on its own would hand a 997 KB animation to any phone with a retina screen,
                which is most of them, on the connection least able to take it — and the mark is
                256 CSS px there against 304 on desktop, so it buys the least where it costs the
                most. Above 900px the figure is larger, the connection is usually not a phone's,
                and the sharpness is visible.
              */}
                <source
                  media="(prefers-reduced-motion: no-preference) and (min-width: 1200px)"
                  srcSet="/mark-loop-256.webp 1x, /mark-loop-512.webp 2x"
                  type="image/webp"
                />
                {/*
                And the animation itself stops at 700px, so a phone never fetches it.

                This source used to have no width gate at all, which meant every phone without a
                reduced-motion preference downloaded 505 KB of WebP — on the connection least able
                to carry it, for a decoration 256 CSS px wide. The 2x variant was gated and the
                animation was not, which is the half of the problem that is easy to miss: the
                expensive file was the *cheap-sounding* one.

                A `<source>` whose query does not match is never fetched, so below 700px the
                animation is genuinely absent rather than hidden, and the poster below — 17 KB —
                is what a phone gets. Measured: 505 KB to 17 KB on every phone landing.

                700px rather than the 900px above it, deliberately. 900 would have collapsed these
                two sources into one and taken the animation off tablets and small laptop windows
                too, which is not what was asked for and not where the bandwidth problem is. The
                gap between them — 700 to 899 — keeps the 1x loop, as it does today.

                `styles.css` hides the pause control under the same 700px, because a control for
                stopping something that does not move is worse than no control.
              */}
                <source
                  media="(prefers-reduced-motion: no-preference) and (min-width: 700px)"
                  srcSet="/mark-loop-256.webp"
                  type="image/webp"
                />
                <img
                  className="hero__mark"
                  src="/mark-poster-256.png"
                  width={256}
                  height={256}
                  alt=""
                  decoding="async"
                />
              </picture>
              {/* The still, shown in place of the loop while paused. Same file as the poster. */}
              <img
                className="hero__mark hero__still"
                src="/mark-poster-256.png"
                width={256}
                height={256}
                alt=""
                loading="lazy"
              />
            </div>
            <label className="hero__pauseLabel" htmlFor="hero-pause">
              <span className="hero__pauseLabel--playing">{copy.hero.pause}</span>
              <span className="hero__pauseLabel--paused">{copy.hero.play}</span>
            </label>
          </div>
        </div>
      </section>

      <section className="site__section" id="features">
        <div className="site__inner">
          <p className="site__eyebrow">{copy.sections.featuresEyebrow}</p>
          <h2 className="site__sectionTitle">{copy.sections.featuresTitle}</h2>
          <div className="cards">
            {FEATURE_SLUGS.map((slug) => (
              <a
                className="feature-card rise"
                key={slug}
                href={localePath(locale, `/features/${slug}`)}
              >
                <span className="feature-card__mark" aria-hidden="true">
                  <Icon name={FEATURE_ICONS[slug]} />
                </span>
                <strong>{copy.features[slug].name}</strong>
                <span className="muted small">{copy.features[slug].summary}</span>
                {/* The link is named by its title and summary; "Read more" six times over is noise to a reader. */}
                <span className="feature-card__more" aria-hidden="true">
                  {copy.sections.readMore} <Icon name="arrow-right" />
                </span>
              </a>
            ))}
          </div>
        </div>
      </section>

      {/*
        The one dark band on the page.

        Not decoration: it is where somebody else is talking rather than us, and giving that its own
        ground is the cheapest way to say so. It also breaks a long page into parts, which is most
        of what "crisp" means on a page with no photographs in it.
      */}
      <section className="site__band">
        <div className="site__inner">
          <p className="site__eyebrow">{copy.sections.quotesEyebrow}</p>
          <h2 className="site__sectionTitle">{copy.sections.quotesTitle}</h2>
          <div className="quotes">
            {copy.quotes.map((quote) => (
              <figure className="quote" key={quote.who}>
                <blockquote>{quote.text}</blockquote>
                {/*
                  A role, not a person. Inventing a name and a face for a testimonial is the one
                  thing on a landing page that is straightforwardly a lie.
                */}
                <figcaption className="small">{quote.who}</figcaption>
              </figure>
            ))}
          </div>
        </div>
      </section>

      <section className="site__section site__cta">
        <div className="site__inner">
          <div className="site__ctaPanel">
            <h2 className="site__sectionTitle">{copy.sections.ctaTitle}</h2>
            <p className="muted">{copy.sections.ctaBody}</p>
            <div className="site__ctaActions">
              <a className="button" href="/login">
                {copy.chrome.openTheDemo}
              </a>
              {/*
                The way onward for somebody the demo has convinced. The page sold a demo three
                times and offered nowhere to go afterwards; this is where.
              */}
              <a className="button button--quiet" href={localePath(locale, '/contact')}>
                {copy.contact.link}
              </a>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

function FeaturePage({
  slug,
  locale,
  copy,
}: {
  slug: FeatureSlug;
  locale: string;
  copy: SiteCopy;
}) {
  const feature = copy.features[slug];

  return (
    <main className="site__main" id="main" tabIndex={-1}>
      <article className="site__article">
        <a className="site__back" href={localePath(locale)}>
          <Icon name="arrow-left" /> {copy.featurePage.back}
        </a>

        <span className="feature-card__mark feature__mark" aria-hidden="true">
          <Icon name={FEATURE_ICONS[slug]} />
        </span>
        <h1>{feature.name}</h1>
        <p className="site__lede">{feature.intro}</p>

        <div className="site__points">
          {feature.points.map((point) => (
            <section className="rise" key={point.heading}>
              <h2>{point.heading}</h2>
              <p>{point.body}</p>
            </section>
          ))}
        </div>

        {/* The same two doors as the closing panel: a feature page had no action in it at all. */}
        <div className="site__pointsActions">
          <a className="button" href="/login">
            {copy.chrome.openTheDemo}
          </a>
          <a className="button button--quiet" href={localePath(locale, '/contact')}>
            {copy.contact.link}
          </a>
        </div>

        {/* Somewhere to go next, so a feature page is not a dead end. */}
        <nav className="site__more" aria-label={copy.featurePage.otherFeatures}>
          {FEATURE_SLUGS.filter((other) => other !== slug)
            .slice(0, 3)
            .map((other) => (
              <a key={other} href={localePath(locale, `/features/${other}`)}>
                <Icon name={FEATURE_ICONS[other]} /> {copy.features[other].name}
              </a>
            ))}
        </nav>
      </article>
    </main>
  );
}

/**
 * The page for an address the site does not have.
 *
 * Shaped like a feature page rather than an error: the same chrome, a heading that says what
 * happened, and every feature as a link — because somebody who mistyped `/features/event` wanted
 * one of these, and a page that lists them is more use than one that apologises. The server sends
 * it as a 404; see `entry-server.tsx`.
 */
function NotFoundPage({ locale, copy }: { locale: string; copy: SiteCopy }) {
  return (
    <main className="site__main" id="main" tabIndex={-1}>
      <article className="site__article">
        <a className="site__back" href={localePath(locale)}>
          <Icon name="arrow-left" /> {copy.featurePage.backToAll}
        </a>
        <span className="feature-card__mark feature__mark" aria-hidden="true">
          <Icon name="search" />
        </span>
        <h1>{copy.notFound.title}</h1>
        <p className="site__lede">{copy.notFound.body}</p>
        <nav className="site__more" aria-label={copy.featurePage.otherFeatures}>
          {FEATURE_SLUGS.map((slug) => (
            <a key={slug} href={localePath(locale, `/features/${slug}`)}>
              <Icon name={FEATURE_ICONS[slug]} /> {copy.features[slug].name}
            </a>
          ))}
        </nav>
      </article>
    </main>
  );
}

/**
 * The "get in touch" form, which posts with no script.
 *
 * A plain `<form method="post">` to the API, `application/x-www-form-urlencoded`, answered with a
 * 303 to the thank-you page below in the visitor's language — the hidden `next` carries that path
 * and the server holds it to one shape. `website` is the honeypot: no person sees it, a bot fills
 * it, and the server answers a filled one with the same redirect so nothing is learned.
 */
function ContactPage({ locale, copy }: { locale: string; copy: SiteCopy }) {
  const c = copy.contact;
  return (
    <main className="site__main" id="main" tabIndex={-1}>
      <article className="site__article">
        <a className="site__back" href={localePath(locale)}>
          <Icon name="arrow-left" /> {copy.featurePage.back}
        </a>
        <h1>{c.title}</h1>
        <p className="site__lede">{c.lede}</p>

        <form className="site__form" method="post" action="/api/public/contact">
          <input type="hidden" name="next" value={localePath(locale, '/contact/sent')} />
          <label className="field">
            <span>{c.name}</span>
            <input name="name" required maxLength={120} autoComplete="name" />
          </label>
          <label className="field">
            <span>{c.organisation}</span>
            <input name="organisation" maxLength={120} autoComplete="organization" />
          </label>
          <label className="field">
            <span>{c.email}</span>
            <input name="email" type="email" required maxLength={254} autoComplete="email" />
          </label>
          <label className="field">
            <span>{c.message}</span>
            <textarea name="message" required maxLength={4000} rows={6} />
          </label>
          {/* The honeypot. Out of the accessibility tree too: it is nobody's field. */}
          <label className="visually-hidden" aria-hidden="true">
            <span>website</span>
            <input name="website" tabIndex={-1} autoComplete="off" />
          </label>
          <button className="button" type="submit">
            {c.send}
          </button>
        </form>
      </article>
    </main>
  );
}

function ContactSentPage({ locale, copy }: { locale: string; copy: SiteCopy }) {
  return (
    <main className="site__main" id="main" tabIndex={-1}>
      <article className="site__article">
        <a className="site__back" href={localePath(locale)}>
          <Icon name="arrow-left" /> {copy.featurePage.back}
        </a>
        <h1>{copy.contact.sentTitle}</h1>
        <p className="site__lede">{copy.contact.sentBody}</p>
      </article>
    </main>
  );
}

function SiteFooter({ locale, copy }: { locale: string; copy: SiteCopy }) {
  return (
    <footer className="site__foot">
      <div className="site__inner site__footInner">
        <p className="muted small">{copy.chrome.footerTagline}</p>
        {/*
          These belong in the footer because that is where people look for them, and a service that
          hides its privacy page is telling you something about the page.

          They stay English in every language, and say so. `CLAUDE.md` rule 8 forbids generating
          legal wording, and a machine-translated privacy policy is the worst possible instance of
          that rule being broken — so the policies are English until a lawyer writes them in another
          language. `lang` marks the switch honestly rather than hiding it: a screen reader changes
          voice, and a sighted reader can see before clicking that this one link leaves their
          language. A translated *title* over an English page would be the dishonest version.
        */}
        <nav className="site__footNav" aria-label={copy.chrome.policiesNavLabel}>
          <a href={localePath(locale, '/contact')}>{copy.contact.link}</a>
          {LEGAL_DOCUMENTS.map((document) => (
            <a
              key={document.slug}
              href={localePath(locale, `/${document.slug}`)}
              lang={SITE_DEFAULT_LOCALE}
            >
              {document.title}
            </a>
          ))}
        </nav>
        <SiteLanguages locale={locale} copy={copy} place="foot" />
      </div>
    </footer>
  );
}

/**
 * A policy page.
 *
 * One renderer for all five, because they differ in words rather than in shape, and five hand-built
 * pages is five places for the wording to drift out of step with the software it describes.
 *
 * English in every locale, deliberately — see the footer. The page marks itself so, which is what
 * stops a German-language document announcing itself as German while reading as English.
 */
function LegalPage({
  document,
  locale,
  copy,
}: {
  document: LegalDocument;
  locale: string;
  copy: SiteCopy;
}) {
  return (
    <main className="site__main" id="main" tabIndex={-1} lang={SITE_DEFAULT_LOCALE}>
      <article className="site__article legal">
        <a className="site__back" href={localePath(locale)} lang={locale}>
          <Icon name="arrow-left" /> {copy.featurePage.back}
        </a>
        <h1>{document.title}</h1>
        <p className="site__lede">{document.lede}</p>
        <p className="muted small">Last reviewed {document.updated}</p>

        {document.sections.map((section) => (
          <section className="legal__section" key={section.heading}>
            <h2>{section.heading}</h2>
            {section.body.map((paragraph) => (
              <p key={paragraph}>{withPending(paragraph)}</p>
            ))}
            {section.rows ? (
              <dl className="legal__rows">
                {section.rows.map(([term, description]) => (
                  <div className="legal__row" key={term}>
                    <dt>{term}</dt>
                    <dd>{withPending(description)}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </section>
        ))}
      </article>
    </main>
  );
}

/**
 * Renders a missing fact as a visible marker rather than as text that reads like an answer.
 *
 * The whole point of `pending()` is that an unfinished page looks unfinished. Rendering the marker
 * as ordinary prose would defeat it, and a sensible-looking default would defeat it worse.
 */
function withPending(text: string) {
  const parts = text.split(PENDING_PATTERN);
  return parts.map((part, index) =>
    index % 2 === 1 ? (
      <mark className="pending" key={`${part}-${index}`}>
        to be confirmed: {part}
      </mark>
    ) : (
      part
    ),
  );
}
