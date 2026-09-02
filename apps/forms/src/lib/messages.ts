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
  'events.registered': { 'sv-SE': '{count} anmälda', 'en-GB': '{count} registered' },
  'events.registeredOf': {
    'sv-SE': '{count} av {capacity} anmälda',
    'en-GB': '{count} of {capacity} registered',
  },
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

  'nav.events': { 'sv-SE': 'Evenemang', 'en-GB': 'Events' },
  'nav.forms': { 'sv-SE': 'Formulär', 'en-GB': 'Forms' },

  'forms.title': { 'sv-SE': 'Formulär', 'en-GB': 'Forms' },
  'forms.new': { 'sv-SE': 'Nytt formulär', 'en-GB': 'New form' },
  'forms.empty': { 'sv-SE': 'Inga formulär ännu.', 'en-GB': 'No forms yet.' },
  'forms.slug': { 'sv-SE': 'Länkadress', 'en-GB': 'Link address' },
  'forms.slugHint': {
    'sv-SE': 'Blir /f/<adress>. Små bokstäver, siffror och bindestreck.',
    'en-GB': 'Becomes /f/<address>. Lower case, digits and hyphens.',
  },
  'forms.formTitle': { 'sv-SE': 'Titel', 'en-GB': 'Title' },
  'forms.create': { 'sv-SE': 'Skapa', 'en-GB': 'Create' },
  'forms.status.draft': { 'sv-SE': 'Utkast', 'en-GB': 'Draft' },
  'forms.status.published': { 'sv-SE': 'Publicerat', 'en-GB': 'Published' },
  'forms.status.closed': { 'sv-SE': 'Stängt', 'en-GB': 'Closed' },
  'forms.status.archived': { 'sv-SE': 'Arkiverat', 'en-GB': 'Archived' },
  'forms.version': { 'sv-SE': 'Version {n}', 'en-GB': 'Version {n}' },
  'forms.unpublished': { 'sv-SE': 'Aldrig publicerat', 'en-GB': 'Never published' },
  'forms.responses': { 'sv-SE': '{count} svar', 'en-GB': '{count} responses' },
  'forms.notFound': {
    'sv-SE': 'Formuläret finns inte, eller så har du inte behörighet till det.',
    'en-GB': 'That form does not exist, or you do not have access to it.',
  },
  'forms.viewResponses': { 'sv-SE': 'Visa svar', 'en-GB': 'View responses' },
  'forms.copyLink': { 'sv-SE': 'Kopiera länk', 'en-GB': 'Copy link' },
  'forms.copied': { 'sv-SE': 'Kopierad', 'en-GB': 'Copied' },
  'forms.copyFailed': { 'sv-SE': 'Kunde inte kopiera', 'en-GB': 'Could not copy' },
  'forms.untranslated': {
    'sv-SE': 'Saknar översättning: {locales}',
    'en-GB': 'Missing translation: {locales}',
  },

  'builder.palette': { 'sv-SE': 'Fält', 'en-GB': 'Fields' },
  'builder.properties': { 'sv-SE': 'Egenskaper', 'en-GB': 'Properties' },
  'builder.empty': {
    'sv-SE': 'Lägg till ett fält från panelen till vänster.',
    'en-GB': 'Add a field from the panel on the left.',
  },
  'builder.selectField': {
    'sv-SE': 'Välj ett fält för att redigera det.',
    'en-GB': 'Select a field to edit it.',
  },
  'builder.saved': { 'sv-SE': 'Sparat', 'en-GB': 'Saved' },
  'builder.saving': { 'sv-SE': 'Sparar…', 'en-GB': 'Saving…' },
  'builder.unsaved': { 'sv-SE': 'Ej sparat', 'en-GB': 'Unsaved' },
  'builder.publish': { 'sv-SE': 'Publicera', 'en-GB': 'Publish' },
  'builder.publishing': { 'sv-SE': 'Publicerar…', 'en-GB': 'Publishing…' },
  'builder.history': { 'sv-SE': 'Versioner', 'en-GB': 'Versions' },
  'builder.restore': { 'sv-SE': 'Återställ', 'en-GB': 'Restore' },
  'builder.restoreConfirm': {
    'sv-SE': 'Ersätt utkastet med version {n}? Det som inte är publicerat går förlorat.',
    'en-GB': 'Replace the draft with version {n}? Anything unpublished is lost.',
  },
  'builder.undo': { 'sv-SE': 'Ångra (Ctrl+Z)', 'en-GB': 'Undo (Ctrl+Z)' },
  'builder.redo': { 'sv-SE': 'Gör om (Ctrl+Shift+Z)', 'en-GB': 'Redo (Ctrl+Shift+Z)' },
  'builder.remove': { 'sv-SE': 'Ta bort', 'en-GB': 'Remove' },
  'builder.translationsComplete': {
    'sv-SE': 'Alla språk klara',
    'en-GB': 'All languages complete',
  },
  'builder.translationsMissing': {
    'sv-SE': '{locale}: {n} saknas',
    'en-GB': '{locale}: {n} missing',
  },
  'builder.overrideBody': {
    'sv-SE': 'Översättningar saknas för {locales}. Publicera ändå? Besökare får reservspråket.',
    'en-GB': 'Translations are missing for {locales}. Publish anyway? Visitors see the fallback.',
  },

  'field.key': { 'sv-SE': 'Nyckel', 'en-GB': 'Key' },
  'field.keyHint': {
    'sv-SE': 'Används i exporten. Ändra inte efter publicering.',
    'en-GB': 'Used in the export. Do not change after publishing.',
  },
  'field.label': { 'sv-SE': 'Etikett', 'en-GB': 'Label' },
  'field.helpText': { 'sv-SE': 'Hjälptext', 'en-GB': 'Help text' },
  'field.placeholder': { 'sv-SE': 'Platshållare', 'en-GB': 'Placeholder' },
  'field.placeholderHint': {
    'sv-SE': 'Grå exempeltext i rutan. Ersätter inte hjälptexten.',
    'en-GB': 'Grey example text inside the box. Not a replacement for help text.',
  },
  'field.required': { 'sv-SE': 'Obligatoriskt', 'en-GB': 'Required' },
  'field.width': { 'sv-SE': 'Bredd', 'en-GB': 'Width' },
  'field.widthHint': {
    'sv-SE': 'På mobil upptar alla fält hela bredden.',
    'en-GB': 'Every field takes the full width on a phone.',
  },
  'field.width.full': { 'sv-SE': 'Hel rad', 'en-GB': 'Full row' },
  'field.width.half': { 'sv-SE': 'Halv rad', 'en-GB': 'Half row' },
  'field.width.third': { 'sv-SE': 'Tredjedel', 'en-GB': 'One third' },
  'field.options': { 'sv-SE': 'Alternativ', 'en-GB': 'Options' },

  'field.appearance': { 'sv-SE': 'Utseende', 'en-GB': 'Appearance' },
  'field.appearanceHint': {
    'sv-SE': 'Påverkar bara hur frågan visas — svaren lagras likadant.',
    'en-GB': 'Changes how the question looks. Answers are stored the same way either way.',
  },
  'field.appearance.dropdown': { 'sv-SE': 'Rullgardin', 'en-GB': 'Dropdown' },
  'field.appearance.star': { 'sv-SE': 'Stjärnor', 'en-GB': 'Stars' },
  'field.appearance.number': { 'sv-SE': 'Siffror', 'en-GB': 'Numbers' },
  'field.scale': { 'sv-SE': 'Skala', 'en-GB': 'Scale' },
  'field.scaleHint': {
    'sv-SE': 'Antal steg, 2 till 10. Fem stjärnor eller tio siffror.',
    'en-GB': 'How many points, 2 to 10. Five stars, or ten numbers.',
  },
  'field.minLabel': { 'sv-SE': 'Text vid lägsta', 'en-GB': 'Label at the low end' },
  'field.maxLabel': { 'sv-SE': 'Text vid högsta', 'en-GB': 'Label at the high end' },
  'field.appearance.radio': { 'sv-SE': 'Radioknappar', 'en-GB': 'Radio buttons' },
  'field.appearance.checkboxes': { 'sv-SE': 'Kryssrutor', 'en-GB': 'Checkboxes' },
  'field.appearance.buttons': { 'sv-SE': 'Knappar', 'en-GB': 'Buttons' },
  'field.appearance.cards': { 'sv-SE': 'Kort', 'en-GB': 'Cards' },
  'field.addOption': { 'sv-SE': 'Lägg till alternativ', 'en-GB': 'Add option' },
  'field.optionValue': { 'sv-SE': 'Värde', 'en-GB': 'Value' },
  'field.content': { 'sv-SE': 'Innehåll', 'en-GB': 'Content' },
  'field.fromParameter': { 'sv-SE': 'Från URL-parameter', 'en-GB': 'From URL parameter' },

  'fieldType.short_text': { 'sv-SE': 'Kort text', 'en-GB': 'Short text' },
  'fieldType.long_text': { 'sv-SE': 'Lång text', 'en-GB': 'Long text' },
  'fieldType.number': { 'sv-SE': 'Tal', 'en-GB': 'Number' },
  'fieldType.email': { 'sv-SE': 'E-post', 'en-GB': 'Email' },
  'fieldType.phone': { 'sv-SE': 'Telefon', 'en-GB': 'Phone' },
  'fieldType.date': { 'sv-SE': 'Datum', 'en-GB': 'Date' },
  'fieldType.single_select': { 'sv-SE': 'Ett val', 'en-GB': 'Single select' },
  'fieldType.multi_select': { 'sv-SE': 'Flera val', 'en-GB': 'Multi select' },
  'fieldType.yes_no': { 'sv-SE': 'Ja/Nej', 'en-GB': 'Yes/No' },
  'fieldType.rating': { 'sv-SE': 'Betyg', 'en-GB': 'Rating' },
  'fieldType.time': { 'sv-SE': 'Tid', 'en-GB': 'Time' },
  'fieldType.file': { 'sv-SE': 'Bifogad fil', 'en-GB': 'File upload' },
  'fieldType.signature': { 'sv-SE': 'Signatur', 'en-GB': 'Signature' },
  'fieldType.section_break': { 'sv-SE': 'Avsnitt', 'en-GB': 'Section' },
  'fieldType.page_break': { 'sv-SE': 'Sidbrytning', 'en-GB': 'Page break' },
  'fieldType.rich_text': { 'sv-SE': 'Text', 'en-GB': 'Text block' },
  'fieldType.image': { 'sv-SE': 'Bild', 'en-GB': 'Image' },
  'fieldType.link': { 'sv-SE': 'Länk', 'en-GB': 'Link' },
  'field.href': { 'sv-SE': 'Länkadress', 'en-GB': 'Link address' },
  'field.hrefHint': {
    'sv-SE': 'Öppnas i en ny flik så att ifyllda svar inte går förlorade.',
    'en-GB': 'Opens in a new tab, so answers already filled in are not lost.',
  },
  'field.linkAppearance': { 'sv-SE': 'Visas som', 'en-GB': 'Shown as' },
  'field.linkAppearance.button': { 'sv-SE': 'Knapp', 'en-GB': 'Button' },
  'field.linkAppearance.link': { 'sv-SE': 'Textlänk', 'en-GB': 'Text link' },
  'fieldType.hidden': { 'sv-SE': 'Dolt fält', 'en-GB': 'Hidden field' },

  'submissions.title': { 'sv-SE': 'Svar ({n})', 'en-GB': 'Responses ({n})' },
  'submissions.empty': { 'sv-SE': 'Inga svar ännu.', 'en-GB': 'No responses yet.' },
  'submissions.notPublished': {
    'sv-SE': 'Formuläret är inte publicerat än, så det finns inga svar att visa.',
    'en-GB': 'This form is not published yet, so there are no responses to show.',
  },
  'submissions.stat.complete': { 'sv-SE': 'Kompletta', 'en-GB': 'Complete' },
  'submissions.stat.partial': { 'sv-SE': 'Påbörjade', 'en-GB': 'Started' },
  'submissions.stat.languages': { 'sv-SE': 'Språk', 'en-GB': 'Languages' },
  'submissions.stat.latest': { 'sv-SE': 'Senaste svar', 'en-GB': 'Latest response' },
  'submissions.search': { 'sv-SE': 'Sök', 'en-GB': 'Search' },
  'submissions.columns': { 'sv-SE': 'Kolumner', 'en-GB': 'Columns' },
  'submissions.separator': { 'sv-SE': 'Avgränsare', 'en-GB': 'Separator' },
  'submissions.exportCsv': { 'sv-SE': 'Exportera CSV', 'en-GB': 'Export CSV' },
  'submissions.exportXlsx': { 'sv-SE': 'Exportera Excel', 'en-GB': 'Export Excel' },
  'submissions.column.reference': { 'sv-SE': 'Referens', 'en-GB': 'Reference' },
  'submissions.column.submittedAt': { 'sv-SE': 'Skickad', 'en-GB': 'Submitted' },
  'submissions.column.locale': { 'sv-SE': 'Språk', 'en-GB': 'Language' },
  'submissions.column.status': { 'sv-SE': 'Status', 'en-GB': 'Status' },

  'nav.checkin': { 'sv-SE': 'Incheckning', 'en-GB': 'Check-in' },
  'nav.brand': { 'sv-SE': 'Utseende', 'en-GB': 'Brand' },

  // Why a form cannot be published. One key per DefinitionProblem code — messages.test.ts checks.
  'problem.duplicate-key': {
    'sv-SE': 'Fältnyckeln "{key}" används mer än en gång.',
    'en-GB': 'The field key "{key}" is used more than once.',
  },
  'problem.no-answerable-fields': {
    'sv-SE': 'Formuläret samlar inte in några svar än.',
    'en-GB': 'The form does not collect any answers yet.',
  },
  'problem.empty-options': {
    'sv-SE': 'En flervalsfråga saknar alternativ.',
    'en-GB': 'A choice question has no options.',
  },
  'problem.condition-unknown-field': {
    'sv-SE': 'Ett villkor frågar efter "{key}", som inget fält heter.',
    'en-GB': 'A condition asks about "{key}", which no field is called.',
  },
  'problem.condition-forward-reference': {
    'sv-SE': 'Ett villkor frågar efter "{key}", som kommer längre ned i formuläret.',
    'en-GB': 'A condition asks about "{key}", which comes further down the form.',
  },
  'problem.unsafe-pattern': {
    'sv-SE':
      'En formatregel kan ta orimligt lång tid att kontrollera. Undvik upprepning inuti en upprepad grupp, som (a+)+.',
    'en-GB':
      'A format rule can take an unreasonable time to check. Avoid a repeat inside a repeated group, such as (a+)+.',
  },

  // Settings that belong to the form rather than to any one field.
  'settings.heading': { 'sv-SE': 'Formulärets inställningar', 'en-GB': 'Form settings' },
  'settings.submitLabel': { 'sv-SE': 'Text på skicka-knappen', 'en-GB': 'Submit button wording' },
  'settings.submitLabelHint': {
    'sv-SE': 'Lämna tomt för standardtexten.',
    'en-GB': 'Leave blank for the standard wording.',
  },
  'settings.confirmationMessage': { 'sv-SE': 'Tackmeddelande', 'en-GB': 'Thank-you message' },
  'settings.confirmationMessageHint': {
    'sv-SE': 'Visas efter att formuläret skickats, tillsammans med referensnumret.',
    'en-GB': 'Shown after the form is sent, alongside the reference number.',
  },
  'settings.redirectUrl': { 'sv-SE': 'Skicka vidare till', 'en-GB': 'Send them on to' },
  'settings.redirectUrlHint': {
    'sv-SE': 'Valfritt. Ersätter tacksidan. Referensnumret följer med i länken.',
    'en-GB': 'Optional. Replaces the thank-you screen. The reference is carried in the link.',
  },
  'settings.showProgress': {
    'sv-SE': 'Visa hur långt man kommit',
    'en-GB': 'Show how far through they are',
  },
  'settings.allowSaveAndResume': {
    'sv-SE': 'Tillåt att spara och fortsätta senare',
    'en-GB': 'Allow saving and continuing later',
  },
  'settings.duplicateControl': { 'sv-SE': 'Dubbletter', 'en-GB': 'Duplicates' },
  'settings.duplicateControlHint': {
    'sv-SE': 'Om samma e-postadress får svara mer än en gång.',
    'en-GB': 'Whether the same email address may answer more than once.',
  },
  'settings.duplicateControl.email': {
    'sv-SE': 'Ett svar per e-postadress',
    'en-GB': 'One response per email address',
  },
  'settings.duplicateControl.none': {
    'sv-SE': 'Hur många som helst',
    'en-GB': 'Any number of responses',
  },
  'public.progress': { 'sv-SE': 'Steg {n} av {total}', 'en-GB': 'Step {n} of {total}' },

  // Ready-made looks. One key per THEME_PRESETS entry — messages.test.ts proves the mapping.
  'brand.themes': { 'sv-SE': 'Teman', 'en-GB': 'Themes' },
  'brand.themesHint': {
    'sv-SE': 'Välj ett tema som utgångspunkt och justera det sedan. Alla klarar kontrastkravet.',
    'en-GB': 'Pick a theme to start from, then adjust it. Every one passes the contrast check.',
  },
  'brand.themeSampleLabel': { 'sv-SE': 'Fråga', 'en-GB': 'Question' },
  'brand.themeSampleButton': { 'sv-SE': 'Skicka', 'en-GB': 'Send' },
  'theme.default': { 'sv-SE': 'Standard', 'en-GB': 'Default' },
  'theme.midnight': { 'sv-SE': 'Midnatt', 'en-GB': 'Midnight' },
  'theme.minimal': { 'sv-SE': 'Minimal', 'en-GB': 'Minimal' },
  'theme.garden': { 'sv-SE': 'Trädgård', 'en-GB': 'Garden' },
  'theme.bold': { 'sv-SE': 'Kraftfull', 'en-GB': 'Bold' },

  // Attaching a file. The wording matters here: a refusal is read by a member of the public.
  'file.hint': {
    'sv-SE': '{kinds}, högst {size} MB.',
    'en-GB': '{kinds}, up to {size} MB.',
  },
  'file.accept.image': { 'sv-SE': 'Bilder', 'en-GB': 'Images' },
  'file.accept.pdf': { 'sv-SE': 'PDF-filer', 'en-GB': 'PDF files' },
  'file.accept.both': { 'sv-SE': 'Bilder eller PDF', 'en-GB': 'Images or PDF' },
  'file.uploading': { 'sv-SE': 'Laddar upp {name}…', 'en-GB': 'Uploading {name}…' },
  'file.remove': { 'sv-SE': 'Ta bort', 'en-GB': 'Remove' },
  'file.error.too-large': {
    'sv-SE': 'Filen är för stor.',
    'en-GB': 'That file is too large.',
  },
  'file.error.empty': { 'sv-SE': 'Filen är tom.', 'en-GB': 'That file is empty.' },
  'file.error.svg-not-supported': {
    'sv-SE': 'SVG går inte att bifoga. Skicka en PNG eller JPEG.',
    'en-GB': 'SVG cannot be attached. Send a PNG or a JPEG.',
  },
  'file.error.unsupported-format': {
    'sv-SE': 'Den filtypen går inte att bifoga.',
    'en-GB': 'That kind of file cannot be attached.',
  },
  'file.error.not-accepted-here': {
    'sv-SE': 'Den här frågan tar inte emot den filtypen.',
    'en-GB': 'This question does not take that kind of file.',
  },
  'file.error.no-such-field': {
    'sv-SE': 'Den här frågan tar inte emot filer.',
    'en-GB': 'This question does not take files.',
  },
  'file.error.closed': {
    'sv-SE': 'Formuläret tar inte emot svar längre.',
    'en-GB': 'This form is no longer accepting answers.',
  },
  'file.error.no-file': { 'sv-SE': 'Ingen fil valdes.', 'en-GB': 'No file was chosen.' },
  'file.error.network': {
    'sv-SE': 'Uppladdningen misslyckades. Försök igen.',
    'en-GB': 'The upload failed. Try again.',
  },
  'field.statement': { 'sv-SE': 'Text som signeras', 'en-GB': 'What is being signed' },
  'field.statementHint': {
    'sv-SE': 'Visas ovanför signaturrutan. Till exempel: "Jag intygar att uppgifterna stämmer."',
    'en-GB': 'Shown above the signing area. For example: "I confirm the above is correct."',
  },
  'signature.clear': { 'sv-SE': 'Rensa', 'en-GB': 'Clear' },
  'signature.apply': { 'sv-SE': 'Använd signaturen', 'en-GB': 'Use this signature' },
  'signature.saving': { 'sv-SE': 'Sparar…', 'en-GB': 'Saving…' },
  'signature.saved': { 'sv-SE': 'Signerat', 'en-GB': 'Signed' },
  'signature.failed': {
    'sv-SE': 'Signaturen kunde inte sparas. Försök igen.',
    'en-GB': 'The signature could not be saved. Try again.',
  },
  'signature.typeInstead': {
    'sv-SE': 'Eller skriv ditt namn',
    'en-GB': 'Or type your name',
  },
  'field.accept': { 'sv-SE': 'Tillåtna filtyper', 'en-GB': 'Accepted file types' },
  'field.maxBytes': { 'sv-SE': 'Största storlek (MB)', 'en-GB': 'Largest size (MB)' },
  'validation.file': {
    'sv-SE': 'Bifoga en fil.',
    'en-GB': 'Attach a file.',
  },

  // Conditional logic: show a field only when an earlier answer says so.
  'visibility.heading': { 'sv-SE': 'Visa bara när…', 'en-GB': 'Show only when…' },
  'visibility.count': { 'sv-SE': '{n} villkor', 'en-GB': '{n} conditions' },
  'visibility.intro': {
    'sv-SE': 'Fältet visas bara när villkoren stämmer. Annars hoppas det över helt.',
    'en-GB': 'The field appears only when the conditions hold. Otherwise it is skipped entirely.',
  },
  'visibility.needsEarlierField': {
    'sv-SE': 'Lägg en fråga ovanför den här först — villkor kan bara läsa tidigare svar.',
    'en-GB': 'Put a question above this one first — a condition can only read an earlier answer.',
  },
  'visibility.match': { 'sv-SE': 'Kräv', 'en-GB': 'Require' },
  'visibility.match.all': { 'sv-SE': 'Alla villkor', 'en-GB': 'All conditions' },
  'visibility.match.any': { 'sv-SE': 'Minst ett villkor', 'en-GB': 'Any condition' },
  'visibility.field': { 'sv-SE': 'Fråga', 'en-GB': 'Question' },
  'visibility.operator': { 'sv-SE': 'Jämförelse', 'en-GB': 'Comparison' },
  'visibility.value': { 'sv-SE': 'Värde', 'en-GB': 'Value' },
  'visibility.add': { 'sv-SE': 'Lägg till villkor', 'en-GB': 'Add condition' },
  'visibility.remove': { 'sv-SE': 'Ta bort villkor', 'en-GB': 'Remove condition' },
  'visibility.missingField': {
    'sv-SE': '{key} — finns inte längre ovanför',
    'en-GB': '{key} — no longer above this field',
  },
  'visibility.operator.equals': { 'sv-SE': 'är lika med', 'en-GB': 'is' },
  'visibility.operator.notEquals': { 'sv-SE': 'är inte lika med', 'en-GB': 'is not' },
  'visibility.operator.contains': { 'sv-SE': 'innehåller', 'en-GB': 'contains' },
  'visibility.operator.answered': { 'sv-SE': 'är besvarad', 'en-GB': 'is answered' },
  'visibility.operator.empty': { 'sv-SE': 'är tom', 'en-GB': 'is empty' },
  'visibility.operator.greaterThan': { 'sv-SE': 'är större än', 'en-GB': 'is greater than' },
  'visibility.operator.lessThan': { 'sv-SE': 'är mindre än', 'en-GB': 'is less than' },

  // What counts as a valid answer. Every one of these drives a rule the validator already had.
  'rules.heading': { 'sv-SE': 'Regler för svaret', 'en-GB': 'Answer rules' },
  'rules.intro': {
    'sv-SE': 'Lämna tomt för ingen regel.',
    'en-GB': 'Leave blank for no rule.',
  },
  'rules.minLength': { 'sv-SE': 'Minst antal tecken', 'en-GB': 'Minimum characters' },
  'rules.maxLength': { 'sv-SE': 'Högst antal tecken', 'en-GB': 'Maximum characters' },
  'rules.rows': { 'sv-SE': 'Höjd i rader', 'en-GB': 'Height in rows' },
  'rules.min': { 'sv-SE': 'Lägsta värde', 'en-GB': 'Lowest value' },
  'rules.max': { 'sv-SE': 'Högsta värde', 'en-GB': 'Highest value' },
  'rules.minDate': { 'sv-SE': 'Tidigast datum', 'en-GB': 'Earliest date' },
  'rules.maxDate': { 'sv-SE': 'Senast datum', 'en-GB': 'Latest date' },
  'rules.minTime': { 'sv-SE': 'Tidigast tid', 'en-GB': 'Earliest time' },
  'rules.maxTime': { 'sv-SE': 'Senast tid', 'en-GB': 'Latest time' },
  'rules.decimals': { 'sv-SE': 'Antal decimaler', 'en-GB': 'Decimal places' },
  'rules.minSelected': { 'sv-SE': 'Minst antal val', 'en-GB': 'Minimum choices' },
  'rules.maxSelected': { 'sv-SE': 'Högst antal val', 'en-GB': 'Maximum choices' },
  'rules.defaultValue': { 'sv-SE': 'Standardvärde', 'en-GB': 'Default value' },
  'rules.defaultValueHint': {
    'sv-SE': 'Används när ingen parameter finns i länken.',
    'en-GB': 'Used when the link carries no parameter.',
  },
  'rules.pattern': { 'sv-SE': 'Format', 'en-GB': 'Format' },
  'rules.pattern.none': { 'sv-SE': 'Vad som helst', 'en-GB': 'Anything' },
  'rules.pattern.letters': { 'sv-SE': 'Endast bokstäver', 'en-GB': 'Letters only' },
  'rules.pattern.digits': { 'sv-SE': 'Endast siffror', 'en-GB': 'Digits only' },
  'rules.pattern.alphanumeric': {
    'sv-SE': 'Bokstäver och siffror',
    'en-GB': 'Letters and digits',
  },
  'rules.pattern.postcodeSe': { 'sv-SE': 'Svenskt postnummer', 'en-GB': 'Swedish postcode' },
  'rules.pattern.url': { 'sv-SE': 'Webbadress', 'en-GB': 'Web address' },
  'rules.pattern.custom': { 'sv-SE': 'Eget mönster', 'en-GB': 'Custom pattern' },
  'rules.pattern.expression': { 'sv-SE': 'Reguljärt uttryck', 'en-GB': 'Regular expression' },
  'rules.pattern.expressionHint': {
    'sv-SE': 'Matchas mot hela svaret. Skriv inga ^ eller $.',
    'en-GB': 'Matched against the whole answer. Do not add ^ or $.',
  },
  /** Names the nav landmark for a screen reader; never shown. */
  'nav.sections': { 'sv-SE': 'Avdelningar', 'en-GB': 'Sections' },

  'field.optionLabel': { 'sv-SE': 'Alternativets text', 'en-GB': 'Option text' },
  'field.addLanguage': { 'sv-SE': '{locale}', 'en-GB': '{locale}' },
  'field.optionValueHint': {
    'sv-SE': 'Sparas i exporten. Ändra inte efter att svar kommit in.',
    'en-GB': 'Stored in the export. Do not change it once answers exist.',
  },
  'field.removeOption': { 'sv-SE': 'Ta bort', 'en-GB': 'Remove' },

  'field.defaultLabel': { 'sv-SE': 'Ny fråga', 'en-GB': 'New question' },
  'field.defaultSection': { 'sv-SE': 'Nytt avsnitt', 'en-GB': 'New section' },
  'field.defaultText': { 'sv-SE': 'Skriv din text här.', 'en-GB': 'Write your text here.' },
  'field.defaultOption': { 'sv-SE': 'Alternativ {n}', 'en-GB': 'Option {n}' },

  'confirm.title': { 'sv-SE': 'Bekräfta', 'en-GB': 'Confirm' },
  'confirm.cancel': { 'sv-SE': 'Avbryt', 'en-GB': 'Cancel' },
  'confirm.confirm': { 'sv-SE': 'Ja, fortsätt', 'en-GB': 'Yes, continue' },
  'builder.duplicate': { 'sv-SE': 'Duplicera', 'en-GB': 'Duplicate' },
  'builder.removeYes': { 'sv-SE': 'Ta bort', 'en-GB': 'Remove' },

  'forms.edit': { 'sv-SE': 'Redigera formulär', 'en-GB': 'Edit form' },

  'palette.text': { 'sv-SE': 'Text', 'en-GB': 'Text' },
  'palette.numbers': { 'sv-SE': 'Siffror och datum', 'en-GB': 'Numbers and dates' },
  'palette.attachments': { 'sv-SE': 'Filer', 'en-GB': 'Files' },
  'palette.choice': { 'sv-SE': 'Val', 'en-GB': 'Choices' },
  'palette.layout': { 'sv-SE': 'Layout', 'en-GB': 'Layout' },

  'builder.addHint': {
    'sv-SE': 'Nya fält hamnar direkt efter det markerade.',
    'en-GB': 'A new field lands directly after the one you have selected.',
  },
  'builder.needsLabel': { 'sv-SE': 'Saknar frågetext', 'en-GB': 'Needs a question' },
  'builder.moveUp': { 'sv-SE': 'Flytta upp', 'en-GB': 'Move up' },
  'builder.moveDown': { 'sv-SE': 'Flytta ned', 'en-GB': 'Move down' },
  'builder.resize': { 'sv-SE': 'Ändra bredd', 'en-GB': 'Resize' },
  'builder.viewPreview': { 'sv-SE': 'Hela formuläret', 'en-GB': 'Whole form' },

  'preview.empty': {
    'sv-SE': 'Lägg till ett fält så visas formuläret här.',
    'en-GB': 'Add a field and the form appears here.',
  },
  'preview.page': { 'sv-SE': 'Sida {current} av {total}', 'en-GB': 'Page {current} of {total}' },
  'preview.note': {
    'sv-SE': 'Så här ser formuläret ut för den som fyller i det. Inget sparas härifrån.',
    'en-GB': 'This is what the form looks like to the person filling it in. Nothing here is saved.',
  },

  'field.labelPlaceholder': {
    'sv-SE': 'T.ex. Vad heter du?',
    'en-GB': 'For example: What is your name?',
  },
  'field.formatHint': {
    'sv-SE': 'Markera text och tryck på B, I eller U.',
    'en-GB': 'Select some text, then press B, I or U.',
  },
  'field.advanced': { 'sv-SE': 'Avancerat', 'en-GB': 'Advanced' },

  'templates.heading': { 'sv-SE': 'Börja från', 'en-GB': 'Start from' },
  'templates.intro': {
    'sv-SE':
      'Mallarna är utgångspunkter — ändra allt som inte passar er. Juridiska, medicinska och skatterelaterade formulär finns medvetet inte här; den texten måste en människa skriva.',
    'en-GB':
      'Templates are starting points — change anything that does not fit. Legal, medical and tax forms are deliberately absent; that wording has to come from a person.',
  },
  'templates.blank': { 'sv-SE': 'Tomt formulär', 'en-GB': 'Blank form' },
  'templates.blankHint': {
    'sv-SE': 'Börja från ingenting.',
    'en-GB': 'Start from nothing.',
  },
  'templates.fields': { 'sv-SE': 'fält', 'en-GB': 'fields' },

  'brand.title': { 'sv-SE': 'Utseende', 'en-GB': 'Brand' },
  'brand.intro': {
    'sv-SE':
      'Färger och form för allt organisationen skickar ut — formulär, PDF och e-post använder samma uppsättning.',
    'en-GB':
      'Colours and shape for everything the organisation sends out. Forms, PDFs and email all read the same set.',
  },
  'brand.readOnly': {
    'sv-SE': 'Bara administratörer kan ändra utseendet.',
    'en-GB': 'Only admins can change the brand.',
  },
  'brand.loadFailed': {
    'sv-SE': 'Utseendet kunde inte hämtas.',
    'en-GB': 'The brand could not be loaded.',
  },
  'brand.save': { 'sv-SE': 'Spara', 'en-GB': 'Save' },
  'brand.saving': { 'sv-SE': 'Sparar…', 'en-GB': 'Saving…' },
  'brand.reset': { 'sv-SE': 'Återställ standard', 'en-GB': 'Reset to default' },
  'brand.colours': { 'sv-SE': 'Färger', 'en-GB': 'Colours' },
  'brand.logo': { 'sv-SE': 'Logotyp', 'en-GB': 'Logo' },

  'image.add': { 'sv-SE': 'Lägg till bild', 'en-GB': 'Add an image' },
  'image.replace': { 'sv-SE': 'Byt bild', 'en-GB': 'Replace the image' },
  'image.remove': { 'sv-SE': 'Ta bort bild', 'en-GB': 'Remove the image' },
  'image.uploading': { 'sv-SE': 'Laddar upp…', 'en-GB': 'Uploading…' },
  'image.previewAlt': { 'sv-SE': 'Vald bild', 'en-GB': 'The chosen image' },
  'image.hint': {
    'sv-SE': 'PNG, JPEG, WebP eller GIF, högst 2 MB. SVG stöds inte.',
    'en-GB': 'PNG, JPEG, WebP or GIF, up to 2MB. SVG is not supported.',
  },
  'image.alt': { 'sv-SE': 'Alt-text', 'en-GB': 'Alt text' },
  'image.altHint': {
    'sv-SE': 'Beskriv bilden för den som inte ser den. Lämna tom om bilden bara är dekor.',
    'en-GB':
      'Describe the image for somebody who cannot see it. Leave it empty if it is decorative.',
  },
  'image.maxWidth': { 'sv-SE': 'Största bredd', 'en-GB': 'Maximum width' },
  'image.optionImage': { 'sv-SE': 'Bild för alternativet', 'en-GB': 'Image for this option' },
  'brand.logoAdd': { 'sv-SE': 'Lägg till logotyp', 'en-GB': 'Add a logo' },
  'brand.logoReplace': { 'sv-SE': 'Byt logotyp', 'en-GB': 'Replace the logo' },
  'brand.logoRemove': { 'sv-SE': 'Ta bort logotyp', 'en-GB': 'Remove the logo' },
  'brand.logoAlt': { 'sv-SE': 'Organisationens logotyp', 'en-GB': 'The organisation logo' },
  'brand.logoHint': {
    'sv-SE': 'PNG, JPEG, WebP eller GIF, högst 2 MB. SVG stöds inte.',
    'en-GB': 'PNG, JPEG, WebP or GIF, up to 2MB. SVG is not supported.',
  },
  'brand.shape': { 'sv-SE': 'Form och storlek', 'en-GB': 'Shape and size' },
  'brand.type': { 'sv-SE': 'Typsnitt', 'en-GB': 'Typeface' },
  'brand.labels': { 'sv-SE': 'Frågetext', 'en-GB': 'Question text' },
  'brand.borderWidth': { 'sv-SE': 'Kantlinjens tjocklek', 'en-GB': 'Border thickness' },
  'brand.spacingUnit': { 'sv-SE': 'Luft', 'en-GB': 'Spacing' },
  'brand.spacingHint': {
    'sv-SE': 'Allt annat mäts i den här enheten.',
    'en-GB': 'Everything else is measured in this unit.',
  },
  'brand.controlHeight': { 'sv-SE': 'Knapp- och fälthöjd', 'en-GB': 'Button and field height' },
  'brand.controlHeightHint': {
    'sv-SE': 'På pekskärm används alltid minst 44px, annars blir kontrollerna svåra att träffa.',
    'en-GB': 'Touch screens always use at least 44px, or controls become hard to hit.',
  },
  'brand.contentWidth': { 'sv-SE': 'Formulärets bredd', 'en-GB': 'Form width' },
  'brand.contentWidthHint': {
    'sv-SE': 'Hur brett formuläret får bli på en stor skärm.',
    'en-GB': 'How wide the form may get on a large screen.',
  },
  'brand.bodyFont': { 'sv-SE': 'Typsnitt', 'en-GB': 'Font' },
  'brand.lineHeight': { 'sv-SE': 'Radavstånd', 'en-GB': 'Line height' },
  'brand.scaleRatio': { 'sv-SE': 'Rubrikskala', 'en-GB': 'Heading scale' },
  'brand.scaleRatioHint': {
    'sv-SE': 'Hur mycket större varje rubriknivå blir.',
    'en-GB': 'How much larger each heading level gets.',
  },
  'brand.bold': { 'sv-SE': 'Fet', 'en-GB': 'Bold' },
  'brand.italic': { 'sv-SE': 'Kursiv', 'en-GB': 'Italic' },
  'brand.underline': { 'sv-SE': 'Understruken', 'en-GB': 'Underline' },
  'brand.logoColour': {
    'sv-SE': 'Hittade den här färgen i logotypen',
    'en-GB': 'Found this colour in the logo',
  },
  'brand.logoColourApply': { 'sv-SE': 'Använd som primärfärg', 'en-GB': 'Use as primary' },
  'brand.radius': { 'sv-SE': 'Hörnradie', 'en-GB': 'Corner radius' },
  'brand.baseSize': { 'sv-SE': 'Textstorlek', 'en-GB': 'Text size' },
  'brand.preview': { 'sv-SE': 'Förhandsgranskning', 'en-GB': 'Preview' },
  'brand.contrast': { 'sv-SE': 'Kontrast', 'en-GB': 'Contrast' },
  'brand.contrastOk': {
    'sv-SE': 'Alla kombinationer går att läsa.',
    'en-GB': 'Every combination is readable.',
  },
  'brand.contrastNeeds': { 'sv-SE': 'behöver', 'en-GB': 'needs' },
  'brand.contrastAdvisory': {
    'sv-SE': 'Varningar hindrar inte att du sparar — de säger bara vad som blir svårläst.',
    'en-GB': 'Warnings never block a save. They only say what will be hard to read.',
  },

  'brand.colour.primary': { 'sv-SE': 'Primär', 'en-GB': 'Primary' },
  'brand.colour.secondary': { 'sv-SE': 'Sekundär', 'en-GB': 'Secondary' },
  'brand.colour.accent': { 'sv-SE': 'Accent', 'en-GB': 'Accent' },
  'brand.colour.background': { 'sv-SE': 'Bakgrund', 'en-GB': 'Background' },
  'brand.colour.surface': { 'sv-SE': 'Yta', 'en-GB': 'Surface' },
  'brand.colour.text': { 'sv-SE': 'Text', 'en-GB': 'Text' },
  'brand.colour.muted': { 'sv-SE': 'Dämpad text', 'en-GB': 'Muted text' },
  'brand.colour.border': { 'sv-SE': 'Kantlinje', 'en-GB': 'Border' },
  'brand.colour.success': { 'sv-SE': 'Klart', 'en-GB': 'Success' },
  'brand.colour.warning': { 'sv-SE': 'Varning', 'en-GB': 'Warning' },
  'brand.colour.danger': { 'sv-SE': 'Fel', 'en-GB': 'Error' },

  'brand.hint.primary': {
    'sv-SE': 'Knappar och markerade val.',
    'en-GB': 'Buttons and selected choices.',
  },
  'brand.hint.secondary': { 'sv-SE': 'Andrahandsknappar.', 'en-GB': 'Secondary buttons.' },
  'brand.hint.accent': {
    'sv-SE': 'Dekor. Använd den inte till text.',
    'en-GB': 'Decorative. Do not use it for text.',
  },
  'brand.hint.background': { 'sv-SE': 'Sidans bakgrund.', 'en-GB': 'The page behind everything.' },
  'brand.hint.surface': { 'sv-SE': 'Kort och paneler.', 'en-GB': 'Cards and panels.' },
  'brand.hint.text': { 'sv-SE': 'Brödtext.', 'en-GB': 'Body text.' },
  'brand.hint.muted': { 'sv-SE': 'Hjälptext och etiketter.', 'en-GB': 'Help text and labels.' },
  'brand.hint.border': { 'sv-SE': 'Fältkanter.', 'en-GB': 'Field edges.' },
  'brand.hint.success': { 'sv-SE': 'Bekräftelser.', 'en-GB': 'Confirmations.' },
  'brand.hint.warning': { 'sv-SE': 'Varningar.', 'en-GB': 'Warnings.' },
  'brand.hint.danger': { 'sv-SE': 'Felmeddelanden.', 'en-GB': 'Error messages.' },

  'brand.previewHeading': { 'sv-SE': 'Anmälan', 'en-GB': 'Registration' },
  'brand.previewBody': {
    'sv-SE': 'Så här ser ett formulär ut för den som fyller i det.',
    'en-GB': 'This is what a form looks like to the person filling it in.',
  },
  'brand.previewField': { 'sv-SE': 'Namn', 'en-GB': 'Name' },
  'brand.previewChoice': { 'sv-SE': 'Måltid', 'en-GB': 'Meal' },
  'brand.previewOptionA': { 'sv-SE': 'Standard', 'en-GB': 'Standard' },
  'brand.previewOptionB': { 'sv-SE': 'Vegetariskt', 'en-GB': 'Vegetarian' },
  'brand.previewSubmit': { 'sv-SE': 'Anmäl mig', 'en-GB': 'Register me' },
  'brand.previewSecondary': { 'sv-SE': 'Spara utkast', 'en-GB': 'Save draft' },
  'brand.previewError': {
    'sv-SE': 'Så här ser ett felmeddelande ut.',
    'en-GB': 'This is what an error looks like.',
  },

  'demo.banner': {
    'sv-SE': 'Demoläge — data sparas inte och e-post skickas aldrig.',
    'en-GB': 'Demo mode — nothing is saved and no email is ever sent.',
  },
  'demo.reset': { 'sv-SE': 'Återställ demodata', 'en-GB': 'Reset demo data' },
  'demo.signInAs': { 'sv-SE': 'Logga in som {role}', 'en-GB': 'Sign in as {role}' },
  'demo.signInHint': {
    'sv-SE': 'I demoläge går ingen e-post att läsa, så logga in direkt:',
    'en-GB': 'No email can be read in demo mode, so sign in directly:',
  },

  'checkin.title': { 'sv-SE': 'Incheckning', 'en-GB': 'Check-in' },
  'checkin.counts': {
    'sv-SE': '{checkedIn} av {registered} incheckade',
    'en-GB': '{checkedIn} of {registered} checked in',
  },
  'checkin.reference': { 'sv-SE': 'Referens', 'en-GB': 'Reference' },
  'checkin.check': { 'sv-SE': 'Checka in', 'en-GB': 'Check in' },
  'checkin.checking': { 'sv-SE': 'Kontrollerar…', 'en-GB': 'Checking…' },
  'checkin.startCamera': { 'sv-SE': 'Starta kameran', 'en-GB': 'Start camera' },
  'checkin.stopCamera': { 'sv-SE': 'Stoppa kameran', 'en-GB': 'Stop camera' },
  'checkin.cameraUnavailable': {
    'sv-SE': 'Kameran är inte tillgänglig — skriv in referensen i stället.',
    'en-GB': 'The camera is unavailable — type the reference instead.',
  },
  'checkin.arrivedAt': { 'sv-SE': 'Anlände {time}', 'en-GB': 'Arrived {time}' },
  'checkin.outcome.admitted': { 'sv-SE': 'Välkommen', 'en-GB': 'Welcome' },
  'checkin.outcome.already': { 'sv-SE': 'Redan incheckad', 'en-GB': 'Already checked in' },
  'checkin.outcome.revoked': { 'sv-SE': 'Anmälan återkallad', 'en-GB': 'Registration withdrawn' },
  'checkin.outcome.wrong-event': { 'sv-SE': 'Fel evenemang', 'en-GB': 'Wrong event' },
  'checkin.outcome.not-found': { 'sv-SE': 'Hittades inte', 'en-GB': 'Not found' },
  'checkin.outcome.bad-signature': { 'sv-SE': 'Ogiltigt kort', 'en-GB': 'Invalid card' },

  'attendance.title': { 'sv-SE': 'Närvaro', 'en-GB': 'Attendance' },
  'attendance.registered': { 'sv-SE': 'Anmälda', 'en-GB': 'Registered' },
  'attendance.checkedIn': { 'sv-SE': 'Incheckade', 'en-GB': 'Checked in' },
  'attendance.noShow': { 'sv-SE': 'Uteblivna', 'en-GB': 'No-shows' },
  'attendance.revoked': { 'sv-SE': 'Återkallade', 'en-GB': 'Withdrawn' },
  'attendance.revokeConfirm': {
    'sv-SE': 'Återkalla anmälan för {name}? Platsen blir ledig igen.',
    'en-GB': 'Withdraw the registration for {name}? The place is freed up again.',
  },
  'attendance.all': { 'sv-SE': 'Alla', 'en-GB': 'All' },
  'attendance.onlyNoShow': { 'sv-SE': 'Endast uteblivna', 'en-GB': 'No-shows only' },
  'attendance.exportCsv': { 'sv-SE': 'Exportera CSV', 'en-GB': 'Export CSV' },
  'attendance.openCheckIn': { 'sv-SE': 'Öppna incheckning', 'en-GB': 'Open check-in' },
  'attendance.column.reference': { 'sv-SE': 'Referens', 'en-GB': 'Reference' },
  'attendance.column.name': { 'sv-SE': 'Namn', 'en-GB': 'Name' },
  'attendance.column.email': { 'sv-SE': 'E-post', 'en-GB': 'Email' },
  'attendance.column.checkedInAt': { 'sv-SE': 'Incheckad', 'en-GB': 'Checked in' },
  'attendance.column.status': { 'sv-SE': 'Status', 'en-GB': 'Status' },
  'attendance.status.arrived': { 'sv-SE': 'Anlänt', 'en-GB': 'Arrived' },
  'attendance.status.expected': { 'sv-SE': 'Väntas', 'en-GB': 'Expected' },
  'attendance.status.revoked': { 'sv-SE': 'Återkallad', 'en-GB': 'Withdrawn' },

  // Public form. Shown to people who are not signed in, in their chosen language.
  'public.next': { 'sv-SE': 'Nästa', 'en-GB': 'Next' },
  'public.back': { 'sv-SE': 'Tillbaka', 'en-GB': 'Back' },
  /**
   * The last page's action. "Complete" rather than "Sign": a signature that carries legal weight
   * is a regulated feature this product does not have (SPEC-forms.md §8), and a button that says
   * "Sign" would be claiming one. An author who wants different wording sets submitLabel.
   */
  'public.complete': { 'sv-SE': 'Slutför', 'en-GB': 'Complete' },
  'public.submitting': { 'sv-SE': 'Skickar…', 'en-GB': 'Submitting…' },
  'public.save': { 'sv-SE': 'Spara och fortsätt senare', 'en-GB': 'Save and continue later' },
  'public.saving': { 'sv-SE': 'Sparar…', 'en-GB': 'Saving…' },
  'public.savedTitle': { 'sv-SE': 'Sparat', 'en-GB': 'Saved' },
  'public.savedBody': {
    'sv-SE': 'Spara länken nedan. Den gäller i 30 dagar.',
    'en-GB': 'Keep the link below. It lasts 30 days.',
  },
  'public.copy': { 'sv-SE': 'Kopiera länk', 'en-GB': 'Copy link' },
  'public.copied': { 'sv-SE': 'Kopierad', 'en-GB': 'Copied' },
  'public.thanks': { 'sv-SE': 'Tack!', 'en-GB': 'Thank you.' },
  'public.reference': {
    'sv-SE': 'Din referens: {reference}',
    'en-GB': 'Your reference: {reference}',
  },
  'public.closed.not-open-yet': {
    'sv-SE': 'Anmälan har inte öppnat än.',
    'en-GB': 'This form has not opened yet.',
  },
  'public.closed.full': { 'sv-SE': 'Alla platser är tagna.', 'en-GB': 'All places are taken.' },
  'public.closed.unpublished': { 'sv-SE': 'Formuläret finns inte.', 'en-GB': 'Form not found.' },
  'public.rejected.duplicate': {
    'sv-SE': 'Den här adressen har redan anmälts.',
    'en-GB': 'That address has already been registered.',
  },
  'public.rejected.full': {
    'sv-SE': 'Platserna tog slut medan du fyllde i.',
    'en-GB': 'The places ran out while you were filling this in.',
  },
  'public.rejected.closed': {
    'sv-SE': 'Anmälan stängde medan du fyllde i.',
    'en-GB': 'The form closed while you were filling this in.',
  },
  'public.notFound': { 'sv-SE': 'Formuläret finns inte.', 'en-GB': 'Form not found.' },
  'public.yes': { 'sv-SE': 'Ja', 'en-GB': 'Yes' },
  'public.no': { 'sv-SE': 'Nej', 'en-GB': 'No' },
  'public.choose': { 'sv-SE': 'Välj…', 'en-GB': 'Choose…' },

  'validation.required': {
    'sv-SE': 'Fältet är obligatoriskt.',
    'en-GB': 'This field is required.',
  },
  'validation.tooShort': { 'sv-SE': 'Minst {min} tecken.', 'en-GB': 'At least {min} characters.' },
  'validation.tooLong': { 'sv-SE': 'Högst {max} tecken.', 'en-GB': 'At most {max} characters.' },
  'validation.pattern': { 'sv-SE': 'Fel format.', 'en-GB': 'Wrong format.' },
  'validation.phone': { 'sv-SE': 'Ange ett telefonnummer.', 'en-GB': 'Enter a phone number.' },
  'validation.email': { 'sv-SE': 'Ange en e-postadress.', 'en-GB': 'Enter an email address.' },
  'validation.number': { 'sv-SE': 'Ange ett tal.', 'en-GB': 'Enter a number.' },
  'validation.min': { 'sv-SE': 'Minst {min}.', 'en-GB': 'At least {min}.' },
  'validation.max': { 'sv-SE': 'Högst {max}.', 'en-GB': 'At most {max}.' },
  'validation.decimals': {
    'sv-SE': 'Högst {decimals} decimaler.',
    'en-GB': 'At most {decimals} decimal places.',
  },
  'validation.precision': {
    'sv-SE': 'Talet är för långt för att lagras exakt. Använd ett textfält för långa nummer.',
    'en-GB': 'That number is too long to store exactly. Use a text field for long numbers.',
  },
  'validation.date': { 'sv-SE': 'Ange ett datum.', 'en-GB': 'Enter a date.' },
  'validation.dateMin': { 'sv-SE': 'Tidigast {min}.', 'en-GB': 'No earlier than {min}.' },
  'validation.dateMax': { 'sv-SE': 'Senast {max}.', 'en-GB': 'No later than {max}.' },
  'validation.option': {
    'sv-SE': 'Välj ett giltigt alternativ.',
    'en-GB': 'Choose a valid option.',
  },
  'validation.minSelected': { 'sv-SE': 'Välj minst {min}.', 'en-GB': 'Choose at least {min}.' },
  'validation.maxSelected': { 'sv-SE': 'Välj högst {max}.', 'en-GB': 'Choose at most {max}.' },
  'validation.yesNo': { 'sv-SE': 'Välj ja eller nej.', 'en-GB': 'Choose yes or no.' },
  'validation.rating': { 'sv-SE': 'Välj 1 till {max}.', 'en-GB': 'Choose 1 to {max}.' },
  'validation.time': { 'sv-SE': 'Ange en tid.', 'en-GB': 'Enter a time.' },
  'validation.timeMin': { 'sv-SE': 'Tidigast {min}.', 'en-GB': 'No earlier than {min}.' },
  'validation.timeMax': { 'sv-SE': 'Senast {max}.', 'en-GB': 'No later than {max}.' },
};
