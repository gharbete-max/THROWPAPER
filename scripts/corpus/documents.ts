import { PROSE } from '../../packages/shared/src/import/layout/prose.fixture.js';
import {
  columns,
  heading,
  item,
  para,
  small,
  table,
  title,
  type Block,
  type WordDocument,
} from './word.js';

/**
 * The corpus's own documents — `docs/plan/IMPORT-PIPELINE.md`, "The golden corpus". Each is
 * written here as a Word document in a few readable lines; `pnpm corpus:build` has LibreOffice
 * read it and write the PDF and the DOCX in `fixtures/documents/`, so the files the tests read
 * are a real writer's: real fonts, kerning, list numbering, headers and fields. Made for Loppa,
 * so Loppa may publish them (CC0), which a form somebody sent us never is.
 *
 * A document's expectation is written by hand in `fixtures/documents/expected/`, from what the
 * document says here — before its test runs.
 */

export interface CorpusDocument {
  name: string;
  /** BCP 47 language of its text. */
  language: string;
  /** What it is there to test, in a sentence. */
  summary: string;
  /** The traps and features it carries, for finding a document by what it covers. */
  features: string[];
  word: WordDocument;
}

const blank = (n: number) => '_'.repeat(n);

/** Paragraphs of ordinary prose, enough to fill part of a page. */
const filler = (sentences: string[]): Block[] => sentences.map((sentence) => para(sentence));

export const CORPUS: CorpusDocument[] = [
  {
    name: 'medlemsansokan',
    language: 'sv',
    summary:
      'A one-page membership application: a Word list with a lettered sub-list, blanks, a yes/no question with checkboxes, and a page-number footer.',
    features: ['word-numbering', 'sub-list', 'blanks', 'checkboxes', 'footer-page-number'],
    word: {
      lists: [
        {
          id: 1,
          levels: [
            ['decimal', '%1.'],
            ['lowerLetter', '%2)'],
          ],
        },
      ],
      footer: 'Sida {PAGE} av {NUMPAGES}',
      blocks: [
        title('Medlemsansökan'),
        para(
          'Fyll i blanketten och lämna den till kansliet eller skicka den med post. Vi behöver alla uppgifter för att kunna registrera dig som medlem, och de används bara för föreningens eget register. Om något är oklart kan du vänligen kontakta kansliet, så hjälper vi dig.',
        ),
        item(1, `Namn: ${blank(30)}`),
        item(1, `Personnummer: ${blank(22)}`),
        item(1, `Adress: ${blank(28)}`),
        para('Skriv den adress dit vi ska skicka medlemskortet.', { indent: 567 }),
        item(1, 'Kontaktuppgifter'),
        item(1, `Telefon: ${blank(20)}`, 1),
        item(1, `E-post: ${blank(20)}`, 1),
        item(1, 'Vill du ha föreningens nyhetsbrev?   ☐ Ja   ☐ Nej'),
        item(1, `Underskrift: ${blank(24)}`),
        small('Uppgifterna används bara för föreningens medlemsregister och lämnas inte ut.'),
      ],
    },
  },
  {
    name: 'arsmote-anmalan',
    language: 'sv',
    summary:
      'Two pages under a running header and a page-number footer: a long introduction, and a numbered list that starts on page 1 and ends on page 2, one of its paragraphs mentioning point 12.1 mid-sentence.',
    features: [
      'word-numbering',
      'page-break-continuation',
      'repeated-header',
      'footer-page-number',
      'dotted-mid-sentence',
    ],
    word: {
      lists: [{ id: 1, levels: [['decimal', '%1.']] }],
      header: 'Föreningen Exempel · Årsmöte 2026',
      footer: 'Sida {PAGE} av {NUMPAGES}',
      blocks: [
        title('Anmälan till årsmötet'),
        ...filler([
          'Årsmötet hålls i föreningens lokaler den 12 juni klockan 18.00. Alla medlemmar är välkomna, och vi hoppas att så många som möjligt vill vara med och påverka föreningens arbete under det kommande året.',
          'För att vi ska kunna planera lokal, mat och material behöver vi veta hur många som kommer. Anmäl dig därför senast den 1 juni genom att fylla i blanketten och lämna den till kansliet, eller skicka den med post till föreningens adress.',
          'Varje medlem har en röst, och den som inte kan komma får lämna en skriftlig fullmakt enligt punkt 12.1 i stadgarna. Fullmakten ska vara undertecknad och lämnas till ordföranden innan mötet börjar.',
          'Under mötet går vi igenom verksamhetsberättelsen, den ekonomiska redovisningen och revisorernas berättelse. Därefter beslutar mötet om ansvarsfrihet för styrelsen och väljer styrelse och revisorer för nästa år.',
          'Motioner till årsmötet ska ha kommit in till styrelsen senast fyra veckor före mötet. Styrelsens yttrande över varje motion skickas ut tillsammans med de övriga handlingarna en vecka före mötet.',
          'Efter mötet bjuder föreningen på middag. Ange i blanketten om du vill äta och om du har några allergier eller andra önskemål om maten, så att köket kan förbereda sig.',
          'Har du frågor om årsmötet är du välkommen att kontakta kansliet på vardagar mellan klockan nio och tolv. Vi svarar också gärna på e-post, men räkna med att det kan ta några dagar innan du får svar.',
          'Tänk på att parkeringen vid lokalen är begränsad. Vi rekommenderar att du tar bussen eller cyklar, och den som behöver hjälp med resan kan höra av sig till kansliet så försöker vi ordna samåkning.',
          'Ta gärna med dig årsredovisningen, som skickas ut till alla medlemmar två veckor före mötet. Den finns också att hämta på kansliet för den som inte har fått den med posten.',
          'Valberedningen tar gärna emot förslag på kandidater till styrelsen fram till två veckor före mötet. Den som vill föreslå någon kan göra det skriftligt eller muntligt, men den föreslagna ska ha tackat ja innan förslaget lämnas in.',
          'Styrelsen föreslår att årsavgiften lämnas oförändrad för det kommande året. Förslaget och styrelsens motivering finns med bland handlingarna, tillsammans med budgeten och verksamhetsplanen för nästa år.',
          'Lokalen är tillgänglig för rullstol, och det finns hörslinga i den stora salen. Meddela gärna i förväg om du behöver någon annan hjälp under mötet, så ordnar vi det så gott vi kan.',
          'Barn är välkomna att följa med, och under mötet finns det lek och fika i rummet bredvid. Två av föreningens ledare tar hand om barnen, så att föräldrarna kan delta i mötet i lugn och ro.',
          'Protokollet från mötet justeras inom två veckor och skickas sedan ut till alla medlemmar. Det finns också att läsa på kansliet, där du kan ställa frågor om besluten till styrelsen.',
          'Föreningen fyller femtio år i höst, och styrelsen vill gärna höra vad medlemmarna tycker att vi ska göra för att fira. Skriv ditt förslag under Övrigt i blanketten, eller berätta om det för någon i styrelsen under kvällen.',
          'Vi tackar alla som har hjälpt till under året, både i styrelsen, i kommittéerna och vid våra arrangemang. Utan er skulle föreningen inte kunna göra så mycket som den gör, och vi hoppas att ni vill fortsätta även nästa år.',
        ]),
        item(1, `Namn: ${blank(30)}`),
        item(1, `Medlemsnummer: ${blank(20)}`),
        item(1, `Telefon: ${blank(24)}`),
        item(1, `E-post: ${blank(26)}`),
        item(1, 'Deltar du i middagen efter mötet?   ☐ Ja   ☐ Nej'),
        item(1, `Allergier eller önskemål om maten: ${blank(16)}`),
        item(
          1,
          'Lämnar du fullmakt åt en annan medlem? Skriv i så fall namnet på den som ska rösta för dig, och lämna fullmakten till ordföranden innan mötet börjar.',
        ),
        item(1, `Övrigt: ${blank(30)}`),
      ],
    },
  },
  {
    name: 'anmalan-tva-spalter',
    language: 'sv',
    summary:
      'A numbered list set in two columns in the middle of the page, with full-width text above and below and only ordinary spacing between: read down the left column, then the right.',
    features: ['word-numbering', 'columns-inside-flow', 'column-break-continuation'],
    word: {
      lists: [{ id: 1, levels: [['decimal', '%1.']] }],
      footer: 'Sida {PAGE}',
      blocks: [
        title('Anmälan till sommarlägret'),
        para(
          'Fyll i uppgifterna nedan och lämna blanketten till din ledare senast den 15 maj. Vi behöver veta vem du är, hur vi når dig och dina föräldrar, och om det finns något vi måste tänka på under lägret.',
        ),
        columns(2, [
          item(1, 'Namn'),
          item(1, 'Födelsedatum'),
          item(1, 'Adress'),
          item(1, 'Postnummer och ort'),
          item(1, 'Telefon'),
          item(1, 'Förälders namn'),
          item(1, 'Förälders telefon'),
          item(1, 'Allergier'),
          item(1, 'Mediciner'),
          item(1, 'Simkunnig'),
        ]),
        para(
          'Lägret kostar 1 200 kronor, som betalas in till föreningens bankgiro senast den 1 juni. Om du har frågor om lägret kan du vänligen kontakta din ledare, som gärna berättar mer.',
        ),
      ],
    },
  },
  {
    name: 'enkat-rutnat',
    language: 'sv',
    summary:
      "A survey in two parts under headings: numbered questions with lettered answers, then a grid of yes / no / don't know checkboxes in a ruled table.",
    features: ['word-numbering', 'headings', 'checkbox-grid', 'ruled-table'],
    word: {
      lists: [
        {
          id: 1,
          levels: [
            ['decimal', '%1.'],
            ['lowerLetter', '%2)'],
          ],
        },
      ],
      blocks: [
        title('Enkät om föreningens aktiviteter'),
        para(
          'Vi vill veta vad du tycker om föreningens aktiviteter, så att vi kan göra dem bättre. Enkäten tar bara några minuter att fylla i, och svaren är anonyma. Lämna den i lådan vid entrén när du är klar.',
        ),
        heading('Del 1'),
        item(1, `Hur länge har du varit medlem? ${blank(14)}`),
        item(1, 'Hur ofta deltar du i föreningens aktiviteter?'),
        item(1, 'Varje vecka', 1),
        item(1, 'Varje månad', 1),
        item(1, 'Mer sällan', 1),
        heading('Del 2'),
        para('Kryssa i ett svar på varje rad.'),
        table(
          [
            ['', 'Ja', 'Nej', 'Vet ej'],
            ['Mötena är lagom långa', '☐', '☐', '☐'],
            ['Informationen når fram', '☐', '☐', '☐'],
            ['Lokalerna fungerar bra', '☐', '☐', '☐'],
          ],
          [4400, 1400, 1400, 1400],
        ),
        para('Tack för att du tog dig tid att svara!'),
      ],
    },
  },
  {
    name: 'typade-nummer',
    language: 'sv',
    summary:
      'Numbers typed into the text, not Word lists: "1)" items, a heading, "1 -" items with a spaced dash, then lettered answers under a question — read by the rules in both the PDF and the DOCX.',
    features: ['typed-numbering', 'nordic-numbering', 'counter-reset-on-heading', 'letter-options'],
    word: {
      blocks: [
        title('Anmälan till kursen'),
        para(
          'Kursen hålls på tisdagar under hösten och är öppen för alla medlemmar. Fyll i blanketten och lämna den till kursledaren, som hör av sig när det är klart vilka som har fått en plats.',
        ),
        para(`1) Namn: ${blank(26)}`),
        para(`2) Adress: ${blank(24)}`),
        para(`3) Telefon: ${blank(23)}`),
        heading('Tidigare erfarenhet'),
        para('1 - Har du gått kursen förut?   ☐ Ja   ☐ Nej'),
        para('2 - Vilken nivå har du?'),
        para('A. Nybörjare'),
        para('B. Van'),
        para('C. Mycket van'),
      ],
    },
  },
  {
    name: 'event-registration',
    language: 'en',
    summary:
      'Two pages under a running header, in English: sections numbered I. and II. by Word, numbered questions under each, and (a)–(d) answers under one of them; a ruled table of sessions follows.',
    features: [
      'word-numbering',
      'roman-sections',
      'enclosed-letters',
      'repeated-header',
      'footer-page-number',
      'ruled-table',
    ],
    word: {
      lists: [
        {
          id: 2,
          levels: [
            ['upperRoman', '%1.'],
            ['decimal', '%2.'],
            ['lowerLetter', '(%3)'],
          ],
        },
      ],
      header: 'Riverside Choir · Summer Workshop 2026',
      footer: 'Page {PAGE} of {NUMPAGES}',
      blocks: [
        title('Summer Workshop Registration'),
        para(
          'Thank you for your interest in the summer workshop. Please fill in this form and return it to the choir office by 1 May. We need to know which voice part you sing and which sessions you would like to attend, so that we can plan the rooms and the music. If you have any questions, the office will be happy to help.',
        ),
        item(2, 'About you'),
        item(2, `Full name: ${blank(30)}`, 1),
        item(2, `Email address: ${blank(26)}`, 1),
        item(2, 'Voice part', 1),
        item(2, 'Soprano', 2),
        item(2, 'Alto', 2),
        item(2, 'Tenor', 2),
        item(2, 'Bass', 2),
        {
          kind: 'p',
          runs: [{ text: 'Workshops' }],
          list: { id: 2, level: 0 },
          pageBreakBefore: true,
        },
        item(2, 'Which sessions will you attend? Tick them in the table below.', 1),
        item(2, `Dietary requirements: ${blank(20)}`, 1),
        table(
          [
            ['Session', 'Day', 'Attend'],
            ['Warm-up and breathing', 'Saturday', '☐'],
            ['Sight-reading', 'Saturday', '☐'],
            ['Performance practice', 'Sunday', '☐'],
          ],
          [4600, 2200, 1400],
        ),
        para('Please return this form to the choir office by 1 May.'),
      ],
    },
  },
  {
    name: 'lagerschema',
    language: 'sv',
    summary:
      'A ruled table of plain text — times, activities, places — with a header row, between an introduction and two numbered questions: read across each row, never down the columns.',
    features: ['text-table', 'ruled-table', 'word-numbering', 'blanks'],
    word: {
      lists: [{ id: 1, levels: [['decimal', '%1.']] }],
      blocks: [
        title('Schema för sommarlägret'),
        para(
          'Här är schemat för lägrets första dag. Tiderna kan ändras om vädret är dåligt, och då säger ledarna till i god tid.',
        ),
        table(
          [
            ['Tid', 'Aktivitet', 'Plats'],
            ['09.00', 'Frukost och samling', 'Matsalen'],
            ['10.30', 'Kanotpaddling på sjön', 'Bryggan'],
            ['13.00', 'Lunch', 'Matsalen'],
            ['15.00', 'Tipspromenad i skogen', 'Stora ängen'],
          ],
          [1600, 4000, 2600],
        ),
        item(1, `Namn: ${blank(30)}`),
        item(1, `Förälders telefon: ${blank(20)}`),
        para('Lämna blanketten till din ledare senast den 1 juni.'),
      ],
    },
  },
  {
    name: 'tilmelding',
    language: 'da',
    summary: 'A short Danish form: ordinary prose, and a Word list numbered 1), 2), 3), 4).',
    features: ['word-numbering', 'nordic-numbering', 'locale'],
    word: {
      lists: [{ id: 1, levels: [['decimal', '%1)']] }],
      blocks: [
        title('Tilmelding til generalforsamlingen'),
        para(PROSE.da),
        item(1, `Navn: ${blank(30)}`),
        item(1, `Adresse: ${blank(27)}`),
        item(1, `Telefon: ${blank(27)}`),
        item(1, `E-mail: ${blank(28)}`),
      ],
    },
  },
  {
    name: 'pamelding',
    language: 'nb',
    summary: 'A short Norwegian form: ordinary prose, and numbers typed into the text.',
    features: ['typed-numbering', 'locale'],
    word: {
      blocks: [
        title('Påmelding til årsmøtet'),
        para(PROSE.nb),
        para(`1. Navn: ${blank(30)}`),
        para(`2. Adresse: ${blank(27)}`),
        para(`3. Telefon: ${blank(27)}`),
      ],
    },
  },
  {
    name: 'ilmoittautuminen',
    language: 'fi',
    summary: 'A short Finnish form: ordinary prose, and a Word list with a lettered sub-list.',
    features: ['word-numbering', 'sub-list', 'locale'],
    word: {
      lists: [
        {
          id: 1,
          levels: [
            ['decimal', '%1.'],
            ['lowerLetter', '%2)'],
          ],
        },
      ],
      blocks: [
        title('Ilmoittautuminen vuosikokoukseen'),
        para(PROSE.fi),
        item(1, `Nimi: ${blank(30)}`),
        item(1, 'Yhteystiedot'),
        item(1, `Puhelin: ${blank(22)}`, 1),
        item(1, `Sähköposti: ${blank(19)}`, 1),
        item(1, `Ruokavalio: ${blank(24)}`),
      ],
    },
  },
  {
    name: 'anmeldung',
    language: 'de',
    summary:
      'A short German form: ordinary prose with "1. Mai" mid-sentence, and a Word list numbered 1. to 4.',
    features: ['word-numbering', 'ordinal-mid-sentence', 'locale'],
    word: {
      lists: [{ id: 1, levels: [['decimal', '%1.']] }],
      blocks: [
        title('Anmeldung zur Jahresversammlung'),
        para(PROSE.de),
        para('Bitte beachten Sie: Die Anmeldung ist nur bis zum 1. Mai möglich.'),
        item(1, `Name: ${blank(30)}`),
        item(1, `Anschrift: ${blank(26)}`),
        item(1, `Telefon: ${blank(27)}`),
        item(1, `E-Mail: ${blank(28)}`),
      ],
    },
  },
  {
    name: 'fotosamtycke',
    language: 'sv',
    summary:
      "A children's club permission form: numbered questions with blanks, then under a heading of their own two lines that are each one box to tick and a consent in its own words, and a signature.",
    features: ['word-numbering', 'blanks', 'single-checkbox-line', 'consent-language', 'headings'],
    word: {
      lists: [{ id: 1, levels: [['decimal', '%1.']] }],
      blocks: [
        title('Fotografering i barngruppen'),
        para(
          'Under terminen fotograferar ledarna ibland aktiviteterna i barngruppen. Bilderna visar vad barnen gör tillsammans, och vi vill gärna använda några av dem när vi berättar om verksamheten. Därför ber vi dig som är vårdnadshavare att fylla i blanketten och lämna den till ledaren vid nästa träff.',
        ),
        item(1, `Barnets namn: ${blank(26)}`),
        item(1, `Vårdnadshavarens namn: ${blank(18)}`),
        item(1, `Telefon: ${blank(30)}`),
        heading('Samtycke'),
        para(
          '☐ Jag samtycker till att bilder där mitt barn syns publiceras på föreningens webbplats.',
        ),
        para('☐ Jag samtycker till att bilderna sparas i föreningens arkiv.'),
        para(`Underskrift: ${blank(30)}`),
      ],
    },
  },
  {
    name: 'inscription',
    language: 'fr',
    summary:
      'A French registration with French typography: a no-break space before every colon and question mark, a number of people, and a yes/no question with checkboxes.',
    features: ['word-numbering', 'blanks', 'checkboxes', 'locale', 'french-punctuation'],
    word: {
      lists: [{ id: 1, levels: [['decimal', '%1.']] }],
      blocks: [
        title('Inscription à la fête du quartier'),
        para(PROSE.fr),
        item(1, `Nom\u00a0: ${blank(30)}`),
        item(1, `Adresse e-mail\u00a0: ${blank(20)}`),
        item(1, `Nombre de personnes\u00a0: ${blank(12)}`),
        item(1, 'Restez-vous pour le repas\u00a0?   ☐ Oui   ☐ Non'),
        small('Merci, et à bientôt\u00a0!'),
      ],
    },
  },
  {
    name: 'reserva-sala',
    language: 'es',
    summary:
      'A Spanish room booking: a question opened with "¿", a date, and a question whose answers are lines of one checkbox each, indented under it.',
    features: ['word-numbering', 'blanks', 'checkbox-options', 'locale'],
    word: {
      lists: [{ id: 1, levels: [['decimal', '%1.']] }],
      blocks: [
        title('Reserva de la sala de la asociación'),
        para(
          'Los socios pueden reservar las salas de la asociación para reuniones y celebraciones. Rellene el formulario y entréguelo en la secretaría al menos una semana antes de la fecha. Le confirmaremos la reserva por teléfono lo antes posible.',
        ),
        item(1, `Nombre: ${blank(30)}`),
        item(1, `Teléfono: ${blank(28)}`),
        item(1, `Fecha: ${blank(30)}`),
        item(1, '¿Qué sala necesita?'),
        para('☐ Sala grande', { indent: 567 }),
        para('☐ Sala pequeña', { indent: 567 }),
        para('☐ Cocina', { indent: 567 }),
      ],
    },
  },
  {
    name: 'rule-ballot',
    language: 'en',
    summary:
      'A ballot whose second question wraps so that its next printed line begins "12.1" — the exact numbering trap of the brief (§8.1.1) in its hardest form — and whose third mentions "paragraph 4.2" mid-line.',
    features: [
      'word-numbering',
      'dotted-subnumber-wrapped-line-start',
      'decimal-not-marker',
      'checkboxes',
      'blanks',
    ],
    word: {
      lists: [{ id: 1, levels: [['decimal', '%1.']] }],
      blocks: [
        title('Ballot on the Rule Changes'),
        para(
          'At the autumn meeting the board proposed two changes to the rules of the club. Every member may vote, once, by filling in this ballot and handing it to the secretary. Ballots that arrive after the closing date are not counted.',
        ),
        item(1, `Your name: ${blank(30)}`),
        item(
          1,
          'Do you approve the change to the yearly membership fee that the board proposes in section 12.1 of the rules, to take effect from January?   ☐ Yes   ☐ No',
        ),
        item(1, 'Do you approve the new paragraph 4.2 on the use of the boats?   ☐ Yes   ☐ No'),
        item(1, `Signature: ${blank(26)}`),
        small('Ballots close on 30 November.'),
      ],
    },
  },
  {
    name: 'besiktning',
    language: 'sv',
    summary:
      'An inspection checklist with dotted sub-numbering typed into the text: sections "1." and "2.", their points "1.1" to "2.3" indented under them, yes/no boxes, a remarks blank, and two more top-level points after the sections.',
    features: ['typed-numbering', 'dotted-sub-numbering', 'checkboxes', 'blanks', 'inspection'],
    word: {
      blocks: [
        title('Besiktning av klubbstugan'),
        para(
          'Gå igenom stugan en gång om året, innan säsongen börjar, och fyll i protokollet. Det som inte fungerar skrivs upp under anmärkningar och lämnas till styrelsen, som ser till att det blir åtgärdat innan stugan hyrs ut igen.',
        ),
        para('1. Utvändigt'),
        para('1.1 Är taket helt?   ☐ Ja   ☐ Nej', { indent: 567 }),
        para('1.2 Är fönstren hela?   ☐ Ja   ☐ Nej', { indent: 567 }),
        para('1.3 Går ytterdörren att låsa?   ☐ Ja   ☐ Nej', { indent: 567 }),
        para('2. Invändigt'),
        para('2.1 Fungerar elen?   ☐ Ja   ☐ Nej', { indent: 567 }),
        para('2.2 Finns det fukt eller mögel?   ☐ Ja   ☐ Nej', { indent: 567 }),
        para(`2.3 Anmärkningar: ${blank(24)}`, { indent: 567 }),
        para(`3. Besiktigad av: ${blank(24)}`),
        para(`4. Datum: ${blank(20)}`),
      ],
    },
  },
  {
    name: 'sommarlager',
    language: 'sv',
    summary:
      'A form with no numbers at all, as most are: sections in capitals, dot leaders for blanks, a label whose blank is on the line under it, required hints ("(obligatoriskt)", "*"), a limit inside a question ("(max 7)") and a closing instruction.',
    features: [
      'unnumbered',
      'heading-in-capitals',
      'blank-line-leaders',
      'label-and-field-split',
      'required-inference',
      'number-in-question-text',
      'instruction-vs-question',
    ],
    word: {
      blocks: [
        title('Anmälan till sommarlägret'),
        para(
          'Lägret är för barn mellan åtta och tolv år och hålls vid sjön under första veckan i juli. Fyll i en blankett för varje barn och lämna den till kansliet senast den sista maj.',
        ),
        para('DELTAGARE'),
        para(`Namn (obligatoriskt) ${'.'.repeat(40)}`),
        para(`Födelsedatum ${'.'.repeat(40)}`),
        para('Vårdnadshavarens e-post*:'),
        para(blank(40)),
        para(`Hur många nätter stannar barnet? (max 7) ${blank(8)}`),
        para('MAT OCH ALLERGIER'),
        para(`Allergier eller specialkost: ${blank(30)}`),
        para('Läs lägrets regler på hemsidan innan du lämnar in anmälan.'),
        small('* = måste fyllas i'),
      ],
    },
  },
  {
    name: 'innmelding',
    language: 'nb',
    summary:
      'A Norwegian club registration numbered "(1)" to "(6)" straight on across three section headings, beside an amount in brackets in its prose; a fødselsnummer and an organisasjonsnummer; and "Navn" asked twice, once in each section.',
    features: [
      'typed-numbering',
      'parenthesised-number',
      'numbering-across-headings',
      'same-question-repeated',
      'locale-specific-fields',
      'locale',
    ],
    word: {
      blocks: [
        title('Innmelding i idrettslaget'),
        para(
          'Medlemskapet gjelder for ett kalenderår og fornyes automatisk hvis du ikke sier opp. Kontingenten er 1 200 kr for voksne (3 500 kr for hele familien) og betales innen 1. mars. Fyll ut skjemaet og lever det til kassereren, eller send det med post til klubbhuset. Ta kontakt med oss hvis noen av opplysningene endrer seg etter innmeldingen, slik at vi kan nå deg uten å lete.',
        ),
        heading('Medlem'),
        para(`(1) Navn: ${blank(30)}`),
        para(`(2) Fødselsnummer: ${blank(22)}`),
        para(`(3) E-post: ${blank(28)}`),
        heading('Foresatt'),
        para(`(4) Navn: ${blank(30)}`),
        para(`(5) Telefon: ${blank(26)}`),
        heading('Bedrift'),
        para(`(6) Organisasjonsnummer: ${blank(20)}`),
      ],
    },
  },
  {
    name: 'stamma',
    language: 'sv',
    summary:
      'A notice of the annual meeting whose lines break inside words: a soft hyphen Word users type into long words ("med\u00ADlemsregistret"), printed as a hyphen where the line breaks, and the hyphen of "e-postadress" at a line end, in prose and in a question that wraps.',
    features: [
      'word-numbering',
      'hyphenated-line-break',
      'soft-hyphen',
      'wrapped-label',
      'checkboxes',
      'blanks',
    ],
    word: {
      lists: [{ id: 1, levels: [['decimal', '%1.']] }],
      blocks: [
        title('Kallelse till föreningsstämman'),
        para(
          'Styrelsen kallar alla medlemmar till den ordinarie föreningsstämman i klubbstugan. Den som vill ha handlingarna i förväg får dem till sin e-postadress, och den som saknar en adress i med\u00ADlemsregistret kan hämta dem på kansliet under veckan före stämman.',
        ),
        item(1, `Namn: ${blank(30)}`),
        item(1, 'Kommer du till stämman?   ☐ Ja   ☐ Nej'),
        item(
          1,
          `Om du inte kan komma till stämman men vill läsa protokollet när det är klart, till vilken e-postadress ska vi skicka det? ${blank(20)}`,
        ),
      ],
    },
  },
  {
    name: 'skraning',
    language: 'is',
    summary:
      'An Icelandic membership form: Word numbering, a kennitala, an e-mail and a phone number, and a yes or no with "Já" and "Nei". Its language is not guessed: a form this short has 14 of G1\'s 20 stop words, and Icelandic writes the Latin script the others share, so G1b does not decide it either (#145).',
    features: ['word-numbering', 'blanks', 'checkboxes', 'locale', 'locale-specific-fields'],
    word: {
      lists: [{ id: 1, levels: [['decimal', '%1.']] }],
      blocks: [
        title('Skráning í félagið'),
        para(
          'Allir sem vilja ganga í félagið eru velkomnir. Fylltu út eyðublaðið og skilaðu því til gjaldkera eða sendu það í pósti. Við notum upplýsingarnar aðeins fyrir félagaskrána og látum þær ekki af hendi.',
        ),
        item(1, `Nafn: ${blank(30)}`),
        item(1, `Kennitala: ${blank(24)}`),
        item(1, `Netfang: ${blank(26)}`),
        item(1, `Sími: ${blank(28)}`),
        item(1, 'Viltu fá fréttabréf félagsins?   ☐ Já   ☐ Nei'),
      ],
    },
  },
  {
    name: 'anketa',
    language: 'ru',
    summary:
      'A Russian conference questionnaire in Cyrillic: Word numbering, a date of birth, a phone and an e-mail, a yes or no with "Да" and "Нет", and a comment.',
    features: ['word-numbering', 'blanks', 'checkboxes', 'locale', 'cyrillic'],
    word: {
      lists: [{ id: 1, levels: [['decimal', '%1.']] }],
      blocks: [
        title('Анкета участника конференции'),
        para(
          'Просим заполнить анкету и отправить её организаторам до первого мая. Мы используем ваши данные только для подготовки конференции и не передаём их третьим лицам.',
        ),
        item(1, `Фамилия и имя: ${blank(26)}`),
        item(1, `Дата рождения: ${blank(24)}`),
        item(1, `Телефон: ${blank(28)}`),
        item(1, `Электронная почта: ${blank(22)}`),
        item(1, 'Нужна ли вам гостиница?   ☐ Да   ☐ Нет'),
        item(1, `Комментарий: ${blank(28)}`),
      ],
    },
  },
  {
    name: 'moushikomi',
    language: 'ja',
    summary:
      'A Japanese application written as Japanese is typeset: full-width numbers glued to their words ("１．氏名"), full-width colons and blanks ("：＿＿＿"), and a yes or no with "はい" and "いいえ".',
    features: [
      'typed-numbering',
      'glued-marker',
      'full-width',
      'blanks',
      'checkboxes',
      'locale',
      'cjk',
    ],
    word: {
      blocks: [
        title('夏季講習会参加申込書'),
        para(
          'このたびは夏季講習会にお申し込みいただき、ありがとうございます。必要事項をご記入のうえ、事務局までご提出ください。ご記入いただいた個人情報は、講習会の運営以外には使用しません。',
        ),
        para('１．氏名：＿＿＿＿＿＿＿＿＿＿＿＿'),
        para('２．電話番号：＿＿＿＿＿＿＿＿＿＿'),
        para('３．メールアドレス：＿＿＿＿＿＿＿＿'),
        para('４．懇親会に参加しますか。　□はい　□いいえ'),
        para('５．ご意見：＿＿＿＿＿＿＿＿＿＿＿＿'),
      ],
    },
  },
  {
    name: 'ankeeto',
    language: 'ja',
    summary:
      'A Japanese survey numbered with circled numbers glued to their words ("①年代"), single choices of three boxes, and an "その他" (anything else) blank.',
    features: [
      'typed-numbering',
      'glued-marker',
      'circled-numbers',
      'checkboxes',
      'blanks',
      'locale',
      'cjk',
    ],
    word: {
      blocks: [
        title('利用者アンケート'),
        para(
          'いつも当館をご利用いただき、ありがとうございます。サービス向上のため、以下のアンケートにご協力ください。回答は統計的に処理し、個人が特定されることはありません。',
        ),
        para('①年代：＿＿＿＿＿＿＿＿'),
        para('②性別：　□男性　□女性　□回答しない'),
        para('③満足度：　□満足　□普通　□不満'),
        para('④その他：＿＿＿＿＿＿＿＿＿＿＿＿'),
      ],
    },
  },
  {
    name: 'huiyuan',
    language: 'zh',
    summary:
      'A Chinese membership form: sections headed "一、" and "二、", questions numbered "1．" to "5．" straight on across them and glued to their words, full-width colons, and a yes or no with "是" and "否".',
    features: [
      'typed-numbering',
      'glued-marker',
      'full-width',
      'numbering-across-headings',
      'blanks',
      'checkboxes',
      'locale',
      'cjk',
    ],
    word: {
      blocks: [
        title('会员登记表'),
        para(
          '欢迎加入我们的协会。请认真填写以下信息，并在月底之前交到秘书处。我们只会将这些信息用于会员管理，不会提供给任何第三方。',
        ),
        heading('一、基本信息'),
        para(`1．姓名：${blank(20)}`),
        para(`2．出生日期：${blank(16)}`),
        heading('二、联系方式'),
        para(`3．手机号码：${blank(16)}`),
        para(`4．电子邮箱：${blank(16)}`),
        para('5．是否需要发票？　□是　□否'),
      ],
    },
  },
  {
    name: 'baoming',
    language: 'zh',
    summary:
      'A Chinese event sign-up numbered with the ideographic comma ("1、姓名"), a limit inside a question ("（最多8人）") and a remarks blank.',
    features: [
      'typed-numbering',
      'glued-marker',
      'ideographic-comma',
      'number-in-question-text',
      'blanks',
      'locale',
      'cjk',
    ],
    word: {
      blocks: [
        title('活动报名表'),
        para(
          '本次活动面向全体会员，名额有限，请尽早报名。报名表填写完毕后，请交给活动负责人。如有疑问，请与秘书处联系。',
        ),
        para(`1、姓名：${blank(20)}`),
        para(`2、手机号码：${blank(16)}`),
        para(`3、参加人数（最多8人）：${blank(8)}`),
        para(`4、备注：${blank(24)}`),
      ],
    },
  },
  // ── S15 batch 2: §8.1's numbering traps on real pages, typed into the text so the rules read
  // them in the Word file as well as the PDF.
  {
    name: 'fullmakt',
    language: 'sv',
    summary:
      'A proxy form whose second paragraph begins with an initial, "A. Andersson är stämmans ordförande", which is a person and not a list (D4), above a numbered form with lettered answers indented under one question.',
    features: ['typed-numbering', 'letter-vs-word', 'letter-options', 'blanks'],
    word: {
      blocks: [
        title('Fullmakt till föreningsstämman'),
        para(
          'Den som inte kan komma till stämman kan låta en annan medlem rösta i sitt ställe. Fyll i fullmakten och lämna den till ordföranden innan stämman börjar. En medlem får bara företräda en annan medlem, och fullmakten gäller bara vid den här stämman.',
        ),
        para('A. Andersson är stämmans ordförande och tar emot alla fullmakter.'),
        para(`1. Medlemmens namn: ${blank(24)}`),
        para(`2. Medlemsnummer: ${blank(26)}`),
        para(`3. Ombudets namn: ${blank(26)}`),
        para('4. Hur ska ombudet rösta i frågan om stadgeändringen?'),
        para('A. Ja till ändringen', { indent: 567 }),
        para('B. Nej till ändringen', { indent: 567 }),
        para('C. Ombudet avgör själv', { indent: 567 }),
        para(`5. Underskrift: ${blank(28)}`),
        small('Fullmakten är giltig bara om den är undertecknad av medlemmen själv.'),
      ],
    },
  },
  {
    name: 'volunteer',
    language: 'en',
    summary:
      'A volunteer sign-up whose third question has its answers numbered "i.", "ii.", "iii." at the same indent as the questions — a scheme change that restarts and so nests (R5a) — and whose numbers then go on with "4.".',
    features: [
      'typed-numbering',
      'scheme-change-same-indent',
      'roman-options',
      'blanks',
      'checkboxes',
    ],
    word: {
      blocks: [
        title('Volunteer Sign-up'),
        para(
          'The summer festival needs about forty volunteers to run the stalls, the car park and the information tent. If you can give us a few hours, please fill in this form and hand it in at the club house, or send a photo of it to the festival committee.',
        ),
        para(`1. Full name: ${blank(28)}`),
        para(`2. Email address: ${blank(25)}`),
        para('3. Which shift can you take?'),
        para('i. Saturday morning'),
        para('ii. Saturday afternoon'),
        para('iii. Sunday morning'),
        para(`4. Phone number: ${blank(26)}`),
        para('5. Have you volunteered with us before?   ☐ Yes   ☐ No'),
        small('Thank you! We will be in touch about a week before the festival.'),
      ],
    },
  },
  {
    name: 'sommerfest',
    language: 'de',
    summary:
      'A German sign-up whose numbers jump from 3 to 5, as when a question is deleted and the rest are not renumbered: one list, flagged "sequence-jump" (R4).',
    features: ['typed-numbering', 'sequence-jump', 'blanks', 'checkboxes'],
    word: {
      blocks: [
        title('Anmeldung zum Sommerfest'),
        para(
          'Wie in jedem Jahr feiert der Verein im Juli sein Sommerfest auf dem Platz hinter dem Vereinsheim. Damit wir genug Essen und Getränke einkaufen können, bitten wir alle Mitglieder, sich mit diesem Formular anzumelden. Gäste sind herzlich willkommen, wenn sie mit einem Mitglied kommen.',
        ),
        para(`1. Name: ${blank(30)}`),
        para(`2. Telefon: ${blank(28)}`),
        para(`3. Anzahl der Personen: ${blank(16)}`),
        para('5. Bringen Sie einen Kuchen mit?   ☐ Ja   ☐ Nein'),
        para(`6. Unterschrift: ${blank(26)}`),
        small('Bitte geben Sie das Formular bis zum 15. Juni beim Vorstand ab.'),
      ],
    },
  },
  {
    name: 'generalforsamling',
    language: 'da',
    summary:
      'Two lists of one item each: "1." with a tab and a blank, which a person would call a form line (D3 accepts it), and, after a heading, "1." before a sentence with nothing to fill in, which may be a list or not (D3: a candidate). Stage 4 keeps the second a question, for the review to ask whether it is a note or a prompt (#149). Its language is not guessed: none of its common words is Danish alone, and G1 needs five.',
    features: ['typed-numbering', 'single-item-list', 'hanging-tab', 'blanks', 'headings'],
    word: {
      blocks: [
        title('Tilmelding til generalforsamlingen'),
        para(
          'Generalforsamlingen holdes i klubhuset torsdag den 20. marts klokken 19. Alle medlemmer har adgang og stemmeret, men vi beder dig tilmelde dig, så vi ved, hvor mange stole og kopper kaffe der skal stilles frem. Aflever sedlen i postkassen ved døren.',
        ),
        para(`1.\tNavn: ${blank(30)}`),
        heading('Forslag'),
        para(
          'Har du et forslag, som du gerne vil have behandlet på generalforsamlingen, skal det være bestyrelsen i hænde senest en uge før mødet.',
        ),
        para('1. Forslag skal sendes skriftligt til formanden.'),
      ],
    },
  },
  {
    name: 'reisestotte',
    language: 'nb',
    summary:
      'A Norwegian application numbered "(1)" to "(5)", with a note between two items that opens "(3 500 kroner …": a bracket and a number that are not a marker, and a list that goes on after it. Its language is not guessed: two words only Norwegian has, of the five G1 needs.',
    features: [
      'typed-numbering',
      'parenthesised-number',
      'amount-in-brackets',
      'blanks',
      'checkboxes',
    ],
    word: {
      blocks: [
        title('Søknad om reisestøtte'),
        para(
          'Klubben har satt av penger til å hjelpe medlemmer som skal delta i mesterskap langt hjemmefra. Fyll ut skjemaet og send det til kassereren før du reiser. Vi behandler søknadene etter hvert som de kommer inn, og du får svar i løpet av to uker.',
        ),
        para(`(1) Navn: ${blank(30)}`),
        para(`(2) E-post: ${blank(28)}`),
        para(`(3) Beløp du søker om: ${blank(18)}`),
        para('(3 500 kroner er det meste vi kan dekke for hver søker.)'),
        para(`(4) Kontonummer: ${blank(24)}`),
        para('(5) Har du søkt om støtte fra oss før?   ☐ Ja   ☐ Nei'),
      ],
    },
  },
  {
    name: 'talkoot',
    language: 'fi',
    summary:
      'A Finnish sign-up typed with a space before each number\'s dot ("1 . Nimi"), under a line that opens with a date, "15. toukokuuta", which is no marker (V3). Its language is not guessed: 10 stop words of G1\'s 20.',
    features: ['typed-numbering', 'spaced-dot', 'ordinal-date', 'blanks', 'checkboxes'],
    word: {
      blocks: [
        title('Ilmoittautuminen kevättalkoisiin'),
        para(
          'Kevättalkoissa siivoamme seuran rannan ja laiturit kesää varten. Talkoot pidetään lauantaina, ja työt aloitetaan aamulla kello yhdeksän. Kaikki jäsenet ovat tervetulleita, myös lapset, ja seura tarjoaa talkooväelle kahvia ja lounaan. Täytä lomake ja palauta se hallituksen jäsenelle.',
        ),
        para('15. toukokuuta mennessä ilmoittautuneille varataan lounas.'),
        para(`1 . Nimi: ${blank(30)}`),
        para(`2 . Puhelin: ${blank(28)}`),
        para(`3 . Sähköposti: ${blank(26)}`),
        para('4 . Tarvitsetko lounaan?   ☐ Kyllä   ☐ Ei'),
        para(`5 . Lisätietoja: ${blank(26)}`),
      ],
    },
  },
  {
    name: 'orientering',
    language: 'sv',
    summary:
      'A club championship whose prizes are three lines that open with Swedish ordinals, "1:a", "2:a", "3:e", which look like a list and are not, and whose introduction says "den 3:e september" mid-line; the form under it is numbered "1)". Its language is not guessed: 14 stop words of G1\'s 20.',
    features: ['typed-numbering', 'ordinal-not-marker', 'headings', 'blanks', 'checkboxes'],
    word: {
      blocks: [
        title('Anmälan till klubbmästerskapet i orientering'),
        para(
          'Klubbmästerskapet avgörs söndagen den 3:e september i Hagaskogen. Första start går klockan tio, och den som hellre vill springa en kortare bana kan anmäla sig till den öppna klassen. Anmälan lämnas till tävlingsledaren senast en vecka före tävlingen.',
        ),
        heading('Priser'),
        para('1:a pris i varje klass är ett presentkort på 500 kronor.'),
        para('2:a pris är en ny kompass.'),
        para('3:e pris är en pannlampa.'),
        heading('Anmälan'),
        para(`1) Namn: ${blank(30)}`),
        para(`2) Födelseår: ${blank(26)}`),
        para('3) Klass   ☐ Herrar   ☐ Damer   ☐ Öppen'),
        para(`4) Övrigt: ${blank(30)}`),
      ],
    },
  },
  {
    name: 'socio',
    language: 'es',
    summary:
      'A Spanish membership application in five sections numbered "I." to "V." — the last of them a "V." that could be a letter (R10) — each with its questions numbered from "1." again at the same indent (R5a).',
    features: [
      'typed-numbering',
      'roman-sections',
      'letter-or-roman',
      'blanks',
      'checkboxes',
      'consent',
    ],
    word: {
      blocks: [
        title('Solicitud de alta como socio'),
        para(
          'Para hacerse socio del club basta con rellenar esta solicitud y entregarla en la secretaría, que está abierta de lunes a viernes por la tarde. La junta directiva estudia las solicitudes una vez al mes y le comunicará su decisión por correo electrónico.',
        ),
        para('I. Datos personales'),
        para(`1. Nombre y apellidos: ${blank(20)}`),
        para(`2. Fecha de nacimiento: ${blank(20)}`),
        para('II. Contacto'),
        para(`1. Teléfono: ${blank(28)}`),
        para(`2. Correo electrónico: ${blank(20)}`),
        para('III. Cuota'),
        para('1. ¿Qué cuota elige?   ☐ Individual   ☐ Familiar   ☐ Juvenil'),
        para('2. ¿Cómo quiere pagar?   ☐ Domiciliación   ☐ Transferencia'),
        para('IV. Autorización'),
        para('1. ☐ Acepto el uso de mis datos para la gestión del club.'),
        para('2. ☐ Deseo recibir el boletín de noticias.'),
        para('V. Firma'),
        para(`1. Firma del solicitante: ${blank(20)}`),
        para(`2. Fecha: ${blank(28)}`),
      ],
    },
  },
];
