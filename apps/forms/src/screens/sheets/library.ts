/**
 * The spreadsheet pack's commands, as the Library lists them (`packs/spreadsheets/Loppa-Sheets.ps1`).
 *
 * Content, not interface: each entry has an English title and summary and, where one has been
 * written by a person, a Swedish one. A language without its own text shows the English and says
 * so (`docs/plan/SPREADSHEETS.md` §5.2). `library.test.ts` holds this list to the script itself, so a
 * command added to the script without an entry here, or the other way round, fails a test.
 */
export const SCRIPT_NAME = 'Loppa-Sheets.ps1';

export interface Text {
  en: string;
  sv?: string;
}

export interface PackCommand {
  /** The command word the script takes. */
  id: string;
  title: Text;
  summary: Text;
  /** A line a person can adapt: their own file names go where these are. */
  usage: string;
}

const run = (rest: string) => `.\\${SCRIPT_NAME} ${rest}`;

export const COMMANDS: readonly PackCommand[] = [
  {
    id: 'compare',
    title: { en: 'Compare two files by a key', sv: 'Jämför två filer med en nyckel' },
    summary: {
      en: 'Which rows are only in one file, and which cells changed.',
      sv: 'Vilka rader som bara finns i den ena filen, och vilka celler som ändrats.',
    },
    usage: run('compare -A old.csv -B new.csv -Key Id'),
  },
  {
    id: 'match',
    title: { en: 'Match columns by name', sv: 'Para ihop kolumner efter namn' },
    summary: {
      en: 'Which column of one file is which column of the other, ignoring case, spaces and accents.',
      sv: 'Vilken kolumn i den ena filen som är vilken i den andra, utan hänsyn till versaler, mellanslag och accenter.',
    },
    usage: run('match -A members.csv -B export.csv'),
  },
  {
    id: 'dupes',
    title: { en: 'Find repeated rows', sv: 'Hitta upprepade rader' },
    summary: {
      en: 'Every row whose key appears more than once, and a copy that keeps the first of each.',
      sv: 'Varje rad vars nyckel förekommer flera gånger, och en kopia där den första av varje behålls.',
    },
    usage: run('dupes -File list.csv -Key Email'),
  },
  {
    id: 'merge',
    title: { en: 'Stack files into one', sv: 'Slå ihop filer till en' },
    summary: {
      en: 'All rows of several files in one, columns lined up by name, with a column saying where each row came from.',
      sv: 'Alla rader från flera filer i en, med kolumnerna ihopparade efter namn och en kolumn som säger varifrån varje rad kommer.',
    },
    usage: run('merge -File jan.csv,feb.csv,mar.csv'),
  },
  {
    id: 'split',
    title: { en: 'Split a file by a column', sv: 'Dela en fil efter en kolumn' },
    summary: { en: 'One file per value in the column.', sv: 'En fil per värde i kolumnen.' },
    usage: run('split -File orders.csv -By Country'),
  },
  {
    id: 'clean',
    title: { en: 'Tidy spaces and empty rows', sv: 'Städa mellanslag och tomma rader' },
    summary: {
      en: 'Trims spaces, turns non-breaking spaces into spaces and drops empty rows.',
      sv: 'Tar bort överflödiga mellanslag, gör hårda mellanslag till vanliga och tar bort tomma rader.',
    },
    usage: run('clean -File contacts.csv'),
  },
  {
    id: 'fuzzy',
    title: { en: 'Match similar names', sv: 'Para ihop liknande namn' },
    summary: {
      en: 'For each value in one file, the most alike value in the other, with a score.',
      sv: 'För varje värde i den ena filen, det mest lika värdet i den andra, med ett poängtal.',
    },
    usage: run('fuzzy -A members.csv -B export.csv -Column Name'),
  },
  {
    id: 'numbers',
    title: { en: 'Compare numbers within a tolerance', sv: 'Jämför tal inom en tolerans' },
    summary: {
      en: 'Cells whose numbers differ by more than you allow, in any local number style.',
      sv: 'Celler vars tal skiljer sig mer än du tillåter, i valfri lokal talstil.',
    },
    usage: run('numbers -A budget.csv -B actual.csv -Key Account -Column Amount -Tolerance 0.01'),
  },
  {
    id: 'lookup',
    title: { en: 'Add columns from another file', sv: 'Lägg till kolumner från en annan fil' },
    summary: {
      en: 'Like VLOOKUP across files: columns brought over by a key.',
      sv: 'Som VLOOKUP mellan filer: kolumner som hämtas med en nyckel.',
    },
    usage: run('lookup -File orders.csv -Key CustomerId -From customers.csv -Take Name,City'),
  },
  {
    id: 'gaps',
    title: { en: 'Find gaps in a numbered series', sv: 'Hitta luckor i en nummerserie' },
    summary: {
      en: 'Missing and repeated numbers, such as invoice numbers, with the zeros kept.',
      sv: 'Saknade och upprepade nummer, till exempel fakturanummer, med nollorna kvar.',
    },
    usage: run('gaps -File invoices.csv -Column InvoiceNo'),
  },
  {
    id: 'pivot',
    title: { en: 'Count or add up by column', sv: 'Räkna eller summera per kolumn' },
    summary: {
      en: 'A table of counts or sums by one or two columns, with totals.',
      sv: 'En tabell med antal eller summor per en eller två kolumner, med totaler.',
    },
    usage: run('pivot -File sales.csv -By Country -Cols Product -Sum Amount'),
  },
  {
    id: 'mask',
    title: { en: 'Hide columns before sharing', sv: 'Dölj kolumner före delning' },
    summary: {
      en: 'Replaces chosen columns with tokens that stay the same for the same value.',
      sv: 'Ersätter valda kolumner med koder som är desamma för samma värde.',
    },
    usage: run('mask -File people.csv -Column Name,Email -Salt "a secret phrase"'),
  },
];

/** The text in the person's language if there is one; otherwise English, and the caller says so. */
export function pick(text: Text, language: string): { text: string; fallback: boolean } {
  const own = language === 'sv' ? text.sv : undefined;
  return own === undefined
    ? { text: text.en, fallback: language !== 'en' }
    : { text: own, fallback: false };
}

/** Whether an entry matches what was typed: any part of its id, title or summary, either language. */
export function matches(command: PackCommand, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === '') return true;
  const haystack = [
    command.id,
    command.title.en,
    command.title.sv,
    command.summary.en,
    command.summary.sv,
  ]
    .filter((part): part is string => part !== undefined)
    .join(' ')
    .toLowerCase();
  return q.split(/\s+/).every((word) => haystack.includes(word));
}
