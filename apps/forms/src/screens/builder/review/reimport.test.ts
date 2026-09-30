import { describe, expect, it } from 'vitest';
import {
  begin,
  BUILDER_GRAPH,
  importQuestions,
  reimport,
  type BuilderSidecar,
  type Conversation,
} from '@tp/shared/builder';
import { emptyDefinition, type Field } from '@tp/shared/forms';
import { readDocument } from '../paper/pipeline.js';
import { importOf } from './fields.js';
import {
  changesAnything,
  compareWithForm,
  isUpdate,
  itemsAdded,
  keptAlready,
  noChoices,
  nothingChanged,
  reimportOf,
  type UpdateContext,
} from './reimport.js';
import { startReview } from './review.js';

/**
 * "Update the form" (S12c, `docs/plan/CONVERGENCE.md`) on readings made by the stages themselves:
 * a form made from a paste, the paste changed, read again, compared, and brought up to date
 * through the machine.
 */

const G = BUILDER_GRAPH;
const locale = 'sv-SE';
const itemsOf = (text: string) => startReview(readDocument({ kind: 'paste', text })).items;

const FIRST = 'Anmälan\n1. Namn: ____\n2. Telefon: ____\n3. Vilken dag kommer du?';
const SECOND = 'Anmälan\n1. Namn: ____\n2. E-post: ____\n3. Vilken dag kommer ni?';

/** A form made from `text` by "Use these questions", as the review screen makes it. */
function madeFrom(text: string): Conversation {
  const start = begin(G, {
    definition: emptyDefinition,
    title: {},
    pending: { brandKitExists: false, canChangeBrand: true },
  });
  const { fields, decided } = importOf(itemsOf(text), {
    definition: emptyDefinition,
    retired: [],
    locale,
  });
  return importQuestions(G, start, fields, decided);
}
const contextOf = (c: Conversation): UpdateContext => ({
  definition: c.state.draft.definition,
  sidecar: c.state.sidecar,
  locale,
});
/** Each field's words: a question's or heading's label, a text's content. */
const labels = (c: Conversation) =>
  c.state.draft.definition.fields.map((field) => {
    const words = 'label' in field ? field.label : 'content' in field ? field.content : undefined;
    return (words as Record<string, string> | undefined)?.[locale] ?? '';
  });

describe('the same document, read again', () => {
  it('changes nothing: every field has the id it was given', () => {
    const form = madeFrom(FIRST);
    const update = compareWithForm(itemsOf(FIRST), contextOf(form));
    expect(update.comparison.matches.every((match) => match.by === 'id')).toBe(true);
    expect(nothingChanged(update.comparison)).toBe(true);
    expect(changesAnything(update, noChoices)).toBe(false);
  });

  it('asks nothing about what the person changed by hand', () => {
    const form = madeFrom(FIRST);
    const fields = form.state.draft.definition.fields.map((field) =>
      'label' in field && field.label?.[locale] === 'Namn'
        ? ({ ...field, label: { [locale]: 'Ditt namn' } } as Field)
        : field,
    );
    const [first, ...rest] = fields;
    const edited = { ...form.state.draft.definition, fields: [first!, ...rest.reverse()] };
    const update = compareWithForm(itemsOf(FIRST), { ...contextOf(form), definition: edited });
    expect(nothingChanged(update.comparison)).toBe(true);
  });
});

describe('a new version of the document', () => {
  const form = madeFrom(FIRST);
  const update = compareWithForm(itemsOf(SECOND), contextOf(form));
  const [, namn, telefon, dag] = form.state.draft.definition.fields;
  const documentIndex = (text: string) => update.input.document.findIndex((e) => e.text === text);

  it('adds what is new, and asks about what is gone and what is reworded', () => {
    expect(update.comparison.added).toEqual([documentIndex('E-post')]);
    expect(update.comparison.gone).toEqual([telefon!.id]);
    expect(update.comparison.reworded).toEqual([documentIndex('Vilken dag kommer ni?')]);
    expect(update.comparison.matches[documentIndex('Namn')]).toEqual({
      formId: namn!.id,
      by: 'id',
    });
    expect(update.comparison.matches[documentIndex('Vilken dag kommer ni?')]).toEqual({
      formId: dag!.id,
      by: 'wording',
    });
  });

  it('holds back only the items it would add', () => {
    const item = itemsOf(SECOND).find((i) => i.text === 'E-post')!;
    expect(itemsAdded(update, noChoices)).toEqual([item.id]);
  });

  it('does what the person chose, and nothing else, through the machine', () => {
    const choices = {
      ...noChoices,
      remove: [telefon!.id],
      reword: [documentIndex('Vilken dag kommer ni?')],
    };
    const after = reimport(G, form, reimportOf(update, choices, contextOf(form)));
    expect(labels(after)).toEqual(['Anmälan', 'Namn', 'E-post', 'Vilken dag kommer ni?']);
    // Unchanged fields keep their ids; the reworded one too; the new one its document id.
    const ids = after.state.draft.definition.fields.map((f) => f.id);
    expect(ids[1]).toBe(namn!.id);
    expect(ids[3]).toBe(dag!.id);
    expect(ids[2]).toBe(update.input.document[documentIndex('E-post')]!.id);
    expect(after.log.at(-1)?.answer).toEqual({
      kind: 'reimport',
      added: 1,
      removed: 1,
      reworded: 1,
      moved: 0,
    });
    // Read again, the updated form has everything in the document.
    const again = compareWithForm(itemsOf(SECOND), contextOf(after));
    expect(nothingChanged(again.comparison)).toBe(true);
  });

  it('keeps what the person did not choose', () => {
    const after = reimport(G, form, reimportOf(update, noChoices, contextOf(form)));
    expect(labels(after)).toEqual([
      'Anmälan',
      'Namn',
      'E-post',
      'Telefon',
      'Vilken dag kommer du?',
    ]);
  });
});

describe('a question the person took out, still in the document', () => {
  it('is asked about, and comes back under a new id, never its old one (#49)', () => {
    const form = madeFrom(FIRST);
    const telefon = form.state.draft.definition.fields[2]!;
    const without = reimport(G, form, { place: [], reword: [], remove: [telefon.id] });
    const update = compareWithForm(itemsOf(FIRST), contextOf(without));
    const index = update.input.document.findIndex((e) => e.id === telefon.id);
    expect(update.comparison.addBack).toEqual([index]);
    expect(changesAnything(update, noChoices)).toBe(false);
    const plan = reimportOf(update, { ...noChoices, addBack: [index] }, contextOf(without));
    const back = reimport(G, without, plan);
    expect(labels(back)).toEqual(['Anmälan', 'Namn', 'Telefon', 'Vilken dag kommer du?']);
    expect(back.state.draft.definition.fields[2]!.id).toBe(`${telefon.id}-2`);
    // And read once more, it is the same question: matched by its wording, nothing asked.
    expect(nothingChanged(compareWithForm(itemsOf(FIRST), contextOf(back)).comparison)).toBe(true);
  });
});

describe('what the comparison knows of where a field came from', () => {
  it('offers to remove only what the import made: not a colleague’s, not a hand-made one', () => {
    const form = madeFrom(FIRST);
    const colleague: BuilderSidecar = {
      provenance: 'guided',
      fields: {},
      retiredIds: form.state.draft.definition.fields.map((f) => f.id),
    };
    const update = compareWithForm(itemsOf(SECOND), { ...contextOf(form), sidecar: colleague });
    expect(update.comparison.gone).toEqual([]);
    expect(update.comparison.added).toHaveLength(1);
  });

  it('knows a PDF the form keeps by its hash, and an update by the form having anything', () => {
    const sha = 'a'.repeat(64);
    const keeping = { ...emptyDefinition, paper: { sources: [{ key: `${sha}.pdf`, pages: 1 }] } };
    expect(keptAlready(keeping, sha)).toBe(true);
    expect(keptAlready(keeping, 'b'.repeat(64))).toBe(false);
    expect(keptAlready(keeping, null)).toBe(false);
    expect(isUpdate(emptyDefinition)).toBe(false);
    expect(isUpdate(madeFrom(FIRST).state.draft.definition)).toBe(true);
  });
});
