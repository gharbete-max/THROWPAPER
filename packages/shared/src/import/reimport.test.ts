import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  compareImport,
  dice,
  nothingChanged,
  planImport,
  type Comparison,
  type CompareInput,
  type ImportChoices,
  type ImportPlan,
} from './reimport.js';

/**
 * Stage 9 — `docs/plan/CONVERGENCE.md` (S12c). Each fixture in `fixtures/reimport/` is a form and
 * the document read again, with what the comparison must give, written by hand before the code;
 * some also say what the person chose and what is then done. Compared whole.
 */

interface Fixture extends CompareInput {
  readonly note: string;
  readonly expect: Comparison;
  readonly choices?: ImportChoices;
  readonly plan?: ImportPlan;
}

const dir = new URL('../../../../fixtures/reimport/', import.meta.url);
const fixtures = readdirSync(dir)
  .filter((file) => file.endsWith('.json'))
  .sort()
  .map((file) => ({
    name: file.replace(/\.json$/u, ''),
    fixture: JSON.parse(readFileSync(new URL(file, dir), 'utf8')) as Fixture,
  }));

describe('the fixtures', () => {
  it('are there, thirteen of them at least', () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(13);
  });

  for (const { name, fixture } of fixtures) {
    it(`${name}: ${fixture.note}`, () => {
      const comparison = compareImport(fixture);
      expect(comparison).toEqual(fixture.expect);
      if (fixture.choices) {
        expect(planImport(fixture, comparison, fixture.choices)).toEqual(fixture.plan);
      }
    });
  }
});

describe('Dice', () => {
  it('is twice the shared bigrams over both counts, exactly', () => {
    expect(dice('Vilken dag kommer du?', 'Vilken dag kommer ni?')).toEqual({
      twice: 34,
      total: 40,
    });
    expect(dice('Telefon', 'Telefonnummer')).toEqual({ twice: 12, total: 18 });
    // Counted with multiplicity: "aaa" has "aa" twice, "aa" once.
    expect(dice('aaa', 'aa')).toEqual({ twice: 2, total: 3 });
  });

  it('reads text as the comparison does: case, width and white space aside', () => {
    expect(dice('  NAMN  ', 'namn')).toEqual({ twice: 6, total: 6 });
    expect(dice('Ｎａｍｎ', 'Namn')).toEqual({ twice: 6, total: 6 });
  });

  it('gives texts too short for a bigram 1/1 when equal, else 0/1', () => {
    expect(dice('Å', 'å')).toEqual({ twice: 1, total: 1 });
    expect(dice('Å', 'Ä')).toEqual({ twice: 0, total: 1 });
    expect(dice('', 'Namn')).toEqual({ twice: 0, total: 3 });
  });
});

describe('at the edges', () => {
  const question = (id: string, text: string, fromDocument = true) => ({
    id,
    family: 'question' as const,
    text,
    fromDocument,
  });

  it('matches by wording exactly at the fourth fifth, and not a hair under it', () => {
    // "abcdefghijk" and "abcdefghijX": 10 and 10 bigrams, 9 shared — 18/20, 9/10.
    // Five bigrams in each, four shared: 8/10, exactly 4/5.
    const at = compareImport({
      form: [question('q-old', 'abcdef')],
      document: [{ id: 'q-new', family: 'question', text: 'abcdeX' }],
      retired: [],
    });
    expect(dice('abcdef', 'abcdeX')).toEqual({ twice: 8, total: 10 });
    expect(at.matches).toEqual([{ formId: 'q-old', by: 'wording' }]);
    // Four bigrams each, three shared: 6/8, under 4/5.
    const under = compareImport({
      form: [question('q-old', 'abcde')],
      document: [{ id: 'q-new', family: 'question', text: 'abcdX' }],
      retired: [],
    });
    expect(under.matches).toEqual([{ formId: null, by: null }]);
  });

  it('never matches across families, even word for word', () => {
    const across = compareImport({
      form: [{ id: 'h-namn', family: 'heading', text: 'Namn', fromDocument: true }],
      document: [{ id: 'q-namn', family: 'question', text: 'Namn' }],
      retired: [],
    });
    expect(across.matches).toEqual([{ formId: null, by: null }]);
    expect(across.added).toEqual([0]);
    expect(across.gone).toEqual(['h-namn']);
  });

  it('matches nothing by the same wording when either side has it twice', () => {
    const twice = compareImport({
      form: [
        question('q-1', 'Namn'),
        question('q-2', 'x'),
        question('q-3', 'y'),
        question('q-4', 'z'),
        question('q-5', 'w'),
        question('q-6', 'Namn'),
      ],
      document: [
        { id: 'a', family: 'question', text: 'a' },
        { id: 'b', family: 'question', text: 'b' },
        { id: 'c', family: 'question', text: 'c' },
        { id: 'd', family: 'question', text: 'd' },
        { id: 'e', family: 'question', text: 'e' },
        { id: 'f', family: 'question', text: 'f' },
        { id: 'g', family: 'question', text: 'g' },
        { id: 'n', family: 'question', text: 'Namn' },
      ],
      retired: [],
    });
    // "Namn" is at ordinal 8: q-6 (6) is near it; q-1 (1) is not, and is not matched by the
    // same wording either, since the form has "Namn" twice.
    expect(twice.matches[7]).toEqual({ formId: 'q-6', by: 'wording' });
    expect(twice.gone).toContain('q-1');
  });

  it('says nothing changed only when there is nothing to add and nothing to ask', () => {
    const same = compareImport({
      form: [question('q-namn', 'Namn')],
      document: [{ id: 'q-namn', family: 'question', text: 'Namn' }],
      retired: [],
    });
    expect(nothingChanged(same)).toBe(true);
    const handMade = compareImport({
      form: [question('q-namn', 'Namn'), question('q-mine', 'Mine', false)],
      document: [{ id: 'q-namn', family: 'question', text: 'Namn' }],
      retired: [],
    });
    expect(nothingChanged(handMade)).toBe(true);
  });

  it('does nothing it did not ask', () => {
    const input: CompareInput = {
      form: [question('q-namn', 'Namn'), question('q-mine', 'Mine', false)],
      document: [{ id: 'q-namn', family: 'question', text: 'Namn' }],
      retired: [],
    };
    const plan = planImport(input, compareImport(input), {
      addBack: [0],
      reword: [0],
      remove: ['q-mine', 'q-namn'],
      move: [0],
    });
    expect(plan).toEqual({ place: [], reword: [], remove: [] });
  });

  it('gives the same JSON for the same input, byte for byte, for every fixture', () => {
    for (const { fixture } of fixtures) {
      const copy = JSON.parse(JSON.stringify(fixture)) as Fixture;
      expect(JSON.stringify(compareImport(copy))).toBe(JSON.stringify(compareImport(fixture)));
    }
  });
});
