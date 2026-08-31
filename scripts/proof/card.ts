/**
 * ONE card definition, rendered by all three targets. That it is a single object is the entire
 * point of the exercise — START-HERE.md phase 1.
 *
 * The copy is Swedish on purpose: å, ä and ö are what break in a PDF when fonts are referenced
 * by name instead of embedded.
 */
export interface ProofCard {
  eyebrow: string;
  title: string;
  body: string;
  meta: string;
  buttonLabel: string;
  buttonHref: string;
  footer: string;
}

export const proofCard: ProofCard = {
  eyebrow: 'Anmälan bekräftad',
  title: 'Välkommen till Vårmötet',
  body:
    'Din anmälan är registrerad. Ta med inträdeskortet till entrén — vi läser av QR-koden ' +
    'vid ankomst. Hör av dig om något behöver ändras.',
  meta: 'Storgatan 19, Göteborg · torsdag 14 maj, kl. 09.00',
  buttonLabel: 'Visa inträdeskort',
  buttonHref: 'https://example.com/admission',
  footer: 'Demo AB · demo@example.com',
};

/** Every letter the PDF text extraction asserts survived the round trip. */
export const NORDIC_PROBE = 'åäöÅÄÖ';
