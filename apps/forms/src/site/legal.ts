/**
 * The pages a service is expected to publish, written from what this one actually does.
 *
 * ## Why these are not boilerplate
 *
 * A generated privacy policy is worse than none: it describes a system nobody built, and the first
 * person to compare it against the software finds it wrong. Everything stated here was read out of
 * the code. The token lifetimes are the constants in `auth/tokens.ts`. The list of stored items is
 * every `localStorage` key the app writes. The claim that there are no third-party trackers is a
 * claim about an application with no external origins in it at all, which is unusual enough to be
 * worth stating plainly.
 *
 * ## What is deliberately missing
 *
 * `CLAUDE.md` rule 8: legal wording comes from a human. That rule is right, and the reason is
 * visible in the gaps below. A company's registered name, its organisation number, whether it has
 * appointed a data protection officer, how long it keeps a customer's data after they leave, and
 * where the database is hosted are facts about a business, not about a codebase. Inventing them
 * would produce a document that looks finished and is false in the parts that matter most.
 *
 * So they are `pending()`, which renders as a visible marker rather than as plausible text. A page
 * that is not finished should look unfinished. `LEGAL-REVIEW.md` lists every one of them.
 */

/**
 * A fact only a person can supply, rendered so it cannot be mistaken for one.
 *
 * The alternative was a sensible-looking default, and a sensible-looking default is how a
 * placeholder ships.
 */
export function pending(what: string): string {
  return `[[${what}]]`;
}

export const PENDING_PATTERN = /\[\[([^\]]+)\]\]/g;

export interface LegalSection {
  readonly heading: string;
  readonly body: readonly string[];
  /** Rendered as a definition list rather than prose, for anything that is really a table. */
  readonly rows?: readonly (readonly [string, string])[];
}

export interface LegalDocument {
  readonly slug: string;
  readonly title: string;
  readonly lede: string;
  /** Shown in the page's own header, so a reader can see whether they are reading a current copy. */
  readonly updated: string;
  readonly sections: readonly LegalSection[];
}

/** The day this text was last written. Not a build date: a build does not review wording. */
const UPDATED = '4 September 2026';

const CONTROLLER = pending('registered company name and organisation number');
const CONTACT = pending('contact address for privacy requests');

const ABOUT: LegalDocument = {
  slug: 'about',
  title: 'About Formwork',
  lede: 'A form builder for organisations that have to get a registration right the first time, in front of people, often at a door in bad weather.',
  updated: UPDATED,
  sections: [
    {
      heading: 'What it is for',
      body: [
        'Formwork is built for membership secretaries, event organisers and association treasurers. That audience decides everything about it. The people filling in a form are members, not customers, and they are often doing it once a year on a phone. The people running it are volunteers as often as they are staff.',
        'It is a general form and registration tool. Annual meetings are the case it was first built for, but nothing in it is specific to them.',
      ],
    },
    {
      heading: 'What we decided early',
      body: [
        'Twelve languages, in the interface and in everything it sends. A member who reads the form in Swedish should not get a confirmation email in English.',
        'One brand kit that reaches every surface. The colours an organisation picks apply to the app, the confirmation email and the printed admission card, because a registration page that does not look like the organisation is a registration page people distrust.',
        'A ledger that cannot be edited. Corrections are reversals, never quiet rewrites, because an association treasurer has to be able to show what happened.',
      ],
    },
    {
      heading: 'Who runs it',
      body: [
        `Formwork is operated by ${CONTROLLER}, registered at ${pending('registered address')}.`,
        `General enquiries: ${pending('general contact address')}.`,
      ],
    },
  ],
};

const FAQ: LegalDocument = {
  slug: 'faq',
  title: 'Questions',
  lede: 'The things people ask before they trust a form with somebody else’s name and address.',
  updated: UPDATED,
  sections: [
    {
      heading: 'Do people need an account to fill in a form?',
      body: [
        'No. A published form is a public page. Anyone with the link can complete it, and nothing is installed. Accounts exist only for the people who build forms and read the answers.',
      ],
    },
    {
      heading: 'Can somebody finish a form later?',
      body: [
        'Yes. A part-finished form can be saved, which produces a private link that lasts 30 days. Answers are kept against that link until it expires or the form is submitted.',
      ],
    },
    {
      heading: 'What happens at the door?',
      body: [
        'A registration produces an admission card with a reference and a QR code. The check-in screen reads either. Scanning the same card twice reports that the person has already arrived, with the time, rather than admitting them again.',
        'The check-in screen is installable and precaches itself, so it opens on a venue’s bad connection. It still needs a connection to check somebody in.',
      ],
    },
    {
      heading: 'Which languages does it publish in?',
      body: [
        'Danish, English, Finnish, French, German, Icelandic, Japanese, Norwegian, Russian, Spanish, Swedish and simplified Chinese. The interface, the templates, the emails and the printed card, not only the buttons.',
      ],
    },
    {
      heading: 'Can we use our own colours?',
      body: [
        'Yes, and they are compiled rather than copied. One palette produces the app’s styling, the inline styles an email client needs, the print stylesheet for the PDF, and a dark mode derived from the light one. Contrast is checked as a colour is chosen, not after it is saved.',
      ],
    },
    {
      heading: 'Where is the data?',
      body: [
        `Email is sent through Amazon SES in the eu-north-1 region, which is Stockholm, so recipient addresses stay in Sweden. The database is hosted at ${pending('database hosting provider and region')}.`,
      ],
    },
    {
      heading: 'Can we get our data out?',
      body: [
        'Yes. Responses export to CSV with a byte-order mark and a formula guard, so Excel opens them in the right encoding and does not execute a cell that begins with an equals sign. Numeric columns export as numbers rather than as formatted text.',
      ],
    },
    {
      heading: 'Does it track people?',
      body: [
        'No. There is no analytics, no advertising, no third-party script and no cookie. The storage page lists everything the application keeps on a device, which is five items, all of them either needed to keep somebody signed in or a setting they chose themselves.',
      ],
    },
  ],
};

const PRIVACY: LegalDocument = {
  slug: 'privacy',
  title: 'Privacy',
  lede: 'What is collected, why, for how long, and who else sees it.',
  updated: UPDATED,
  sections: [
    {
      heading: 'Two different roles, and the difference matters',
      body: [
        'For the answers people give to a form, the organisation that published the form is the controller. They decide what to ask and why. Formwork is their processor and acts on their instructions.',
        'For the accounts of the people who log in to build forms, Formwork is the controller.',
        'This is not a formality. If you filled in somebody’s registration form and want your answers removed, the organisation that published it is who decides, and they are named on the form. We act on their instruction.',
      ],
    },
    {
      heading: 'What is collected',
      body: [
        'Only what the software actually stores. Each item below corresponds to a column in the database rather than to a category of thing we might collect one day.',
      ],
      rows: [
        ['Account holders', 'Name and email address.'],
        [
          'Sign-in security',
          'The IP address a sign-in link was requested from, and the browser identification of a session, so a stolen session can be recognised and revoked.',
        ],
        [
          'Form responses',
          'Whatever the publishing organisation chose to ask, plus an email address where the form collects one. We do not choose these questions.',
        ],
        ['Uploads', 'Any file a respondent attaches, and its filename.'],
        ['Attendance', 'Whether a reference was checked in, and when.'],
        ['Administrative actions', 'Who changed what and when, with the IP address it came from.'],
      ],
    },
    {
      heading: 'How long it is kept',
      body: [
        'The lifetimes below are enforced by the software rather than by policy. They are the constants the code runs on.',
      ],
      rows: [
        ['Sign-in link', '15 minutes, and single use.'],
        ['Signed-in session', '15 minutes, renewed silently while in use.'],
        ['Stay-signed-in token', '30 days, rotated on every use.'],
        ['Link to a saved, unfinished form', '30 days.'],
        ['Link to a generated document', '1 hour.'],
        ['Form responses', pending('retention period for submitted responses')],
        ['Data after an account closes', pending('retention period after account closure')],
      ],
    },
    {
      heading: 'Who else processes it',
      body: [
        'Amazon Web Services, for sending email through Amazon SES in the eu-north-1 region, which is Stockholm. Recipient addresses and message content pass through that service.',
        `Hosting for the application and database: ${pending('hosting provider, region and data processing agreement reference')}.`,
        `Any further sub-processors: ${pending('complete sub-processor list')}.`,
        'There is no analytics provider, no advertising network and no third-party script in the application.',
      ],
    },
    {
      heading: 'Legal basis',
      body: [
        `The basis relied on for each purpose: ${pending('legal bases, confirmed with counsel, per processing purpose')}.`,
        'This is left for a person to complete rather than guessed at. The basis for processing an account holder’s data is a different question from the basis a publishing organisation relies on for its members, and only the first is ours to state.',
      ],
    },
    {
      heading: 'Your rights',
      body: [
        'Under the General Data Protection Regulation you may request access to your personal data, correction of it, erasure, restriction of processing, portability, and you may object to processing. Where processing rests on consent you may withdraw it at any time, which does not affect what was done before you did.',
        `Requests about an account: ${CONTACT}.`,
        'Requests about answers you gave to somebody’s form: contact the organisation that published it. They are named on the form itself, and they decide.',
        'If you believe your data is being handled unlawfully you may complain to the Swedish Authority for Privacy Protection, Integritetsskyddsmyndigheten (IMY), or to the supervisory authority where you live.',
      ],
    },
    {
      heading: 'Contact',
      body: [
        `Controller: ${CONTROLLER}.`,
        `Address: ${pending('registered address')}.`,
        `Privacy contact: ${CONTACT}.`,
        `Data protection officer: ${pending('DPO name and contact, or a statement that none is appointed')}.`,
      ],
    },
  ],
};

const COOKIES: LegalDocument = {
  slug: 'cookies',
  title: 'Cookies and storage',
  lede: 'There are no cookies. Five things are kept on your device, and this is all of them.',
  updated: UPDATED,
  sections: [
    {
      heading: 'No cookies, and that is not a figure of speech',
      body: [
        'This application sets no cookies at all. It loads no script from another domain, contacts no analytics service, and contains no advertising or tracking code. Nothing here follows you to another site, because there is nothing here that could.',
        'It does keep a small number of items in your browser’s local storage. Local storage is covered by the same rules as cookies, so it is listed in full below rather than left out on a technicality.',
      ],
    },
    {
      heading: 'Everything that is stored',
      body: [],
      rows: [
        [
          'Signed-in session',
          'Keeps you signed in so you are not asked for a link on every page. Required for the application to work at all. Removed when you sign out.',
        ],
        ['Language', 'The language you chose. Set only when you choose one.'],
        ['Light or dark', 'The appearance you chose. Set only when you choose one.'],
        [
          'Opening animation',
          'A single marker so the introduction plays once rather than on every visit.',
        ],
        [
          'Editor width',
          'The preview width you last used in the form builder, so it is the same when you come back.',
        ],
      ],
    },
    {
      heading: 'Why there is no banner',
      body: [
        'Consent is required for storing things on your device unless they are strictly necessary for a service you asked for. Everything in the list above either keeps you signed in or remembers a choice you made yourself. None of it is used to build a profile, none of it is shared, and none of it leaves your browser.',
        'A consent banner that asks permission for a setting you chose yourself teaches people to dismiss banners without reading them, so this one does not ask.',
        `Confirmation of this position: ${pending('confirmation from counsel that no consent banner is required for the items listed')}.`,
      ],
    },
    {
      heading: 'Clearing it',
      body: [
        'Signing out removes the session. Everything else can be cleared through your browser’s settings for this site, and the application will work exactly as it did on a first visit.',
      ],
    },
  ],
};

const TERMS: LegalDocument = {
  slug: 'terms',
  title: 'Terms',
  lede: 'The agreement between an organisation using Formwork and the company operating it.',
  updated: UPDATED,
  sections: [
    {
      heading: 'This document is not finished',
      body: [
        'The sections below record what the software does and what it promises technically. The commercial and legal terms of the agreement are marked and have to be settled by the operator with legal advice before this page is published.',
      ],
    },
    {
      heading: 'The service',
      body: [
        'Formwork provides form building, event registration, admission documents, check-in, and email sending on behalf of the organisation using it.',
        'An organisation’s data is isolated from every other organisation’s. Each request is scoped to the organisation that made it.',
        'Nothing is sent or deleted without a confirmation step, and every outbound action has a test mode.',
      ],
    },
    {
      heading: 'Your responsibilities as a publisher',
      body: [
        'You decide what your forms ask. That makes you the controller of the answers, and it makes lawfulness of the questions your responsibility: asking for more than you need, or asking for special categories of data without a basis, is a decision the software cannot make for you.',
        'You are responsible for the accuracy of what you send and for keeping your own account access secure.',
      ],
    },
    {
      heading: 'Commercial terms',
      body: [
        `Charges and billing: ${pending('pricing, billing period, payment terms, tax treatment')}.`,
        `Term, renewal and cancellation: ${pending('contract term and cancellation terms')}.`,
        `Availability commitment: ${pending('uptime commitment and remedies, or a statement that none is given')}.`,
        `Support: ${pending('support scope and response times')}.`,
      ],
    },
    {
      heading: 'Liability and law',
      body: [
        `Limitation of liability: ${pending('limitation of liability, settled with counsel')}.`,
        `Governing law and venue: ${pending('governing law and venue')}.`,
        'Where the customer is a consumer rather than a business, mandatory Swedish and EU consumer protection rules apply regardless of what this document says.',
      ],
    },
    {
      heading: 'Ending the agreement',
      body: [
        'You can export your responses at any time while the account is open, as CSV.',
        `What happens to data after an account closes: ${pending('post-termination data export window and deletion timetable')}.`,
      ],
    },
  ],
};

export const LEGAL_DOCUMENTS: readonly LegalDocument[] = [ABOUT, FAQ, PRIVACY, COOKIES, TERMS];

export function legalDocument(slug: string): LegalDocument | undefined {
  return LEGAL_DOCUMENTS.find((document) => document.slug === slug);
}
