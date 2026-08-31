import type { Catalogue } from '@tp/i18n';

/**
 * UI strings — CLAUDE.md rule 4 keeps them out of the components.
 *
 * Two locales at launch; the language dropdown is driven by the organisation's supportedLocales,
 * so adding a third is a catalogue entry and a database column, not a code change.
 */
export const messages: Catalogue = {
  'app.name': { 'sv-SE': 'Formwork', 'en-GB': 'Formwork' },
  'app.signOut': { 'sv-SE': 'Logga ut', 'en-GB': 'Sign out' },
  'app.language': { 'sv-SE': 'Språk', 'en-GB': 'Language' },
  'app.loading': { 'sv-SE': 'Laddar…', 'en-GB': 'Loading…' },

  'login.title': { 'sv-SE': 'Logga in', 'en-GB': 'Sign in' },
  'login.email': { 'sv-SE': 'E-postadress', 'en-GB': 'Email address' },
  'login.submit': { 'sv-SE': 'Skicka inloggningslänk', 'en-GB': 'Send sign-in link' },
  'login.sending': { 'sv-SE': 'Skickar…', 'en-GB': 'Sending…' },
  'login.sent': {
    'sv-SE': 'Om adressen finns hos oss är en inloggningslänk på väg. Den gäller i 15 minuter.',
    'en-GB': 'If that address is registered, a sign-in link is on its way. It lasts 15 minutes.',
  },
  'login.devHint': {
    'sv-SE': 'Utvecklingsläge: länken skrivs ut i api-forms-konsolen.',
    'en-GB': 'Development mode: the link is printed in the api-forms console.',
  },

  'callback.working': { 'sv-SE': 'Loggar in…', 'en-GB': 'Signing you in…' },
  'callback.failed': {
    'sv-SE': 'Länken gick inte att använda. Begär en ny.',
    'en-GB': 'That link could not be used. Request a new one.',
  },
  'callback.retry': { 'sv-SE': 'Tillbaka till inloggning', 'en-GB': 'Back to sign in' },

  'events.title': { 'sv-SE': 'Evenemang', 'en-GB': 'Events' },
  'events.new': { 'sv-SE': 'Nytt evenemang', 'en-GB': 'New event' },
  'events.empty': {
    'sv-SE': 'Inga evenemang ännu.',
    'en-GB': 'No events yet.',
  },
  'events.untranslated': {
    'sv-SE': 'Saknar översättning: {locales}',
    'en-GB': 'Missing translation: {locales}',
  },
  'events.registrationOpen': { 'sv-SE': 'Anmälan öppen', 'en-GB': 'Registration open' },
  'events.registrationClosed': { 'sv-SE': 'Anmälan stängd', 'en-GB': 'Registration closed' },
  'events.capacity': { 'sv-SE': '{count} platser', 'en-GB': '{count} places' },
  'events.uncapped': { 'sv-SE': 'Obegränsat', 'en-GB': 'Uncapped' },
  'events.archive': { 'sv-SE': 'Arkivera', 'en-GB': 'Archive' },
  'events.archiveConfirm': {
    'sv-SE': 'Arkivera evenemanget? Det går att återställa.',
    'en-GB': 'Archive this event? It can be restored.',
  },
  'events.adminOnly': {
    'sv-SE': 'Endast administratörer kan ändra evenemang.',
    'en-GB': 'Only administrators can change events.',
  },

  'event.name': { 'sv-SE': 'Namn', 'en-GB': 'Name' },
  'event.description': { 'sv-SE': 'Beskrivning', 'en-GB': 'Description' },
  'event.startsAt': { 'sv-SE': 'Börjar', 'en-GB': 'Starts' },
  'event.endsAt': { 'sv-SE': 'Slutar', 'en-GB': 'Ends' },
  'event.venueName': { 'sv-SE': 'Plats', 'en-GB': 'Venue' },
  'event.venueAddress': { 'sv-SE': 'Adress', 'en-GB': 'Address' },
  'event.capacity': { 'sv-SE': 'Antal platser', 'en-GB': 'Capacity' },
  'event.registrationClosesAt': { 'sv-SE': 'Anmälan stänger', 'en-GB': 'Registration closes' },
  'event.status': { 'sv-SE': 'Status', 'en-GB': 'Status' },
  'event.status.draft': { 'sv-SE': 'Utkast', 'en-GB': 'Draft' },
  'event.status.open': { 'sv-SE': 'Öppet', 'en-GB': 'Open' },
  'event.status.closed': { 'sv-SE': 'Stängt', 'en-GB': 'Closed' },
  'event.status.archived': { 'sv-SE': 'Arkiverat', 'en-GB': 'Archived' },
  'event.save': { 'sv-SE': 'Spara', 'en-GB': 'Save' },
  'event.saving': { 'sv-SE': 'Sparar…', 'en-GB': 'Saving…' },
  'event.cancel': { 'sv-SE': 'Avbryt', 'en-GB': 'Cancel' },
  'event.createTitle': { 'sv-SE': 'Nytt evenemang', 'en-GB': 'New event' },
  'event.editTitle': { 'sv-SE': 'Redigera evenemang', 'en-GB': 'Edit event' },
};
