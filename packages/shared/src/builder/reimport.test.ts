import { describe, expect, it } from 'vitest';
import { emptyDefinition, Field } from '../forms/definition.js';
import { jsonEqual } from './changes.js';
import { newQuestion } from './fields.js';
import { BUILDER_GRAPH } from './graph/nodes.js';
import { back, begin, importQuestions, reimport, replay, trail, type Reimport } from './machine.js';
import { fromSession, toSession } from './session.js';
import { MachineError } from './state.js';

/**
 * "Update the form" (S12c, `docs/plan/CONVERGENCE.md`): the document read again, and the form
 * brought up to date with it as one step in the conversation's log.
 */

const G = BUILDER_GRAPH;
const question = (id: string, key: string, label: string): Field =>
  newQuestion({ id, key, type: 'short_text', label: { 'sv-SE': label }, required: false });
const heading = (id: string, key: string, label: string): Field =>
  Field.parse({ id, key, type: 'section_break', label: { 'sv-SE': label } });

/** A form made from a document: a heading, then Namn, Telefon and E-post. */
const imported = () =>
  importQuestions(
    G,
    begin(G, {
      definition: emptyDefinition,
      title: {},
      pending: { brandKitExists: false, canChangeBrand: true },
    }),
    [
      heading('h-anmalan', 'anmalan', 'Anmälan'),
      question('q-namn', 'namn', 'Namn'),
      question('q-telefon', 'telefon', 'Telefon'),
      question('q-epost', 'e_post', 'E-post'),
    ],
    { 'q-namn': ['kind'], 'q-telefon': ['kind'], 'q-epost': ['kind'] },
  );
const ids = (c: ReturnType<typeof imported>) => c.state.draft.definition.fields.map((f) => f.id);

const refusal = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    if (error instanceof MachineError) return error.code;
    throw error;
  }
  return null;
};

const everything: Reimport = {
  place: [
    { kind: 'add', field: question('q-adress', 'adress', 'Adress'), after: 'q-namn', decided: [] },
    { kind: 'move', id: 'q-epost', after: 'q-adress' },
  ],
  reword: [{ id: 'q-namn', property: 'label', value: { 'sv-SE': 'Namn (som i passet)' } }],
  remove: ['q-telefon'],
};

describe('bringing a form up to date with its document', () => {
  it('adds, moves, rewords and removes, in one step, and goes on to walking what is new', () => {
    const c = imported();
    const after = reimport(G, c, everything);
    expect(ids(after)).toEqual(['h-anmalan', 'q-namn', 'q-adress', 'q-epost']);
    const namn = after.state.draft.definition.fields[1]!;
    expect('label' in namn ? namn.label : null).toEqual({ 'sv-SE': 'Namn (som i passet)' });
    expect(after.log).toHaveLength(c.log.length + 1);
    expect(after.log.at(-1)).toMatchObject({
      answer: { kind: 'reimport', added: 1, removed: 1, reworded: 1, moved: 1 },
      source: 'import',
      to: 'import.walk',
    });
    // The addition is the import's; the removed question's id stays retired, its record goes.
    expect(after.state.sidecar.fields['q-adress']).toEqual({ source: 'import' });
    expect(after.state.sidecar.fields['q-telefon']).toBeUndefined();
    expect(after.state.sidecar.retiredIds).toContain('q-telefon');
    expect(after.state.sidecar.retiredIds).toContain('q-adress');
    // The walk goes from the top, and finds what the document left open.
    expect(after.state.focus).toBeNull();
    expect(after.state.pending['toWalk']).toBe('q-namn');
  });

  it('is undone by Back exactly, replayed exactly, and saved and read back exactly', () => {
    const c = imported();
    const after = reimport(G, c, everything);
    expect(jsonEqual(back(after), c)).toBe(true);
    expect(jsonEqual(replay(after.base, after.log), after.state)).toBe(true);
    const again = fromSession(JSON.parse(JSON.stringify(toSession(G, after))));
    expect(jsonEqual(again.state, after.state)).toBe(true);
  });

  it('places each addition after the field before it in the document, or first', () => {
    const after = reimport(G, imported(), {
      place: [
        { kind: 'add', field: question('q-forst', 'forst', 'Först'), after: null, decided: [] },
        {
          kind: 'add',
          field: question('q-sedan', 'sedan', 'Sedan'),
          after: 'q-forst',
          decided: ['kind', 'required'],
        },
      ],
      reword: [],
      remove: [],
    });
    expect(ids(after).slice(0, 3)).toEqual(['q-forst', 'q-sedan', 'h-anmalan']);
    expect(after.state.sidecar.fields['q-sedan']).toEqual({
      source: 'import',
      decided: { kind: true, required: true },
    });
  });

  it('counts headings and text among what it places, not among the questions it adds', () => {
    const after = reimport(G, imported(), {
      place: [
        { kind: 'add', field: heading('h-mer', 'mer', 'Mer'), after: 'q-epost', decided: [] },
        { kind: 'add', field: question('q-ort', 'ort', 'Ort'), after: 'h-mer', decided: [] },
      ],
      reword: [],
      remove: [],
    });
    expect(after.log.at(-1)?.answer).toEqual({
      kind: 'reimport',
      added: 1,
      removed: 0,
      reworded: 0,
      moved: 0,
    });
  });

  it('shows in the trail as a step of its own, not an answer', () => {
    const after = reimport(G, imported(), everything);
    expect(trail(after).at(-1)?.answer.kind).toBe('reimport');
  });

  it('refuses what it cannot do, and changes nothing', () => {
    const c = imported();
    const add = (field: Field) => ({
      place: [{ kind: 'add' as const, field, after: null, decided: [] }],
      reword: [],
      remove: [],
    });
    // An id the form has, or ever had (#49), and a key it has.
    expect(refusal(() => reimport(G, c, add(question('q-namn', 'x', 'X'))))).toBe('invalid-draft');
    const without = reimport(G, c, { place: [], reword: [], remove: ['q-telefon'] });
    expect(refusal(() => reimport(G, without, add(question('q-telefon', 'tel', 'Telefon'))))).toBe(
      'invalid-draft',
    );
    expect(refusal(() => reimport(G, c, add(question('q-ny', 'namn', 'Namn'))))).toBe(
      'invalid-draft',
    );
    // A question that is not there.
    expect(refusal(() => reimport(G, c, { place: [], reword: [], remove: ['q-inget'] }))).toBe(
      'not-found',
    );
    expect(
      refusal(() =>
        reimport(G, c, {
          place: [{ kind: 'move', id: 'q-inget', after: null }],
          reword: [],
          remove: [],
        }),
      ),
    ).toBe('not-found');
    expect(
      refusal(() =>
        reimport(G, c, {
          place: [],
          reword: [{ id: 'q-inget', property: 'label', value: { 'sv-SE': 'X' } }],
          remove: [],
        }),
      ),
    ).toBe('not-found');
    // A removal twice, a wording the form cannot hold, and nothing at all.
    expect(
      refusal(() => reimport(G, c, { place: [], reword: [], remove: ['q-namn', 'q-namn'] })),
    ).toBe('wrong-answer');
    expect(
      refusal(() =>
        reimport(G, c, {
          place: [],
          reword: [{ id: 'h-anmalan', property: 'content', value: { 'sv-SE': 'X' } }],
          remove: [],
        }),
      ),
    ).toBe('invalid-draft');
    expect(refusal(() => reimport(G, c, { place: [], reword: [], remove: [] }))).toBe(
      'nothing-to-do',
    );
  });
});
