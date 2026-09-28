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
];
