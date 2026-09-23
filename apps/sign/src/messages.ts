/**
 * The scaffold's few strings, in the two languages every product starts with (rule 4: no
 * user-facing string in a component). The signer's page in P1c moves to the shared catalogue
 * pattern `apps/forms` uses, with every locale typed against English.
 */
const EN = {
  title: 'Loppa Sign',
  scaffold:
    'Scaffold only. Signing is its own product (docs/adr/0009-where-signing-lives.md); the signing page arrives in P1c.',
  backend: 'Backend',
  unreachable: 'api-sign unreachable — is it running on :4003?',
  checking: 'checking…',
};

const SV: typeof EN = {
  title: 'Loppa Sign',
  scaffold:
    'Bara ett skal. Signering är en egen produkt (docs/adr/0009-where-signing-lives.md); signeringssidan kommer i P1c.',
  backend: 'Server',
  unreachable: 'api-sign svarar inte — körs den på :4003?',
  checking: 'kontrollerar…',
};

export type Messages = typeof EN;

export function messagesFor(languages: readonly string[]): { lang: string; t: Messages } {
  const swedish = languages.some((language) => language.toLowerCase().startsWith('sv'));
  return swedish ? { lang: 'sv-SE', t: SV } : { lang: 'en-GB', t: EN };
}
