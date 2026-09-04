import type { IconName } from '../components/Icon.js';

/**
 * The public site's words.
 *
 * ## Why these are literals and the app's are not
 *
 * `CLAUDE.md` rule 4 keeps user-facing strings in `packages/i18n`, and that rule is about the
 * **product**: an operator picks a language and every button follows. This is marketing copy, and
 * it behaves like a template's text rather than like a label — it is written, not translated on
 * the fly, and a half-translated sentence about why the ledger cannot be edited is worse than an
 * English one.
 *
 * It is data rather than JSX for the same reason the templates are: one shape, one place, and a
 * translation pass later is a matter of adding a second column rather than editing markup.
 *
 * **This is English only, deliberately, and that is a gap.** The product ships in twelve
 * languages; its own site does not yet. Doing it properly means the same twelve-column treatment
 * the templates and the email copy got, and it should be a decision rather than something that
 * happens by accident.
 */

export interface Feature {
  /** The URL segment, and the anchor the landing page links to. */
  slug: string;
  icon: IconName;
  name: string;
  /** One line, on the landing page card. */
  summary: string;
  /** The opening paragraph of the feature's own page. */
  intro: string;
  points: ReadonlyArray<{ heading: string; body: string }>;
}

export const FEATURES: readonly Feature[] = [
  {
    slug: 'forms',
    icon: 'forms',
    name: 'The form builder',
    summary:
      'Seventeen field types, conditions that actually branch, and a preview that is the form.',
    intro:
      'Drag a field in, write the question, see it. The preview beside the canvas is the same renderer a respondent gets, not an approximation of it, so what you are looking at while you build is what they will fill in.',
    points: [
      {
        heading: 'Seventeen kinds of question',
        body: 'Text, numbers, dates and times, single and multiple choice, ratings, files, signatures. Then decoration: shapes and freehand drawing that collect nothing and never appear in the export.',
      },
      {
        heading: 'Conditions that cannot loop',
        body: 'A question can depend on an answer above it and only above it. Forward references are refused, which is what makes a cycle impossible by construction rather than by a checker that runs too late.',
      },
      {
        heading: 'Twenty-three templates',
        body: 'Events, services, education, retail, membership, workplace, governance and research, each complete in all twelve languages. A template that copies English into a Finnish form is not a starting point.',
      },
    ],
  },
  {
    slug: 'events',
    icon: 'events',
    name: 'Events and the door',
    summary:
      'Registration, an admission card people can print, and a check-in screen for the entrance.',
    intro:
      'An event is a form with a date, a capacity and a door. Everything after the registration, from the confirmation to the person scanning a card at the entrance, is the part that usually gets improvised. So it is built in.',
    points: [
      {
        heading: 'An admission card that scans',
        body: 'A PDF with the event details and a QR code carrying a signed token. Four modules of quiet zone and error correction at the level printed codes need, so a crease through the symbol still reads at a door in December.',
      },
      {
        heading: 'A screen for the entrance',
        body: 'Large type, a big input, and a verdict you can read at arm’s length. Built to be held in one hand at a door on a venue’s bad wifi.',
      },
      {
        heading: 'Capacity that means something',
        body: 'A full event closes itself. A waiting list is a decision you make, not a state you discover.',
      },
    ],
  },
  {
    slug: 'responses',
    icon: 'inbox',
    name: 'Answers',
    summary:
      'Everything that arrives, in one place, exportable without losing what the numbers meant.',
    intro:
      'Responses land in an inbox and a grid. The grid sorts on the value rather than on the text you see, so a numeric column sorts numerically and a Swedish name column sorts the way Swedish sorts.',
    points: [
      {
        heading: 'Exports that survive a spreadsheet',
        body: 'A CSV column per answerable field, named by the field key. Decoration is not a column; a shape you drew changes nothing about the file.',
      },
      {
        heading: 'Sorting that knows the language',
        body: 'ICU collation, so å ä ö come after z in Swedish and æ ø å sort the way Danish and Norwegian expect. Not a byte comparison wearing a locale’s name.',
      },
      {
        heading: 'Nothing sends without a confirmation',
        body: 'Every outbound action has a test mode and a step that asks. An email that goes to four hundred people should take two deliberate clicks.',
      },
    ],
  },
  {
    slug: 'brand',
    icon: 'brand',
    name: 'Your colours, everywhere',
    summary:
      'One palette compiled to the app, the email, the PDF and a dark mode nobody had to draw.',
    intro:
      'A brand kit here is not a stylesheet with your logo in it. It is one set of tokens compiled to four targets, so the form on screen, the confirmation email, the printed admission card and a future native app are the same brand rather than four approximations of it.',
    points: [
      {
        heading: 'Dark mode you did not author',
        body: 'The dark palette is derived from the light one, keeping each colour’s hue rather than walking it toward grey. Every organisation has a dark theme the day it ships, including the ones who set their colours a year ago.',
      },
      {
        heading: 'Contrast checked while you choose',
        body: 'The warning appears as you pick a colour, not after you save. A warning that arrives after you have committed is a reprimand rather than help.',
      },
      {
        heading: 'Scales from one number',
        body: 'Set one radius and get a family; one text size and a ratio and get a scale. Nothing to keep in step, and nothing new to understand.',
      },
    ],
  },
  {
    slug: 'languages',
    icon: 'globe',
    name: 'Twelve languages',
    summary: 'The interface, the templates, the emails and the printed card, not just the buttons.',
    intro:
      'English, Swedish, Danish, Norwegian, Finnish, Icelandic, French, German, Spanish, Chinese, Japanese and Russian. The interface is one language at a time and that is a personal setting; a form is a document and can offer its own switcher.',
    points: [
      {
        heading: 'Including the parts that arrive later',
        body: 'The confirmation email and the admission card are written in the language the form was filled in, and say so in their own markup, so a screen reader reads a Japanese email in Japanese.',
      },
      {
        heading: 'Publishing is blocked on a missing translation',
        body: 'A form that claims two languages and has one is not ready. The completeness check is the same code in the editor and at the endpoint, so it cannot disagree with itself.',
      },
      {
        heading: 'Plurals and collation, not string concatenation',
        body: 'Counts read correctly in languages with more than two plural forms, and lists sort by the rules of the language rather than by code point.',
      },
    ],
  },
  {
    slug: 'ledger',
    icon: 'archive',
    name: 'A ledger you cannot edit',
    summary: 'Double entry, append only. A mistake is reversed, never quietly rewritten.',
    intro:
      'Fees, deposits and refunds recorded properly. There is no update and no delete anywhere in it: a wrong entry is corrected by a reversing entry that swaps the sides, so the original and the correction are both on the record.',
    points: [
      {
        heading: 'Exact arithmetic',
        body: 'Money is bigint minor units, never a float. A tenth of a penny that does not exist is not a rounding style, it is a bug with a long tail.',
      },
      {
        heading: 'Every fault at once',
        body: 'A posting that does not balance reports all of its problems rather than the first one, so fixing an entry is one pass rather than four.',
      },
      {
        heading: 'Reversal, not deletion',
        body: 'The thing that makes a ledger a ledger. Crossing something out and initialling it is the paper version of the same rule.',
      },
    ],
  },
];

/** Voices on the landing page. Attributed to roles rather than to invented people. */
export const QUOTES: ReadonlyArray<{ text: string; who: string }> = [
  {
    text: 'The admission cards scanned first time, in the rain, with a queue. That was the whole test.',
    who: 'Event organiser, spring general meeting',
  },
  {
    text: 'We publish in Swedish and English. It refuses to let me publish half of one, which has saved me twice.',
    who: 'Membership secretary',
  },
  {
    text: 'I changed one colour and the emails changed too. I had assumed that would be a support ticket.',
    who: 'Communications lead',
  },
];

export const HERO = {
  eyebrow: 'Forms, registrations and the door',
  title: 'Ask people things. Properly.',
  body: 'Twelve languages, your brand on every surface, and an admission card that scans at a door.',
  primary: { label: 'Open the demo', href: '/login' },
  secondary: { label: 'See what it does', href: '#features' },
} as const;
