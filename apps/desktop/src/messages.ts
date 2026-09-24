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
  mailOutlookWindows: 'Send through Outlook on this computer (classic Outlook)',
  mailOutlookMac: 'Send through Microsoft Outlook on this Mac',
  mailAppleMail: 'Send through Apple Mail on this Mac',
  mailProgramNoteWindows:
    'Messages leave from the account Outlook is signed in to, and appear in its Sent folder. The new Outlook for Windows cannot be used this way; switch back to classic Outlook, or use a mail server.',
  mailProgramNoteMac:
    'Messages leave from the account the program is signed in to. The first time, macOS asks whether Loppa may control it — answer Allow.',
  mailFrom: 'From address',
  smtpHost: 'Server',
  smtpPort: 'Port',
  smtpSecure: 'Use TLS from the start (port 465)',
  smtpUser: 'User name',
  smtpPassword: 'Password',
  smtpPasswordKept: 'A password is saved. Leave empty to keep it.',
  mailConfirm:
    'I understand that confirmations will be sent to real people from this computer, from the account chosen above.',

  aiHeading: 'AI assistance',
  aiLead: 'Off unless you turn it on. Nothing is sent anywhere while it is off.',
  aiOff: 'Off',
  aiOnline: 'Connect online — to an AI service I choose',
  aiCloud: 'Work in cloud (placeholder)',
  aiEndpoint: 'Service address',

  signingHeading: 'Signing',
  signingLead:
    'Documents are signed and sealed on this computer, offline — by typing or drawing. Signing with an electronic identity needs a signing service online.',
  signingLocal: 'On this computer — typed or drawn, sealed here',
  signingOnline: 'Connect online — to a Loppa Sign server',
  signingCloud: 'Work in cloud (placeholder)',
  signingEndpoint: 'Sign server address',

  placeholderNote:
    'Not available yet. Your choice is saved, and nothing is sent until this feature is built and you confirm it.',
  cloudNote:
    'A placeholder for a hosted Loppa account that this computer would sync with. Nothing connects today.',

  pdfHeading: 'Documents',
  pdfBrowser: 'A browser to make PDFs with (leave empty — Loppa makes them itself)',

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
  mailOutlookWindows: 'Skicka via Outlook på den här datorn (klassiska Outlook)',
  mailOutlookMac: 'Skicka via Microsoft Outlook på den här Macen',
  mailAppleMail: 'Skicka via Apple Mail på den här Macen',
  mailProgramNoteWindows:
    'Meddelandena skickas från kontot som Outlook är inloggat på och hamnar i dess mapp Skickat. Nya Outlook för Windows går inte att använda så; byt tillbaka till klassiska Outlook, eller använd en e-postserver.',
  mailProgramNoteMac:
    'Meddelandena skickas från kontot som programmet är inloggat på. Första gången frågar macOS om Loppa får styra det — svara Tillåt.',
  mailFrom: 'Avsändaradress',
  smtpHost: 'Server',
  smtpPort: 'Port',
  smtpSecure: 'Använd TLS från början (port 465)',
  smtpUser: 'Användarnamn',
  smtpPassword: 'Lösenord',
  smtpPasswordKept: 'Ett lösenord är sparat. Lämna tomt för att behålla det.',
  mailConfirm:
    'Jag förstår att bekräftelser skickas till riktiga mottagare från den här datorn, från kontot som valts ovan.',

  aiHeading: 'AI-stöd',
  aiLead: 'Avstängt tills du slår på det. Ingenting skickas någonstans medan det är avstängt.',
  aiOff: 'Av',
  aiOnline: 'Anslut online — till en AI-tjänst jag väljer',
  aiCloud: 'Arbeta i molnet (platshållare)',
  aiEndpoint: 'Tjänstens adress',

  signingHeading: 'Signering',
  signingLead:
    'Dokument signeras och förseglas på den här datorn, utan nät — genom att skriva eller rita. Signering med e-legitimation kräver en signeringstjänst på nätet.',
  signingLocal: 'På den här datorn — skrivet eller ritat, förseglat här',
  signingOnline: 'Anslut online — till en Loppa Sign-server',
  signingCloud: 'Arbeta i molnet (platshållare)',
  signingEndpoint: 'Sign-serverns adress',

  placeholderNote:
    'Inte tillgängligt ännu. Ditt val sparas, och ingenting skickas förrän funktionen finns och du har bekräftat den.',
  cloudNote:
    'En platshållare för ett Loppa-konto på nätet som den här datorn skulle synkronisera med. Ingenting ansluter i dag.',

  pdfHeading: 'Dokument',
  pdfBrowser: 'En webbläsare som gör PDF:er (lämna tomt — Loppa gör dem själv)',

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
