/**
 * The one declaration Sign ships with, and it is a placeholder (rule 8, ADR 0012): the sentence a
 * signer approves is a person's to write. Marked test-only, so a production envelope refuses it.
 * Shared by `pnpm db:seed` and the desktop's first start, so both say exactly the same thing.
 */
export const DEMO_DECLARATION = {
  key: 'demo',
  version: 1,
  testOnly: true,
  texts: {
    'sv-SE': '[Försäkran skrivs av en människa — endast testläge]',
    'en-GB': '[Declaration to be written by a person — test mode only]',
  },
};
