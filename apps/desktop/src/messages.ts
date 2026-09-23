/**
 * The desktop shell's own strings — its menu, first-run screen and settings — in the two languages
 * every product starts with (rule 4). Everything inside the main window is `apps/forms` and uses
 * that app's catalogues; these are only the words the shell itself owns.
 *
 * Swedish is typed against English, so a key added to one and forgotten in the other fails the
 * typecheck rather than rendering the key.
 */
const EN = {
  appName: 'Loppa',
  menuFile: 'File',
  menuSettings: 'Settings…',
  menuOpenData: 'Open data folder',
  menuOpenOutbox: 'Open outbox (test-mode mail)',
  menuBackup: 'Back up…',
  menuOpenInBrowser: 'Open in your browser',
  menuQuit: 'Quit',
  menuView: 'View',
  menuReload: 'Reload',
  menuSignInAgain: 'Sign in again',

  setupTitle: 'Welcome to Loppa',
  setupLead:
    'Everything stays on this computer: your forms, the answers, the documents and the email outbox live in one folder you can back up by copying it.',
  setupOrganisation: 'Organisation name',
  setupName: 'Your name',
  setupEmail: 'Your email address',
  setupStart: 'Start',
  setupOrDemo: 'Or look around first:',
  setupDemo: 'Open with demo data',
  setupWorking: 'Setting up…',

  settingsTitle: 'Settings',
  settingsSaved: 'Saved. Loppa restarts its server to use the new settings.',
  settingsSave: 'Save',
  settingsCancel: 'Close',

  mailHeading: 'Email',
  mailOutbox: 'Test mode — write every email to the outbox folder, send nothing',
  mailSmtp: 'Send through my mail server (SMTP)',
  mailFrom: 'From address',
  smtpHost: 'Server',
  smtpPort: 'Port',
  smtpSecure: 'Use TLS from the start (port 465)',
  smtpUser: 'User name',
  smtpPassword: 'Password',
  smtpPasswordKept: 'A password is saved. Leave empty to keep it.',
  mailConfirm: 'I understand that confirmations will be sent to real addresses from this computer.',

  aiHeading: 'AI assistance',
  aiLead: 'Off unless you turn it on. Nothing is sent anywhere while it is off.',
  aiOff: 'Off',
  aiOnline: 'Connect online — to an AI service I choose',
  aiCloud: 'Work in cloud (placeholder)',
  aiEndpoint: 'Service address',

  signingHeading: 'Signing',
  signingLead:
    'Drawn signatures on forms work offline. Signing with an electronic identity needs a signing service.',
  signingLocal: 'On this computer — drawn signatures only',
  signingOnline: 'Connect online — to a Loppa Sign server',
  signingCloud: 'Work in cloud (placeholder)',
  signingEndpoint: 'Sign server address',

  placeholderNote:
    'Not available yet. Your choice is saved, and nothing is sent until this feature is built and you confirm it.',
  cloudNote:
    'A placeholder for a hosted Loppa account that this computer would sync with. Nothing connects today.',

  pdfHeading: 'Documents',
  pdfBrowser: 'Browser used to make PDFs (leave empty to use Microsoft Edge)',

  backupDone: 'Backup written to {path}',
  backupFailed: 'The backup could not be written: {message}',
  startFailed: 'Loppa could not start',
  errorAlreadySetUp: 'This computer already has a Loppa organisation. Restart Loppa to open it.',
};

const SV: typeof EN = {
  appName: 'Loppa',
  menuFile: 'Arkiv',
  menuSettings: 'Inställningar…',
  menuOpenData: 'Öppna datamappen',
  menuOpenOutbox: 'Öppna utkorgen (e-post i testläge)',
  menuBackup: 'Säkerhetskopiera…',
  menuOpenInBrowser: 'Öppna i din webbläsare',
  menuQuit: 'Avsluta',
  menuView: 'Visa',
  menuReload: 'Ladda om',
  menuSignInAgain: 'Logga in igen',

  setupTitle: 'Välkommen till Loppa',
  setupLead:
    'Allt stannar på den här datorn: formulären, svaren, dokumenten och utkorgen ligger i en mapp som du säkerhetskopierar genom att kopiera den.',
  setupOrganisation: 'Organisationens namn',
  setupName: 'Ditt namn',
  setupEmail: 'Din e-postadress',
  setupStart: 'Börja',
  setupOrDemo: 'Eller titta runt först:',
  setupDemo: 'Öppna med demodata',
  setupWorking: 'Förbereder…',

  settingsTitle: 'Inställningar',
  settingsSaved: 'Sparat. Loppa startar om sin server för att använda de nya inställningarna.',
  settingsSave: 'Spara',
  settingsCancel: 'Stäng',

  mailHeading: 'E-post',
  mailOutbox: 'Testläge — skriv all e-post till utkorgsmappen, skicka ingenting',
  mailSmtp: 'Skicka via min e-postserver (SMTP)',
  mailFrom: 'Avsändaradress',
  smtpHost: 'Server',
  smtpPort: 'Port',
  smtpSecure: 'Använd TLS från början (port 465)',
  smtpUser: 'Användarnamn',
  smtpPassword: 'Lösenord',
  smtpPasswordKept: 'Ett lösenord är sparat. Lämna tomt för att behålla det.',
  mailConfirm: 'Jag förstår att bekräftelser skickas till riktiga adresser från den här datorn.',

  aiHeading: 'AI-stöd',
  aiLead: 'Avstängt tills du slår på det. Ingenting skickas någonstans medan det är avstängt.',
  aiOff: 'Av',
  aiOnline: 'Anslut online — till en AI-tjänst jag väljer',
  aiCloud: 'Arbeta i molnet (platshållare)',
  aiEndpoint: 'Tjänstens adress',

  signingHeading: 'Signering',
  signingLead:
    'Ritade underskrifter i formulär fungerar utan nät. Signering med e-legitimation kräver en signeringstjänst.',
  signingLocal: 'På den här datorn — bara ritade underskrifter',
  signingOnline: 'Anslut online — till en Loppa Sign-server',
  signingCloud: 'Arbeta i molnet (platshållare)',
  signingEndpoint: 'Sign-serverns adress',

  placeholderNote:
    'Inte tillgängligt ännu. Ditt val sparas, och ingenting skickas förrän funktionen finns och du har bekräftat den.',
  cloudNote:
    'En platshållare för ett Loppa-konto på nätet som den här datorn skulle synkronisera med. Ingenting ansluter i dag.',

  pdfHeading: 'Dokument',
  pdfBrowser: 'Webbläsare som gör PDF:er (lämna tomt för Microsoft Edge)',

  backupDone: 'Säkerhetskopian skrevs till {path}',
  backupFailed: 'Säkerhetskopian kunde inte skrivas: {message}',
  startFailed: 'Loppa kunde inte starta',
  errorAlreadySetUp:
    'Den här datorn har redan en Loppa-organisation. Starta om Loppa för att öppna den.',
};

export type Messages = typeof EN;

export function messagesFor(languages: readonly string[]): { lang: string; t: Messages } {
  const swedish = languages.some((language) => language.toLowerCase().startsWith('sv'));
  return swedish ? { lang: 'sv-SE', t: SV } : { lang: 'en-GB', t: EN };
}

export function fill(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);
}
