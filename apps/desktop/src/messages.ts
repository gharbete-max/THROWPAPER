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
  menuBackupKeys: 'Back up with the keys…',
  menuRestoreKeys: 'Restore keys from a backup…',
  menuOpenInBrowser: 'Open in your browser',
  menuQuit: 'Quit',
  menuView: 'View',
  menuReload: 'Reload',
  menuSignInAgain: 'Sign in again',

  setupTitle: 'Welcome to Loppa',
  setupLead:
    'Everything stays on this computer: your forms, the answers, the documents and the messages waiting to be sent live in one folder you can back up by copying it. Nothing is emailed until you press Send in your own email program.',
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
  mailProgram: 'Open each message in my email program — I press Send (recommended)',
  mailProgramLead:
    'Nothing is sent automatically. Confirmations, admission cards and invitations wait under To send until you open them.',
  mailProgramChoice: 'Email program',
  mailProgramAuto: 'The usual one (Outlook on Windows, Apple Mail on a Mac)',
  mailProgramOutlook: 'Outlook (classic)',
  mailProgramAppleMail: 'Apple Mail',
  mailProgramMailto: 'My default email app — attachments are saved for me to attach',
  mailAdvanced: 'Advanced: send automatically',
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

  aiHeading: 'Summary and translation',
  aiLead:
    'They run on this computer, offline, with a model file you get once and can remove. Nothing is sent anywhere.',
  aiWhere: 'Set it up in Loppa under Documents, then Summary and translation.',
  menuOpenModel: 'Open the model file',

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

  backupDone:
    'Backup written to {path}. The access keys were left out on purpose; a restored copy makes new ones.',
  backupFailed: 'The backup could not be written: {message}',
  backupKeysDone:
    'Backup written to {path}, with the keys in keys.enc. Without the passphrase they cannot be read, and Loppa cannot recover it.',
  keysBackupTitle: 'Back up with the keys',
  keysBackupLead:
    'The access keys (they keep you signed in and make signing and download links work) are put in one file, keys.enc, protected by a passphrase you choose. Keep the passphrase somewhere safe: nobody, Loppa included, can recover it.',
  keysRestoreTitle: 'Restore keys from a backup',
  keysRestoreLead:
    'Choose the keys.enc from a backup and type the passphrase it was made with. Nothing is changed until you confirm.',
  keysPassphrase: 'Passphrase',
  keysPassphraseAgain: 'Passphrase again',
  keysBackupGo: 'Choose where to save…',
  keysRestoreGo: 'Choose keys.enc…',
  keysWorking: 'Working…',
  keysTooShort: 'Use at least {min} characters.',
  keysNoMatch: 'The two passphrases are not the same.',
  keysNothing: 'There are no keys on this computer to back up yet.',
  keysWrong: 'That passphrase is wrong, or the file is damaged. Nothing was changed.',
  keysUnreadable: 'That file is not a Loppa keys backup. Nothing was changed.',
  keysEmpty: 'That backup holds no keys. Nothing was changed.',
  keysPickTitle: 'Choose keys.enc',
  keysRestoreConfirm:
    'Replace the keys on this computer with the ones in {file}? Everyone signed in is signed out, and the links that were sent out under the old keys work again only if they were made under these. Loppa restarts its servers.',
  keysRestoreYes: 'Restore',
  keysRestoreNo: 'Cancel',
  keysRestoreDone: 'The keys were restored.',
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
  menuBackupKeys: 'Säkerhetskopiera med nycklarna…',
  menuRestoreKeys: 'Återställ nycklar från en säkerhetskopia…',
  menuOpenInBrowser: 'Öppna i din webbläsare',
  menuQuit: 'Avsluta',
  menuView: 'Visa',
  menuReload: 'Ladda om',
  menuSignInAgain: 'Logga in igen',

  setupTitle: 'Välkommen till Loppa',
  setupLead:
    'Allt stannar på den här datorn: formulären, svaren, dokumenten och meddelandena som väntar på att skickas ligger i en mapp som du säkerhetskopierar genom att kopiera den. Ingenting mejlas förrän du trycker på Skicka i ditt eget e-postprogram.',
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
  mailProgram:
    'Öppna varje meddelande i mitt e-postprogram — jag trycker på Skicka (rekommenderas)',
  mailProgramLead:
    'Inget skickas automatiskt. Bekräftelser, entrékort och inbjudningar väntar under Att skicka tills du öppnar dem.',
  mailProgramChoice: 'E-postprogram',
  mailProgramAuto: 'Det vanliga (Outlook på Windows, Apple Mail på en Mac)',
  mailProgramOutlook: 'Outlook (klassiska)',
  mailProgramAppleMail: 'Apple Mail',
  mailProgramMailto: 'Min vanliga e-postapp — bilagor sparas så att jag bifogar dem',
  mailAdvanced: 'Avancerat: skicka automatiskt',
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

  aiHeading: 'Sammanfattning och översättning',
  aiLead:
    'De körs på den här datorn, utan nätverk, med en modellfil som du hämtar en gång och kan ta bort. Ingenting skickas någonstans.',
  aiWhere: 'Ställ in det i Loppa under Dokument, sedan Sammanfattning och översättning.',
  menuOpenModel: 'Öppna modellfilen',

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

  backupDone:
    'Säkerhetskopian skrevs till {path}. Åtkomstnycklarna lämnades medvetet utanför; en återställd kopia skapar nya.',
  backupFailed: 'Säkerhetskopian kunde inte skrivas: {message}',
  backupKeysDone:
    'Säkerhetskopian skrevs till {path}, med nycklarna i keys.enc. Utan lösenfrasen går de inte att läsa, och Loppa kan inte återskapa den.',
  keysBackupTitle: 'Säkerhetskopiera med nycklarna',
  keysBackupLead:
    'Åtkomstnycklarna (de håller dig inloggad och får signerings- och nedladdningslänkar att fungera) läggs i en fil, keys.enc, skyddad av en lösenfras som du väljer. Spara lösenfrasen på ett säkert ställe: ingen, Loppa inte heller, kan återskapa den.',
  keysRestoreTitle: 'Återställ nycklar från en säkerhetskopia',
  keysRestoreLead:
    'Välj keys.enc från en säkerhetskopia och skriv lösenfrasen den gjordes med. Inget ändras förrän du bekräftar.',
  keysPassphrase: 'Lösenfras',
  keysPassphraseAgain: 'Lösenfras igen',
  keysBackupGo: 'Välj var den ska sparas…',
  keysRestoreGo: 'Välj keys.enc…',
  keysWorking: 'Arbetar…',
  keysTooShort: 'Använd minst {min} tecken.',
  keysNoMatch: 'De två lösenfraserna är inte likadana.',
  keysNothing: 'Det finns inga nycklar på den här datorn att säkerhetskopiera ännu.',
  keysWrong: 'Lösenfrasen är fel, eller filen är skadad. Inget ändrades.',
  keysUnreadable: 'Filen är ingen Loppa-nyckelkopia. Inget ändrades.',
  keysEmpty: 'Säkerhetskopian innehåller inga nycklar. Inget ändrades.',
  keysPickTitle: 'Välj keys.enc',
  keysRestoreConfirm:
    'Ersätta nycklarna på den här datorn med dem i {file}? Alla som är inloggade loggas ut, och länkar som skickats ut under de gamla nycklarna fungerar bara om de gjordes under dessa. Loppa startar om sina servrar.',
  keysRestoreYes: 'Återställ',
  keysRestoreNo: 'Avbryt',
  keysRestoreDone: 'Nycklarna återställdes.',
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
