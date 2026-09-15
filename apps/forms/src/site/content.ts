import type { IconName } from '../components/Icon.js';

/**
 * The public site's shape. Its words live in `copy/`, one file per language.
 *
 * ## Why this is no longer English literals
 *
 * It used to be, and said so: *"This is English only, deliberately, and that is a gap. The product
 * ships in twelve languages; its own site does not yet."* This is that gap being closed the way
 * that note asked for — the same treatment the invoice and admission copy already have, a column
 * per language with a test that fails on a missing one.
 *
 * ## What is here and what is in `copy/`
 *
 * Structure is here; text is there. A feature's `slug` is a URL and its `icon` is a drawing —
 * neither is translated, and repeating them in every language file is five chances to mistype an
 * icon name. So the slugs and icons are declared once, and each locale supplies only words, keyed
 * by the same slugs. `SiteCopy` then makes a missing feature a **compile** error rather than a
 * blank page, which is the property the app's message catalogues have and the reason they have not
 * drifted.
 */

/**
 * The six pages under `/features/`, in the order the landing page lists them.
 *
 * A tuple rather than an array so `FeatureSlug` is the union of exactly these and a language file
 * cannot invent a seventh or forget one.
 */
export const FEATURE_SLUGS = [
  'forms',
  'events',
  'responses',
  'brand',
  'languages',
  'ledger',
] as const;

export type FeatureSlug = (typeof FEATURE_SLUGS)[number];

/** The drawing for each feature. Not translated, so it is declared once. */
export const FEATURE_ICONS: Record<FeatureSlug, IconName> = {
  forms: 'forms',
  events: 'events',
  responses: 'inbox',
  brand: 'brand',
  languages: 'globe',
  ledger: 'archive',
};

export interface FeatureCopy {
  name: string;
  /** One line, on the landing page card. */
  summary: string;
  /** The opening paragraph of the feature's own page. */
  intro: string;
  /** Exactly three, so the six pages have the same shape as each other in every language. */
  points: readonly [Point, Point, Point];
}

export interface Point {
  heading: string;
  body: string;
}

/**
 * Everything the site says, in one language.
 *
 * Every field is required. That is the whole mechanism: a new language is a file the compiler
 * refuses until it is finished, so "half-translated" is not a state this site can be in.
 */
export interface SiteCopy {
  /** The document head, per page. Feature pages build their own from `features`. */
  meta: {
    homeTitle: string;
    homeDescription: string;
    /** Appended to a feature's name to make its `<title>`. */
    titleSuffix: string;
  };
  chrome: {
    skipToContent: string;
    siteNavLabel: string;
    policiesNavLabel: string;
    languageLabel: string;
    openTheDemo: string;
    footerTagline: string;
  };
  hero: {
    eyebrow: string;
    title: string;
    body: string;
    /** The secondary action is an in-page anchor, so only its label is here. */
    secondary: string;
    /** The one control on the page: stop the folding mark, and start it again. */
    pause: string;
    play: string;
  };
  sections: {
    featuresEyebrow: string;
    featuresTitle: string;
    readMore: string;
    quotesEyebrow: string;
    quotesTitle: string;
    ctaTitle: string;
    ctaBody: string;
  };
  featurePage: {
    /** Back to the landing page's feature list. */
    backToAll: string;
    back: string;
    otherFeatures: string;
  };
  /** The page for an address the site does not have. Served as a 404, in the visitor's language. */
  notFound: {
    title: string;
    body: string;
  };
  features: Record<FeatureSlug, FeatureCopy>;
  quotes: readonly [Quote, Quote, Quote];
}

/** Attributed to roles rather than to invented people — see the landing page. */
export interface Quote {
  text: string;
  who: string;
}
