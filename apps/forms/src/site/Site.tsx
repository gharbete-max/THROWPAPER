import { Link, Route, Routes } from 'react-router';
import { FEATURES, HERO, QUOTES, type Feature } from './content.js';
import { LEGAL_DOCUMENTS, PENDING_PATTERN, type LegalDocument } from './legal.js';
import { Icon } from '../components/Icon.js';
import { Logo } from '../components/Logo.js';
import { Mark } from '../components/Mark.js';

/**
 * The public site: a landing page and one page per thing the product does.
 *
 * ## Why this is a separate tree from the app
 *
 * It renders on the server, and the app cannot. The app is behind a bearer token held in
 * `localStorage`, fetches a brand kit and a session before it can draw anything, and is read by
 * exactly one person who is already signed in — there is no crawler to serve and no first paint to
 * win. Server-rendering it would mean teaching the server to be signed in as somebody.
 *
 * These pages have the opposite shape: no session, no fetch, no state. They are a pure function of
 * `content.ts`, which is what makes `renderToString` on them trivial and what makes them worth
 * rendering at all — this is the surface a search engine and a link preview actually read.
 *
 * So the two trees stay apart. `entry-server.tsx` renders this one; `main.tsx` hydrates it where
 * the server has already drawn it, and mounts the app everywhere else.
 */
export function Site() {
  return (
    <div className="site system">
      <SiteHeader />
      <Routes>
        <Route path="/" element={<Landing />} />
        {FEATURES.map((feature) => (
          <Route
            key={feature.slug}
            path={`/features/${feature.slug}`}
            element={<FeaturePage feature={feature} />}
          />
        ))}
        {LEGAL_DOCUMENTS.map((document) => (
          <Route
            key={document.slug}
            path={`/${document.slug}`}
            element={<LegalPage document={document} />}
          />
        ))}
      </Routes>
      <SiteFooter />
    </div>
  );
}

function SiteHeader() {
  return (
    <header className="site__bar">
      <Link className="site__mark" to="/">
        <Logo />
        <strong>Formwork</strong>
      </Link>

      <nav className="site__nav" aria-label="Site">
        {/*
          Two of the six, not all of them. A bar that lists every page is a table of contents; the
          landing page already has one, further down, with a sentence each.
        */}
        <Link to="/features/forms">Forms</Link>
        <Link to="/features/events">Events</Link>
        <Link to="/features/languages">Languages</Link>
      </nav>

      <Link className="button" to="/login">
        Open the demo
      </Link>
    </header>
  );
}

function Landing() {
  /*
   * One `<main>`, and each section owns its own container.
   *
   * The whole page used to sit inside a single centred column, which meant no section could reach
   * the edges of the window — so every band had the same width, the same ground, and the page read
   * as one long beige field with rules across it. A quiet page is not the same as a flat one.
   */
  return (
    <main className="site__flow">
      <section className="hero-band">
        <div className="site__inner hero">
          <div className="hero__words">
            <p className="hero__eyebrow">{HERO.eyebrow}</p>
            <h1 className="hero__title">{HERO.title}</h1>
            <p className="hero__body">{HERO.body}</p>
            <div className="hero__actions">
              <Link className="button" to={HERO.primary.href}>
                {HERO.primary.label}
              </Link>
              <a className="button button--quiet" href={HERO.secondary.href}>
                {HERO.secondary.label}
              </a>
            </div>
          </div>

          {/*
            The mark, folding, at the size it was drawn for.

            A stock photograph of somebody at a laptop would say nothing this page does not already
            say in words. The fold says the one thing worth saying without words: this is paper, and
            it is being made into something.
          */}
          <div className="hero__figure" aria-hidden="true">
            <Mark mode="intro" className="hero__mark" />
          </div>
        </div>
      </section>

      <section className="site__section" id="features">
        <div className="site__inner">
          <p className="site__eyebrow">Everything it does</p>
          <h2 className="site__sectionTitle">Built for the day it is used</h2>
          <div className="cards">
            {FEATURES.map((feature) => (
              <Link
                className="feature-card rise"
                key={feature.slug}
                to={`/features/${feature.slug}`}
              >
                <span className="feature-card__mark" aria-hidden="true">
                  <Icon name={feature.icon} />
                </span>
                <strong>{feature.name}</strong>
                <span className="muted small">{feature.summary}</span>
                <span className="feature-card__more">
                  Read more <Icon name="arrow-right" />
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/*
        The one dark band on the page.

        Not decoration: it is where somebody else is talking rather than us, and giving that its own
        ground is the cheapest way to say so. It also breaks a long parchment page into parts, which
        is most of what "crisp" means on a page with no photographs in it.
      */}
      <section className="site__band">
        <div className="site__inner">
          <p className="site__eyebrow">In use</p>
          <h2 className="site__sectionTitle">What people said afterwards</h2>
          <div className="quotes">
            {QUOTES.map((quote) => (
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
            <h2 className="site__sectionTitle">Nothing to install</h2>
            <p className="muted">
              The demo runs on made-up data, sends no email, and forgets everything when it
              restarts.
            </p>
            <Link className="button" to="/login">
              Open the demo
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}

function FeaturePage({ feature }: { feature: Feature }) {
  return (
    <main className="site__main">
      <article className="site__article">
        <Link className="site__back" to="/">
          <Icon name="arrow-left" /> Everything it does
        </Link>

        <span className="feature-card__mark feature__mark" aria-hidden="true">
          <Icon name={feature.icon} />
        </span>
        <h1>{feature.name}</h1>
        <p className="site__lede">{feature.intro}</p>

        <div className="site__points">
          {feature.points.map((point) => (
            <section className="rise" key={point.heading}>
              <h2>{point.heading}</h2>
              <p className="muted">{point.body}</p>
            </section>
          ))}
        </div>

        {/* Somewhere to go next, so a feature page is not a dead end. */}
        <nav className="site__more" aria-label="Other features">
          {FEATURES.filter((other) => other.slug !== feature.slug)
            .slice(0, 3)
            .map((other) => (
              <Link key={other.slug} to={`/features/${other.slug}`}>
                <Icon name={other.icon} /> {other.name}
              </Link>
            ))}
        </nav>
      </article>
    </main>
  );
}

function SiteFooter() {
  return (
    <footer className="site__foot">
      <div className="site__inner site__footInner">
        <p className="muted small">
          Formwork. Forms, registrations and the door. The demo saves nothing and sends nothing.
        </p>
        {/*
          These belong in the footer because that is where people look for them, and a service that
          hides its privacy page is telling you something about the page.
        */}
        <nav className="site__footNav" aria-label="Policies">
          {LEGAL_DOCUMENTS.map((document) => (
            <Link key={document.slug} to={`/${document.slug}`}>
              {document.title}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  );
}

/**
 * A policy page.
 *
 * One renderer for all five, because they differ in words rather than in shape, and five hand-built
 * pages is five places for the wording to drift out of step with the software it describes.
 */
function LegalPage({ document }: { document: LegalDocument }) {
  return (
    <main className="site__main">
      <article className="site__article legal">
        <Link className="site__back" to="/">
          <Icon name="arrow-left" /> Back
        </Link>
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
