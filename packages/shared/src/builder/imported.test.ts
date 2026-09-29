import { describe, expect, it } from 'vitest';
import { emptyDefinition, type Field } from '../forms/definition.js';
import { jsonEqual } from './changes.js';
import { newQuestion } from './fields.js';
import { BUILDER_GRAPH } from './graph/nodes.js';
import { answer, back, begin, guardStateOf, importQuestions, replay, trail } from './machine.js';
import { fromSession, toSession } from './session.js';
import { MachineError } from './state.js';

/**
 * "Use these questions" on the review screen (S10): the questions read from a document, added as
 * one step in the conversation's log — `IMPORT-PIPELINE.md` §8.
 */

const G = BUILDER_GRAPH;
const fresh = () =>
  begin(G, {
    definition: emptyDefinition,
    title: {},
    pending: { brandKitExists: false, canChangeBrand: true },
  });

const question = (id: string, key: string, label: string): Field =>
  newQuestion({ id, key, type: 'short_text', label: { 'sv-SE': label }, required: false });

const two = [question('q-namn', 'namn', 'Namn'), question('q-adress', 'adress', 'Adress')];

const refusal = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    if (error instanceof MachineError) return error.code;
    throw error;
  }
  return null;
};

describe('importing the questions a document was read as', () => {
  it('adds them in order, as one step, and the conversation stays where it was', () => {
    const c = fresh();
    const after = importQuestions(c, two);
    expect(after.state.draft.definition.fields.map((f) => f.id)).toEqual(['q-namn', 'q-adress']);
    expect(after.log).toHaveLength(1);
    expect(after.log[0]).toMatchObject({
      answer: { kind: 'import', count: 2 },
      source: 'import',
      nodeId: c.state.cursor,
      to: c.state.cursor,
    });
    expect(after.state.cursor).toBe(c.state.cursor);
    expect(jsonEqual(replay(after.base, after.log), after.state)).toBe(true);
  });

  it('is undone by Back, exactly', () => {
    const c = answer(G, fresh(), { kind: 'option', optionId: 'signup' }, { locale: 'sv-SE' });
    expect(jsonEqual(back(importQuestions(c, two)), c)).toBe(true);
  });

  it('records each as the import’s, never reuses an id, and says where the form came from', () => {
    const empty = importQuestions(fresh(), two).state;
    expect(empty.sidecar.fields['q-namn']).toEqual({ source: 'import' });
    expect(empty.sidecar.retiredIds).toEqual(['q-namn', 'q-adress']);
    expect(empty.sidecar.provenance).toBe('import');

    // Into a form that already has a question: mixed.
    let c = fresh();
    c = answer(G, c, { kind: 'option', optionId: 'signup' }, { locale: 'sv-SE' });
    c = answer(G, c, { kind: 'option', optionId: 'unsure' }, { locale: 'sv-SE' });
    c = answer(G, c, { kind: 'option', optionId: 'unsure' }, { locale: 'sv-SE' });
    c = answer(G, c, { kind: 'option', optionId: 'later' }, { locale: 'sv-SE' });
    c = answer(G, c, { kind: 'text', value: 'Vilken dag?' }, { locale: 'sv-SE' });
    expect(importQuestions(c, two).state.sidecar.provenance).toBe('mixed');

    // A second document into a form the first one made: still an imported form.
    const second = importQuestions(importQuestions(fresh(), two), [
      question('q-tel', 'telefon', 'Telefon'),
    ]);
    expect(second.state.sidecar.provenance).toBe('import');
  });

  it('counts the questions it adds, not the headings and text that come with them', () => {
    const heading = {
      id: 'q-rubrik',
      key: 'personuppgifter',
      type: 'section_break',
      width: 'full',
      label: { 'sv-SE': 'Personuppgifter' },
    } as unknown as Field;
    const text = {
      id: 'q-text',
      key: 'text',
      type: 'rich_text',
      width: 'full',
      content: { 'sv-SE': 'Fyll i med versaler.' },
    } as unknown as Field;
    const after = importQuestions(fresh(), [heading, ...two, text]);
    expect(after.state.draft.definition.fields).toHaveLength(4);
    expect(after.log[0]!.answer).toEqual({ kind: 'import', count: 2 });
    // Headings and text alone are nothing to add.
    expect(refusal(() => importQuestions(fresh(), [heading, text]))).toBe('nothing-to-do');
  });

  it('refuses an id the form ever used, a key it has, nothing at all, or a question it cannot hold', () => {
    const c = importQuestions(fresh(), two);
    expect(refusal(() => importQuestions(c, [question('q-namn', 'namn_2', 'Namn')]))).toBe(
      'invalid-draft',
    );
    expect(refusal(() => importQuestions(c, [question('q-ny', 'adress', 'Adress')]))).toBe(
      'invalid-draft',
    );
    expect(refusal(() => importQuestions(c, []))).toBe('nothing-to-do');
    const unlabelled = { ...question('q-x', 'x', 'X'), type: 'nonsense' } as unknown as Field;
    expect(refusal(() => importQuestions(fresh(), [unlabelled]))).toBe('invalid-draft');
  });

  it('answers no node: in the trail, but not what `answered()` reads', () => {
    const c = importQuestions(fresh(), two);
    expect(trail(c)).toEqual([
      { step: 0, nodeId: 'flow.start', answer: { kind: 'import', count: 2 }, skipped: [] },
    ]);
    expect(guardStateOf(c).answered).toEqual([]);
  });

  it('is saved and replayed like any step', () => {
    const c = importQuestions(fresh(), two);
    const again = fromSession(JSON.parse(JSON.stringify(toSession(G, c))));
    expect(jsonEqual(again.state, c.state)).toBe(true);
  });
});
