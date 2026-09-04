# What a person has to supply before the policy pages go live

`CLAUDE.md` rule 8 says legal, clinical, tax and safety-critical wording comes from a human. The
five pages under `/about`, `/faq`, `/privacy`, `/cookies` and `/terms` are written, and everything
in them that could be read out of the software has been. What is left is facts about a **business**,
which no amount of reading the code can produce.

Each one renders on the page as a visible amber marker rather than as plausible-looking text, so
the pages cannot be mistaken for finished. There are 22 of them. Search the source for `pending(`
in `apps/forms/src/site/legal.ts`.

## Blocking: the pages should not be published until these are answered

### Company identity

- Registered company name and organisation number
- Registered address
- General contact address
- Contact address for privacy requests
- Whether a data protection officer is appointed, and if so their name and contact

### Where the data actually lives

- **Database hosting provider and region.** This is not merely unwritten, it is _undecided_ —
  deployment has been blocked on this choice since the demo phase. The privacy page cannot claim a
  location until one exists. Email is already settled and is stated accurately: Amazon SES in
  `eu-north-1`, which is Stockholm.
- The data processing agreement reference for that provider
- The complete sub-processor list

### Decisions about time

- How long submitted responses are kept
- How long anything is kept after an account closes
- The export window and deletion timetable after termination

These three are business decisions with a compliance consequence, not defaults. The software
currently deletes nothing on a schedule: the only automatic expiries are the token and link
lifetimes, which are stated accurately on the page.

### For counsel

- The legal basis relied on for each processing purpose
- Limitation of liability
- Governing law and venue
- Confirmation of the cookie position below

## Commercial, for the terms page

- Pricing, billing period, payment terms, tax treatment
- Contract term, renewal and cancellation
- Availability commitment and remedies, or an explicit statement that none is given
- Support scope and response times

## The cookie position, which is unusual and worth a lawyer's eye

**This application sets no cookies at all.** No analytics, no advertising, no third-party script,
no external origin of any kind. That was verified rather than assumed: there is no `document.cookie`
anywhere, no cookie plugin registered on the server, and no external host referenced in the client.

It keeps five things in local storage, which the ePrivacy rules treat the same as cookies:

| Stored                | Purpose                          | Position taken               |
| --------------------- | -------------------------------- | ---------------------------- |
| Refresh token         | Keeps somebody signed in         | Strictly necessary           |
| Language              | A choice the user made           | User-requested preference    |
| Light or dark         | A choice the user made           | User-requested preference    |
| Intro seen            | Plays the opening animation once | Functional, no personal data |
| Builder preview width | Restores an editor setting       | Functional, no personal data |

The page therefore states that no consent banner is required, and says why. **That position needs
confirming.** The first three are comfortable. The last two are set without the user asking for
them, and although neither identifies anybody nor leaves the browser, a strict reading of "strictly
necessary" would not cover them.

If counsel disagrees, the cheap fix is to stop writing those two until a preference exists rather
than to add a banner: both are conveniences, and neither is worth a consent dialogue.

## What was deliberately not done

No consent banner was added. On a service with no trackers, a banner asking permission for a
setting somebody chose themselves teaches people to dismiss banners without reading them, and makes
the one that matters somewhere else easier to ignore. If the position above survives review, the
correct implementation is the one that is there: accurate disclosure and no dialogue.

## Language

The five pages are English only, like the rest of the marketing site. The product interface is
translated into twelve languages; the site is not. For a Swedish company selling to Swedish
associations, a Swedish privacy page is likely to be expected, and possibly required for consumer
contracts. That is a translation job, not a design one, and the page structure already supports it.
