import { describe, expect, it } from 'vitest';
import { canonicalJson } from '../debug.js';
import { enumerate } from '../enumerate/enumerate.js';
import type { LayoutDocument } from '../ir/types.js';
import { pasteDocument } from '../paste.js';
import { isBooleanPair, isMetaLine, mentionsTable } from './lexicon.js';
import { MAX_OPTIONS, segment } from './segment.js';
import type { QuestionSegment, Segment } from './types.js';

/**
 * Stage 4 — `IMPORT-PIPELINE.md` §4. The fixtures in `fixtures/numbering/` hold each rule on a
 * document made for it (`scripts/caveat-fixtures.test.ts`); these hold the ledger rows that name
 * this file, and the stage's own promises: every line read once, and the same bytes out for the
 * same document.
 */

const read = (doc: LayoutDocument) => segment(doc, enumerate(doc).output);
const segmentsOf = (text: string) => read(pasteDocument(text)).output.segments;
const questions = (segments: Segment[]) =>
  segments.filter((s): s is QuestionSegment => s.kind === 'question');

describe('stage 4, segment', () => {
  it('#22: a sentence with nothing to answer is an instruction, never a question', () => {
    const [first, second] = segmentsOf(
      'Please read the terms and conditions.\n\nLämna blanketten i receptionen när du är klar med den.',
    );
    expect(first).toMatchObject({
      kind: 'instruction',
      text: 'Please read the terms and conditions.',
    });
    expect(second).toMatchObject({ kind: 'instruction' });
  });

  it('#23: a line in capitals is a section heading, never a field', () => {
    const [heading, name] = segmentsOf('PARTICIPANT DETAILS\nName: __________');
    expect(heading).toEqual({ kind: 'heading', lineIds: ['p1-l1'], text: 'PARTICIPANT DETAILS' });
    expect(name).toMatchObject({ kind: 'question', label: 'Name', answer: 'blank' });
    // Capitals with an answer space, or a sentence in capitals, are not headings.
    expect(segmentsOf('NAMN: __________')[0]).toMatchObject({ kind: 'question', label: 'NAMN' });
    expect(segmentsOf('OBS! LÄMNA IN SENAST 1 MAJ.')[0]).toMatchObject({ kind: 'instruction' });
  });

  it('#25: the same question in two sections stays two questions, the second flagged', () => {
    const segments = segmentsOf(
      [
        'Förälder 1',
        'Namn: __________',
        'Telefon: __________',
        '',
        'Förälder 2',
        'Namn: __________',
        'Telefon: __________',
      ].join('\n'),
    );
    const read = questions(segments);
    expect(read.map((q) => q.label)).toEqual(['Namn', 'Telefon', 'Namn', 'Telefon']);
    expect(read.map((q) => q.flags)).toEqual([[], [], ['same-as-earlier'], ['same-as-earlier']]);
  });

  it(`#30: more than ${MAX_OPTIONS} options is flagged as looking like a table or two questions`, () => {
    const options = (n: number) =>
      Array.from({ length: n }, (_, i) => `☐ Alternativ${i + 1}`).join(' ');
    const [many] = questions(segmentsOf(`Välj: ${options(MAX_OPTIONS + 1)}`));
    expect(many).toMatchObject({ answer: 'choice', flags: ['many-options'] });
    expect(many!.options).toHaveLength(MAX_OPTIONS + 1);
    const [enough] = questions(segmentsOf(`Välj: ${options(MAX_OPTIONS)}`));
    expect(enough!.flags).toEqual([]);
    // Bulleted answers under a question count the same way as boxes on a line.
    const letters = Array.from({ length: MAX_OPTIONS + 1 }, (_, i) => `\t- Svar ${i + 1}`);
    const [lettered] = questions(segmentsOf(['Vilken grupp?', ...letters].join('\n')));
    expect(lettered).toMatchObject({ label: 'Vilken grupp?', flags: ['many-options'] });
  });

  it('#24: lines of nothing but a blank under a question are more room for its answer', () => {
    const [comments, next] = segmentsOf('Övrigt: ____________\n____________\n____________\nTack!');
    expect(comments).toMatchObject({
      kind: 'question',
      label: 'Övrigt',
      answer: 'blank',
      lineIds: ['p1-l1', 'p1-l2', 'p1-l3'],
    });
    expect(next).toMatchObject({ kind: 'instruction', text: 'Tack!' });
    const [below] = segmentsOf('Beskriv din erfarenhet:\n____________\n____________');
    expect(below).toMatchObject({
      label: 'Beskriv din erfarenhet',
      lineIds: ['p1-l1', 'p1-l2', 'p1-l3'],
    });
  });

  it('rule 4b: one checkbox after a question is ticked or not, as one before it is', () => {
    const [before, after] = segmentsOf('☐ Jag vill ha nyhetsbrevet.\nHar du allergier? ☐');
    expect(before).toMatchObject({ label: 'Jag vill ha nyhetsbrevet.', answer: 'boolean' });
    expect(after).toMatchObject({ label: 'Har du allergier?', answer: 'boolean', options: [] });
  });

  it('§4.7: a question with a note in brackets after its question mark still asks', () => {
    const [q, text] = segmentsOf('Hur många gäster tar du med? (max 8)\n\nVi hörs (snart).');
    expect(q).toMatchObject({ kind: 'question', label: 'Hur många gäster tar du med? (max 8)' });
    expect(text).toMatchObject({ kind: 'instruction' });
  });

  it('rule 9: a form number or a revision is meta, and nothing like it is', () => {
    const segments = segmentsOf('Blankett 1234\n\nRev. 2024-03\n\nForm A-12\n\nVersion 2.1');
    expect(segments.map((s) => s.kind)).toEqual(['meta', 'meta', 'meta', 'meta']);
    expect(isMetaLine('Formulär för anmälan')).toBe(false);
    expect(isMetaLine('Version')).toBe(false);
    expect(isMetaLine('Form a lot of opinions 12')).toBe(false);
  });

  it('reads a yes/no pair in every shipped language, and only in its order', () => {
    for (const pair of [
      ['Ja', 'Nej'],
      ['Yes', 'No'],
      ['Kyllä', 'Ei'],
      ['Oui', 'Non'],
      ['Sí', 'No'],
      ['Да', 'Нет'],
      ['是', '否'],
      ['はい', 'いいえ'],
      ['Já', 'Nei'],
      ['JA', 'NEIN'],
    ]) {
      expect(isBooleanPair(pair), pair.join('/')).toBe(true);
    }
    expect(isBooleanPair(['Nej', 'Ja'])).toBe(false);
    expect(isBooleanPair(['Ja', 'Nej', 'Vet ej'])).toBe(false);
  });

  it('finds a pointer at a table, inflected, and not a word that only starts alike', () => {
    expect(mentionsTable('Kryssa i tabellen nedan')).toBe(true);
    expect(mentionsTable('Siehe Tabelle 2')).toBe(true);
    expect(mentionsTable('Merkitse taulukkoon')).toBe(true);
    expect(mentionsTable('请在下表中勾选')).toBe(true);
    expect(mentionsTable('Which sessions will you attend?')).toBe(false);
  });

  it('reads every line once — furniture never — in reading order', () => {
    const doc = pasteDocument(
      [
        'Anmälan',
        '',
        'Fyll i blanketten.',
        '1. Namn: ________',
        '2. Hur ofta deltar du?',
        '\ta) Varje vecka',
        '\tb) Sällan',
        '3. Postnummer ______ Ort ______',
        'Vill du ha nyhetsbrevet? ☐ Ja ☐ Nej',
        '☐ Jag godkänner villkoren.',
      ].join('\n'),
    );
    const { segments } = read(doc).output;
    const all = doc.pages.flatMap((page) => page.blocks.flatMap((block) => block.lines));
    const counts = new Map<string, number>();
    for (const s of segments) for (const id of s.lineIds) counts.set(id, (counts.get(id) ?? 0) + 1);
    for (const line of all) {
      const split = segments.filter(
        (s) =>
          s.kind === 'question' && s.flags.includes('split-line') && s.lineIds.includes(line.id),
      );
      expect(counts.get(line.id), line.text).toBe(split.length > 1 ? split.length : 1);
    }
    const firsts = segments.map((s) => all.findIndex((line) => line.id === s.lineIds[0]));
    expect(firsts).toEqual([...firsts].sort((a, b) => a - b));
  });

  it('gives the same bytes for the same document, and names a rule for every segment', () => {
    const doc = pasteDocument('1. Namn: ______\n2. Ålder?\n\tA. Under 18\n\tB. Över 18\nTack!');
    const once = read(doc);
    const twice = read(structuredClone(doc));
    expect(canonicalJson(twice)).toBe(canonicalJson(once));
    expect(once.debug.stage).toBe('segment');
    for (const s of once.output.segments) {
      expect(
        once.debug.decisions.some((d) => d.subject.join() === s.lineIds.join()),
        JSON.stringify(s),
      ).toBe(true);
    }
  });

  it('never changes the words it keeps: labels and options are the document verbatim', () => {
    const [q] = questions(segmentsOf('3.  Öhrqvists  minnesfond — gåva (kr): ____'));
    // The paste layout joins words with one space; nothing else is touched.
    expect(q!.label).toBe('Öhrqvists minnesfond — gåva (kr)');
  });
});
