import {
  createTranslator,
  DEFAULT_FALLBACKS,
  resolveLocale,
  type Catalogue,
  type LocaleConfig,
  type Translator,
} from '@tp/i18n';

/**
 * Sign's strings (rule 4), key-major as `@tp/i18n` wants them, English and Swedish to start as
 * every product did. A signer reads the page in **their own** language — the party's locale from
 * the envelope — not the browser's; the browser's is only used before the link has been read.
 *
 * Labels follow ADR 0012 "Decided": "Signature" / "Sign", never an eIDAS level. Nothing here says
 * what signing means in law; the declaration the signer approves is a person's text, and comes
 * from the server (rule 8).
 */
export const SIGN_LOCALES: LocaleConfig = {
  supported: ['en-GB', 'sv-SE'],
  default: 'en-GB',
  fallbacks: DEFAULT_FALLBACKS,
};

export const messages: Catalogue = {
  title: { 'en-GB': 'Loppa Sign', 'sv-SE': 'Loppa Sign' },
  scaffold: {
    'en-GB': 'Open the signing link you were sent to see the document and sign it.',
    'sv-SE': 'Öppna signeringslänken du har fått för att se dokumentet och signera det.',
  },
  backend: { 'en-GB': 'Server', 'sv-SE': 'Server' },
  unreachable: { 'en-GB': 'The server is not answering.', 'sv-SE': 'Servern svarar inte.' },
  checking: { 'en-GB': 'checking…', 'sv-SE': 'kontrollerar…' },

  'sign.loading': { 'en-GB': 'Opening…', 'sv-SE': 'Öppnar…' },
  'sign.notFound': {
    'en-GB': 'This link does not open anything. It may be mistyped, or no longer valid.',
    'sv-SE': 'Länken öppnar ingenting. Den kan vara felskriven eller inte längre giltig.',
  },
  'sign.for': { 'en-GB': 'For {name}', 'sv-SE': 'För {name}' },
  'sign.testMode': { 'en-GB': 'Test mode', 'sv-SE': 'Testläge' },
  'sign.open': { 'en-GB': 'Open the document (PDF)', 'sv-SE': 'Öppna dokumentet (PDF)' },
  'sign.declaration': {
    'en-GB': 'What you approve by signing',
    'sv-SE': 'Det här godkänner du genom att signera',
  },
  'sign.signature': { 'en-GB': 'Signature', 'sv-SE': 'Underskrift' },
  'sign.method.typed': { 'en-GB': 'Type your name', 'sv-SE': 'Skriv ditt namn' },
  'sign.method.drawn': { 'en-GB': 'Draw', 'sv-SE': 'Rita' },
  'sign.typedLabel': { 'en-GB': 'Your name', 'sv-SE': 'Ditt namn' },
  'sign.drawHint': {
    'en-GB': 'Draw your signature in the box.',
    'sv-SE': 'Rita din underskrift i rutan.',
  },
  'sign.drawArea': { 'en-GB': 'Signature pad', 'sv-SE': 'Signaturyta' },
  'sign.undo': { 'en-GB': 'Undo stroke', 'sv-SE': 'Ångra drag' },
  'sign.clear': { 'en-GB': 'Clear', 'sv-SE': 'Rensa' },
  'sign.submit': { 'en-GB': 'Sign', 'sv-SE': 'Signera' },
  'sign.submitting': { 'en-GB': 'Signing…', 'sv-SE': 'Signerar…' },
  'sign.decline': { 'en-GB': 'Decline', 'sv-SE': 'Avböj' },
  'sign.declineConfirm': {
    'en-GB': 'Decline? This cannot be undone, and the document will not be signed by anyone.',
    'sv-SE': 'Avböja? Det går inte att ångra, och dokumentet blir inte signerat av någon.',
  },
  'sign.declineYes': { 'en-GB': 'Yes, decline', 'sv-SE': 'Ja, avböj' },
  'sign.cancel': { 'en-GB': 'Cancel', 'sv-SE': 'Avbryt' },
  'sign.notYourTurn': {
    'en-GB': 'It is not your turn to sign yet. You can open the document meanwhile.',
    'sv-SE': 'Det är inte din tur att signera än. Du kan öppna dokumentet under tiden.',
  },
  'sign.party.signed': { 'en-GB': 'You have signed.', 'sv-SE': 'Du har signerat.' },
  'sign.party.declined': { 'en-GB': 'You declined.', 'sv-SE': 'Du avböjde.' },
  'sign.envelope.completed': { 'en-GB': 'Everyone has signed.', 'sv-SE': 'Alla har signerat.' },
  'sign.envelope.declined': {
    'en-GB': 'Signing has ended: someone declined.',
    'sv-SE': 'Signeringen har avslutats: någon avböjde.',
  },
  'sign.envelope.expired': {
    'en-GB': 'The time to sign has run out.',
    'sv-SE': 'Tiden för att signera har gått ut.',
  },
  'sign.envelope.cancelled': {
    'en-GB': 'The sender has cancelled this.',
    'sv-SE': 'Avsändaren har avbrutit det här.',
  },
  'sign.error': {
    'en-GB': 'Something went wrong. Try again.',
    'sv-SE': 'Något gick fel. Försök igen.',
  },
};

export function translatorFor(requested: readonly string[]): { lang: string; t: Translator } {
  const lang = resolveLocale(SIGN_LOCALES, requested.find((code) => code) ?? undefined);
  return { lang, t: createTranslator(SIGN_LOCALES, messages, lang) };
}
