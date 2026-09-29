import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { canonicalJson } from '../debug.js';
import { enumerate } from '../enumerate/enumerate.js';
import { parseLayoutDocument } from '../ir/validate.js';
import { LAYOUT_LANGUAGES } from '../layout/lexicon.js';
import { pasteDocument } from '../paste.js';
import { segment } from '../segment/segment.js';
import type { QuestionSegment } from '../segment/types.js';
import { classify, WEIGHTS } from './classify.js';
import { CLASSIFY_LEXICONS, wordsIn } from './lexicon.js';
import {
  SHAPE_FEATURES,
  WORD_FEATURES,
  type Classification,
  type Feature,
  type Kind,
} from './types.js';

/**
 * Stage 5 — `IMPORT-PIPELINE.md` §5. A row for every feature (`CAVEATS.md` §8.4), the kinds in
 * every language's word list, and the ledger rows #26–#29, each on the smallest document that
 * shows it.
 */

function read(text: string, locale: string | null = null) {
  const doc = { ...pasteDocument(text), locale };
  const segments = segment(doc, enumerate(doc).output).output;
  return { segments, classified: classify(doc, segments).output.classified };
}
const first = (text: string, locale: string | null = null): Classification =>
  read(text, locale).classified[0]!;

/** A grid needs geometry a paste cannot draw: the fixtures made for stage 4 have it. */
function readFixture(name: string): Classification[] {
  const path = new URL(`../../../../../fixtures/numbering/${name}.json`, import.meta.url);
  const doc = parseLayoutDocument(JSON.parse(readFileSync(path, 'utf8')).input);
  return classify(doc, segment(doc, enumerate(doc).output).output).output.classified;
}

/** One row per feature: a label that has it, and the kind it should then win. */
const FEATURE_ROWS: Array<[Feature, string, Kind]> = [
  ['nameWord', 'Namn: ______', 'short_text'],
  ['emailWord', 'E-post: ______', 'email'],
  ['phoneWord', 'Mobiltelefon: ______', 'phone'],
  ['addressWord', 'Postadress: ______', 'address'],
  ['dateWord', 'Födelsedatum: ______', 'date'],
  ['timeWord', 'Ankomsttid: ______', 'time'],
  ['numberWord', 'Antal gäster: ______', 'number'],
  ['currencyHint', 'Belopp: ______', 'money'],
  ['personnummerWord', 'Personnummer: ______', 'personnummer'],
  ['orgNrWord', 'Organisationsnummer: ______', 'orgnr'],
  ['signatureHint', 'Vårdnadshavares underskrift: ______', 'signature'],
  ['fileHint', 'Bifoga intyg: ______', 'file'],
  ['consentHint', '☐ Jag samtycker till att bilder publiceras.', 'consent'],
  ['commentWord', 'Övriga kommentarer: ______', 'long_text'],
  ['selectAllPhrase', 'Vilka dagar? Välj en eller flera. ☐ Lördag ☐ Söndag', 'multi_select'],
  ['repeatableHint', 'Namn per person: ______', 'short_text'],
  ['required', 'Namn (obligatoriskt): ______', 'short_text'],
  ['optional', 'Namn (frivilligt): ______', 'short_text'],
  ['maxWords', 'Antal gäster (max 8): ______', 'number'],
  ['minWords', 'Antal gäster (minst 2): ______', 'number'],
  ['answerBoolean', 'Kommer du? ☐ Ja ☐ Nej', 'yes_no'],
  ['answerChoice', 'Storlek: ☐ S ☐ M ☐ L', 'single_select'],
  ['booleanPair', 'Kommer du? ☐ Ja ☐ Nej', 'yes_no'],
  ['singleCheckbox', '☐ Jag vill ha nyhetsbrevet.', 'yes_no'],
  ['gridAlignment', 'fixture:checkbox-grid', 'grid'],
  ['gridSingleColumn', 'fixture:grid-table-reference', 'multi_select'],
  ['tableRows', 'Deltagare\nNamn\t\t\t\tTelefon\n1\n2', 'repeating_group'],
  ['multiLineBlank', 'Beskriv lägret: ______\n______', 'long_text'],
  [
    'longPromptNoBlank',
    `1. ${'Berätta om vad du har gjort i föreningen och vad du vill göra. '.repeat(3).trim()}`,
    'long_text',
  ],
  ['datePattern', 'Dag (ÅÅÅÅ-MM-DD): ______', 'date'],
  ['timeSlotPattern', 'Från kl. 18.00: ______', 'time'],
];

describe('stage 5, classify: every feature', () => {
  it('has a row for every feature there is, and every row names a real one', () => {
    expect(new Set(FEATURE_ROWS.map(([feature]) => feature))).toEqual(
      new Set([...WORD_FEATURES, ...SHAPE_FEATURES]),
    );
  });

  it.each(FEATURE_ROWS)('%s: "%s" is %s', (feature, text, kind) => {
    const classified = text.startsWith('fixture:')
      ? readFixture(text.slice('fixture:'.length))
      : read(text, 'sv').classified;
    const found = classified.find((c) => c.features.includes(feature));
    expect(found, JSON.stringify(classified)).toBeDefined();
    expect(found!.kind).toBe(kind);
  });

  it('with no feature at all, guesses short text in the flag bucket (acceptance S4)', () => {
    const [one, two] = read('1. Question one\n2. Question two').classified;
    for (const c of [one!, two!]) {
      expect(c).toMatchObject({ kind: 'short_text', runnerUp: 'long_text', features: [], why: [] });
      expect(c.confidence).toBeGreaterThanOrEqual(550);
      expect(c.confidence).toBeLessThan(850);
    }
  });

  it('offers the review screen its top three kinds, the winner first, the runner-up second', () => {
    const texts = [
      '1. Question one',
      'E-post: ______',
      'Vilka dagar? Välj en eller flera. ☐ Lördag ☐ Söndag',
      'Kommer du? ☐ Ja ☐ Nej',
    ];
    for (const text of texts) {
      const c = first(text, 'sv');
      expect(c.alternatives[0]).toBe(c.kind);
      expect(c.alternatives[1] ?? null).toBe(c.runnerUp);
      expect(c.alternatives.length).toBeLessThanOrEqual(3);
      expect(new Set(c.alternatives).size).toBe(c.alternatives.length);
    }
    expect(first('1. Question one').alternatives).toEqual(['short_text', 'long_text', 'number']);
  });

  it('keeps the three features that weighed most, strongest first', () => {
    const c = first('Födelsedatum (ÅÅÅÅ-MM-DD): ______', 'sv');
    // Equal weights: code-point order of their names.
    expect(c.why).toEqual(['datePattern', 'dateWord']);
    expect(c.confidence).toBe(1000);
  });

  it('never lets a feature a kind does not weigh decide it, and every weight is an integer', () => {
    for (const [kind, { bias, features }] of Object.entries(WEIGHTS.kinds)) {
      expect(Number.isSafeInteger(bias), kind).toBe(true);
      for (const weight of Object.values(features)) expect(Number.isSafeInteger(weight)).toBe(true);
    }
  });
});

describe('stage 5, classify: the words of twelve languages', () => {
  const ROWS: Array<[string, string, Kind]> = [
    ['da', 'Navn: ____', 'short_text'],
    ['da', 'E-mail: ____', 'email'],
    ['de', 'Telefonnummer: ____', 'phone'],
    ['de', 'Anschrift: ____', 'address'],
    ['en', 'Email address: ____', 'email'],
    ['en', 'Date of birth: ____', 'date'],
    ['es', 'Correo electrónico: ____', 'email'],
    ['es', 'Fecha de nacimiento: ____', 'date'],
    ['fi', 'Sähköpostiosoite: ____', 'email'],
    ['fi', 'Puhelin: ____', 'phone'],
    ['fr', 'Adresse e-mail : ____', 'email'],
    ['fr', 'Téléphone : ____', 'phone'],
    ['is', 'Netfang: ____', 'email'],
    ['is', 'Heimilisfang: ____', 'address'],
    ['ja', 'メールアドレス: ____', 'email'],
    ['ja', '電話番号: ____', 'phone'],
    ['nb', 'E-postadresse: ____', 'email'],
    ['nb', 'Fødselsdato: ____', 'date'],
    ['ru', 'Электронная почта: ____', 'email'],
    ['ru', 'Телефон: ____', 'phone'],
    ['sv', 'Hemadress: ____', 'address'],
    ['sv', 'Signatur: ____', 'signature'],
    ['zh', '电子邮件: ____', 'email'],
    ['zh', '联系电话: ____', 'phone'],
  ];

  it('covers every shipped language', () => {
    expect(new Set(ROWS.map(([language]) => language))).toEqual(new Set(LAYOUT_LANGUAGES));
    for (const language of LAYOUT_LANGUAGES) {
      expect(CLASSIFY_LEXICONS[language].language).toBe(language);
    }
  });

  it.each(ROWS)(
    '%s: "%s" is %s, on a document in that language and on one of none',
    (language, text, kind) => {
      expect(first(text, language).kind).toBe(kind);
      expect(first(text, null).kind).toBe(kind);
    },
  );

  it('claims each word once: an e-mail address is not also an address', () => {
    const words = wordsIn('E-mail address', ['en']);
    expect(words.matches.map((m) => m.feature)).toEqual(['emailWord']);
    expect(wordsIn('E-postadress', ['sv']).matches.map((m) => m.feature)).toEqual(['emailWord']);
    expect(wordsIn('Postadress', ['sv']).matches.map((m) => m.feature)).toEqual(['addressWord']);
  });
});

describe('stage 5, classify: the ledger', () => {
  it('#26: an asterisk or a required word is required; no hint is unknown, never "optional"', () => {
    expect(first('Namn *: ______')).toMatchObject({ required: 'yes', requiredBy: '*' });
    expect(first('Namn (obligatoriskt): ______')).toMatchObject({
      required: 'yes',
      requiredBy: 'obligatoriskt',
    });
    expect(first('Name (Pflichtfeld): ______')).toMatchObject({ required: 'yes' });
    expect(first('Nimi (pakollinen): ______')).toMatchObject({ required: 'yes' });
    expect(first('Navn (påkrevd): ______')).toMatchObject({ required: 'yes' });
    expect(first('Namn (ej obligatoriskt): ______')).toMatchObject({
      required: 'no',
      requiredBy: 'ej obligatoriskt',
    });
    expect(first('Allergier (frivilligt): ______')).toMatchObject({ required: 'no' });
    expect(first('Namn: ______')).toMatchObject({ required: 'unknown', requiredBy: null });
  });

  it("#27: a locale's check is applied only on a document in that language; otherwise it is a chip", () => {
    // A Swedish document: the Swedish check.
    expect(first('Personnummer: ______', 'sv').format).toEqual({
      name: 'se-personnummer',
      apply: true,
    });
    // A Norwegian document that says "personnummer": the Norwegian check, never the Swedish one.
    expect(first('Personnummer: ______', 'nb').format).toEqual({
      name: 'no-fodselsnummer',
      apply: true,
    });
    expect(first('Fødselsnummer: ______', 'nb').format).toEqual({
      name: 'no-fodselsnummer',
      apply: true,
    });
    // No language known: offered, never applied.
    expect(first('Organisationsnummer: ______', null).format).toEqual({
      name: 'se-orgnr',
      apply: false,
    });
    // Two languages' words at once ("personnummer" is Swedish and Danish) and no language known:
    // nothing to offer rather than a guess.
    expect(first('Personnummer: ______', null).format).toBeNull();
    expect(first('Personnummer: ______', 'da').format).toEqual({ name: 'dk-cpr', apply: true });
  });

  it('#28: consent is the consent presentation, and its text is the label byte for byte', () => {
    const text =
      '☐ Jag samtycker till att  Föreningen Exempel sparar mina personuppgifter enligt GDPR, i högst två år.';
    const { segments, classified } = read(text, 'sv');
    const question = segments.segments[0] as QuestionSegment;
    expect(classified[0]).toMatchObject({ kind: 'consent', presentation: 'consent' });
    // The paste layout joins words with one space, which is all that changes.
    expect(question.label).toBe(text.slice(2).replace(/ {2,}/gu, ' '));
    expect(classified[0]!.chips).toEqual([]);
  });

  it('#29: a number inside a question stays in its label and becomes a chip, never options', () => {
    const { segments, classified } = read(
      'Hur många gäster tar du med? (max 8)\n\nAntal (minst 2, högst 10): ____',
    );
    expect(segments.segments[0]).toMatchObject({
      kind: 'question',
      label: 'Hur många gäster tar du med? (max 8)',
      options: [],
    });
    expect(classified[0]!.chips).toEqual([{ name: 'max', value: 8 }]);
    expect(classified[1]!.chips).toEqual([
      { name: 'min', value: 2 },
      { name: 'max', value: 10 },
    ]);
    expect(segments.segments).toHaveLength(2);
  });

  it("reads a table's columns as questions of their own", () => {
    const c = first('Deltagare\nNamn\t\t\t\tTelefon\t\t\t\tE-post\n1\n2\n3');
    expect(c.kind).toBe('repeating_group');
    expect(c.columns!.map((column) => [column.label, column.kind])).toEqual([
      ['Namn', 'short_text'],
      ['Telefon', 'phone'],
      ['E-post', 'email'],
    ]);
  });

  it('gives the same bytes for the same document, whichever order it was built in', () => {
    const text = 'Namn *: ____\nE-post: ____\nKommer du? ☐ Ja ☐ Nej\nÖvrigt (max 200 tecken): ____';
    const once = read(text, 'sv');
    const doc = { ...pasteDocument(text), locale: 'sv' };
    const again = classify(structuredClone(doc), structuredClone(once.segments));
    expect(canonicalJson(again.output.classified)).toBe(canonicalJson(once.classified));
    expect(again.debug.decisions.map((d) => d.rule)).toEqual(['K1', 'K1', 'K1', 'K1']);
  });
});
