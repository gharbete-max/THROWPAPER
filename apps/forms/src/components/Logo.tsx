import { useState } from 'react';
import { Mark } from './Mark.js';
import { useBrand } from '../lib/brand.js';

/**
 * The mark alone, in Paloppa's colours, with no idea whose page it is on.
 *
 * Deliberately dumb. The marketing site renders this and is never hydrated in production, so
 * anything here that read context or state would work in development and be inert on the live
 * page. It is also the right component for that surface on its own terms: the marketing site is
 * ours, and a white-label customer's members never see it.
 *
 * `Wordmark` below is the one that knows about client mode.
 */
export function Logo() {
  // `logo` carries the sizing; without it the image fills whatever it is put in.
  return <Mark className="logo" />;
}

/**
 * The corner lockup: whose product this is, said once, in the top bar and on the sign-in screen.
 *
 * ## What client mode changes
 *
 * With it off, this is our mark and the name the caller passed — which for the app shell is
 * already the *organisation's* name, because the top bar has always said who you are signed in as
 * rather than what software you are using.
 *
 * With it on, the mark is replaced by the customer's own logo. Not tinted, not cropped, not put in
 * a container, not given the glass treatment: it is their asset, and the only thing done to it is
 * deciding how tall it is.
 *
 * ## Two files, chosen by CSS rather than by JavaScript
 *
 * A logo drawn for a light page is often illegible on a dark one, and inverting it produces
 * garbage more often than not — a wordmark with one coloured glyph comes out with that glyph wrong
 * and nothing else changed. So a dark variant is asked for rather than computed, and when only one
 * is supplied it is used on both. That is the honest failure: the customer sees their own logo on
 * a dark preview and can decide whether it needs a second file.
 *
 * The choice is made in CSS because this product's theme has three states, not two.
 * `prefers-color-scheme` is the operating system's opinion and `data-theme` is the person's, and
 * the person's must win in both directions — a `<picture>` element can only hear the first.
 * `toThemedCssBlock` resolves the palette the same way, for the same reason.
 *
 * ## When the logo does not arrive
 *
 * The name alone, which is a real lockup rather than a fallback that looks broken. A customer's
 * asset can 404 after somebody clears an upload, and a corner with a broken-image icon is worse
 * than a corner with a word in it. It is also what a text-only email client shows, so the two
 * surfaces degrade the same way.
 */
export function Wordmark({ name }: { name: string }) {
  const { tokens } = useBrand();
  const [logoFailed, setLogoFailed] = useState(false);

  const label = tokens.clientMode ? (tokens.wordmark ?? name) : name;

  /* Either file standing in for a missing other: one logo on both themes beats none on one. */
  const light = tokens.logoLight ?? tokens.logoDark;
  const dark = tokens.logoDark ?? tokens.logoLight;
  const clientLogo = tokens.clientMode && light !== null && dark !== null && !logoFailed;

  return (
    <span className="wordmark">
      {clientLogo ? (
        <span className="lockup">
          {/*
            `alt` is empty on both, and the name beside them is the accessible label. The
            alternative — the company name on each — is a screen reader saying it three times: once
            per theme variant and once for the text that is already there.
          */}
          <img
            className="lockup__logo lockup__logo--light"
            src={light}
            alt=""
            onError={() => setLogoFailed(true)}
          />
          <img
            className="lockup__logo lockup__logo--dark"
            src={dark}
            alt=""
            onError={() => setLogoFailed(true)}
          />
        </span>
      ) : (
        /* Our mark, unless this is a white-label page — where showing it is the whole failure. */
        !tokens.clientMode && <Logo />
      )}
      <strong>{label}</strong>
    </span>
  );
}
