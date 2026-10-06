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
  it('adds them in order, as one step, and goes on to walking them (S12)', () => {
    const c = fresh();
    const after = importQuestions(G, c, two);
    expect(after.state.draft.definition.fields.map((f) => f.id)).toEqual(['q-namn', 'q-adress']);
    expect(after.log).toHaveLength(1);
    expect(after.log[0]).toMatchObject({
      answer: { kind: 'import', count: 2 },
      source: 'import',
      nodeId: c.state.cursor,
      to: 'import.walk',
    });
    expect(after.state.cursor).toBe('import.walk');
    expect(jsonEqual(replay(after.base, after.log), after.state)).toBe(true);
  });

  it('is undone by Back, exactly', () => {
    const c = answer(G, fresh(), { kind: 'option', optionId: 'signup' }, { locale: 'sv-SE' });
    expect(jsonEqual(back(importQuestions(G, c, two)), c)).toBe(true);
  });

  it('records each as the import’s, never reuses an id, and says where the form came from', () => {
    const empty = importQuestions(G, fresh(), two).state;
    expect(empty.sidecar.fields['q-namn']).toEqual({ source: 'import' });
    expect(empty.sidecar.retiredIds).toEqual(['q-namn', 'q-adress']);
    expect(empty.sidecar.provenance).toBe('import');

    // Into a form that already has a question: mixed.
    let c = fresh();
    c = answer(G, c, { kind: 'option', optionId: 'signup' }, { locale: 'sv-SE' });
    c = answer(G, c, { kind: 'option', optionId: 'unsure' }, { locale: 'sv-SE' });
    c = answer(G, c, { kind: 'option', optionId: 'unsure' }, { locale: 'sv-SE' });
    c = answer(G, c, { kind: 'text', value: 'Sommarfest' }, { locale: 'sv-SE' });
    c = answer(G, c, { kind: 'option', optionId: 'later' }, { locale: 'sv-SE' });
    c = answer(G, c, { kind: 'text', value: 'Vilken dag?' }, { locale: 'sv-SE' });
    expect(importQuestions(G, c, two).state.sidecar.provenance).toBe('mixed');

    // A second document into a form the first one made: still an imported form.
    const second = importQuestions(G, importQuestions(G, fresh(), two), [
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
    const after = importQuestions(G, fresh(), [heading, ...two, text]);
    expect(after.state.draft.definition.fields).toHaveLength(4);
    expect(after.log[0]!.answer).toEqual({ kind: 'import', count: 2 });
    // Headings and text alone are nothing to add.
    expect(refusal(() => importQuestions(G, fresh(), [heading, text]))).toBe('nothing-to-do');
  });

  it('refuses an id the form ever used, a key it has, nothing at all, or a question it cannot hold', () => {
    const c = importQuestions(G, fresh(), two);
    expect(refusal(() => importQuestions(G, c, [question('q-namn', 'namn_2', 'Namn')]))).toBe(
      'invalid-draft',
    );
    expect(refusal(() => importQuestions(G, c, [question('q-ny', 'adress', 'Adress')]))).toBe(
      'invalid-draft',
    );
    expect(refusal(() => importQuestions(G, c, []))).toBe('nothing-to-do');
    const unlabelled = { ...question('q-x', 'x', 'X'), type: 'nonsense' } as unknown as Field;
    expect(refusal(() => importQuestions(G, fresh(), [unlabelled]))).toBe('invalid-draft');
  });

  it('answers no node: in the trail, but not what `answered()` reads', () => {
    const c = importQuestions(G, fresh(), two);
    expect(trail(c)).toEqual([
      { step: 0, nodeId: 'flow.start', answer: { kind: 'import', count: 2 }, skipped: [] },
    ]);
    expect(guardStateOf(c).answered).toEqual([]);
  });

  it('is saved and replayed like any step', () => {
    const c = importQuestions(G, fresh(), two);
    const again = fromSession(JSON.parse(JSON.stringify(toSession(G, c))));
    expect(jsonEqual(again.state, c.state)).toBe(true);
  });
});

/** The paper twin (S12b, `CONVERGENCE.md`): a PDF the form keeps arrives with its questions. */
describe('the paper a document was read from', () => {
  const KEY = `${'a'.repeat(64)}.pdf`;
  const OTHER = `${'b'.repeat(64)}.pdf`;
  const anchored = (id: string, key: string, label: string): Field => ({
    ...question(id, key, label),
    paper: { page: 0, x: 0.3, y: 0.1, w: 0.5, h: 0.02 },
  });

  it('joins the form’s sources in the same step as its questions, and Back takes both away', () => {
    const c = fresh();
    const after = importQuestions(
      G,
      c,
      [anchored('q-namn', 'namn', 'Namn')],
      {},
      {
        key: KEY,
        pages: 2,
      },
    );
    expect(after.state.draft.definition.paper).toEqual({ sources: [{ key: KEY, pages: 2 }] });
    expect(after.state.draft.definition.fields[0]).toMatchObject({ paper: { page: 0 } });
    expect(after.log).toHaveLength(1);
    expect(jsonEqual(back(after), c)).toBe(true);
    expect(jsonEqual(replay(after.base, after.log), after.state)).toBe(true);
  });

  it('follows the sources the form already keeps', () => {
    const once = importQuestions(
      G,
      fresh(),
      [question('q-a', 'a', 'A')],
      {},
      { key: KEY, pages: 2 },
    );
    const twice = importQuestions(
      G,
      once,
      [question('q-b', 'b', 'B')],
      {},
      { key: OTHER, pages: 1 },
    );
    expect(twice.state.draft.definition.paper?.sources).toEqual([
      { key: KEY, pages: 2 },
      { key: OTHER, pages: 1 },
    ]);
  });

  it('is left as it is by an import with no paper: a Word file or a paste', () => {
    const once = importQuestions(
      G,
      fresh(),
      [question('q-a', 'a', 'A')],
      {},
      { key: KEY, pages: 2 },
    );
    const pasted = importQuestions(G, once, [question('q-b', 'b', 'B')]);
    expect(pasted.state.draft.definition.paper).toEqual({ sources: [{ key: KEY, pages: 2 }] });
  });

  it('is refused whole when it is not one the form could keep', () => {
    expect(() =>
      importQuestions(G, fresh(), [question('q-a', 'a', 'A')], {}, { key: 'x.pdf', pages: 2 }),
    ).toThrow();
  });
});
