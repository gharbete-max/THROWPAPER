import { describe, expect, it } from 'vitest';
import { emptyDefinition, Field } from '../forms/definition.js';
import { jsonEqual } from './changes.js';
import { labelledOptions, newQuestion } from './fields.js';
import { BUILDER_GRAPH } from './graph/nodes.js';
import type { Slot } from './graph/schema.js';
import {
  answer,
  back,
  begin,
  edit,
  importQuestions,
  rebase,
  replay,
  type Conversation,
} from './machine.js';

/**
 * Acceptance scenario S6, "two doors converge" — `docs/plan/CONVERGENCE.md` (S12a): a form read
 * from a document, walked by the conversation, which asks only what the document left open, never
 * re-asks what it decided, and never reorders the person's questions.
 */

const G = BUILDER_GRAPH;
const locale = 'sv-SE';
const fresh = () =>
  begin(G, {
    definition: emptyDefinition,
    title: {},
    pending: { brandKitExists: false, canChangeBrand: false },
  });

const text = (id: string, label: string, required = false): Field =>
  newQuestion({ id, key: id.slice(2), type: 'short_text', label: { [locale]: label }, required });

const choice = (id: string, label: string, options: string[]): Field =>
  ({
    ...newQuestion({
      id,
      key: id.slice(2),
      type: 'single_select',
      label: { [locale]: label },
      required: false,
    }),
    options: labelledOptions([], options, locale),
  }) as Field;

/** Acceptance S5's draft: two questions, the second's "12.1" kept in its label. */
const S5 = [text('q-thing', 'A thing 12.1 mentions blabla'), text('q-else', 'Something else')];
const KIND: Record<string, readonly Slot[]> = { 'q-thing': ['kind'], 'q-else': ['kind'] };

const say = (c: Conversation, optionId: string) =>
  answer(G, c, { kind: 'option', optionId }, { locale });
const go = (c: Conversation) => answer(G, c, { kind: 'continue' }, { locale });
/** The nodes the conversation asked, in order, after the import. */
const asked = (c: Conversation) => c.log.slice(1).map((entry) => entry.nodeId);
const ids = (c: Conversation) => c.state.draft.definition.fields.map((f) => f.id);

describe('what the import decided', () => {
  it('is recorded for each question it adds: the kind always, the rest when the document said', () => {
    const c = importQuestions(G, fresh(), S5, {
      'q-thing': ['kind', 'required'],
      'q-else': ['kind'],
    });
    expect(c.state.sidecar.fields['q-thing']).toEqual({
      source: 'import',
      decided: { kind: true, required: true },
    });
    expect(c.state.sidecar.fields['q-else']).toEqual({ source: 'import', decided: { kind: true } });
  });

  it('refuses a decision about a question it is not adding, or a slot that is not one', () => {
    expect(() => importQuestions(G, fresh(), S5, { 'q-other': ['kind'] })).toThrow(/q-other/);
    expect(() => importQuestions(G, fresh(), S5, { 'q-thing': ['colour' as Slot] })).toThrow(
      /colour/,
    );
  });
});

describe('the walk over acceptance S5’s draft', () => {
  const imported = importQuestions(G, fresh(), S5, KIND);

  it('begins at "Go through the questions from your document?"', () => {
    expect(imported.state.cursor).toBe('import.walk');
    expect(imported.log[0]).toMatchObject({
      answer: { kind: 'import', count: 2 },
      to: 'import.walk',
    });
    expect(imported.state.pending['toWalk']).toBe('q-thing');
  });

  it('asks only what the document left open, and never reorders', () => {
    let c = say(imported, 'yes');
    expect(c.state.focus).toBe('q-thing');
    expect(c.state.cursor).toBe('text.required');
    // The type was decided by the import: passed by, saying so.
    c = say(c, 'no');
    const buttons = c.log.at(-1)!.skipped.find((s) => s.nodeId === 'choice.buttons');
    expect(buttons?.reason).toBe('guided.skip.decided');
    const count = c.log.at(-1)!.skipped.find((s) => s.nodeId === 'choice.count');
    expect(count?.reason).toBe('guided.skip.notAChoice');
    expect(c.state.cursor).toBe('choice.preview');
    c = go(c);
    expect(c.state.cursor).toBe('import.next');
    c = say(c, 'yes');
    expect(c.state.focus).toBe('q-else');
    c = say(c, 'yes');
    c = go(c);
    // The walk's end: the brand, not yet decided; then "Add another question?".
    expect(c.state.cursor).toBe('brand.start');
    c = say(c, 'later');
    expect(c.state.cursor).toBe('flow.more');

    expect(asked(c)).toEqual([
      'import.walk',
      'text.required',
      'choice.preview',
      'import.next',
      'text.required',
      'choice.preview',
      'brand.start',
    ]);
    expect(ids(c)).toEqual(['q-thing', 'q-else']);
    const [thing, other] = c.state.draft.definition.fields;
    expect(thing).toMatchObject({ type: 'short_text', required: false });
    expect(other).toMatchObject({ type: 'short_text', required: true });
    // Verbatim: the dotted number is still in the label.
    expect(thing).toMatchObject({ label: { [locale]: 'A thing 12.1 mentions blabla' } });
  });

  it('is undone by Back, step by step, and replays exactly', () => {
    let c = imported;
    const states = [c];
    for (const step of [
      (x: Conversation) => say(x, 'yes'),
      (x: Conversation) => say(x, 'no'),
      go,
      (x: Conversation) => say(x, 'yes'),
    ]) {
      c = step(c);
      states.push(c);
      expect(jsonEqual(replay(c.base, c.log), c.state)).toBe(true);
    }
    for (let i = states.length - 1; i > 0; i -= 1) {
      c = back(c);
      expect(jsonEqual(c, states[i - 1])).toBe(true);
    }
  });
});

describe('which questions the walk visits', () => {
  it('passes by a question whose every open thing the document already said', () => {
    const c = importQuestions(
      G,
      fresh(),
      [text('q-said', 'Namn', true), text('q-open', 'Adress')],
      { 'q-said': ['kind', 'required'], 'q-open': ['kind'] },
    );
    expect(c.state.pending['toWalk']).toBe('q-open');
    expect(say(c, 'yes').state.focus).toBe('q-open');
  });

  it('asks a printed choice its shape and where it sits, never its options, and shows it as buttons', () => {
    const c0 = importQuestions(G, fresh(), [choice('q-dag', 'Vilken dag?', ['Fredag', 'Lördag'])], {
      'q-dag': ['kind', 'required', 'options'],
    });
    let c = say(c0, 'yes');
    expect(c.state.cursor).toBe('choice.shape');
    c = answer(G, c, { kind: 'option', optionId: 'pill' }, { locale });
    expect(c.state.draft.definition.fields[0]).toMatchObject({
      appearance: 'buttons',
      style: { shape: 'pill' },
    });
    expect(c.state.cursor).toBe('choice.placement');
    expect(c.log.at(-1)).toBeDefined();
    expect(asked(c)).not.toContain('choice.count');
  });

  it('asks how many options when the document printed none', () => {
    const c0 = importQuestions(G, fresh(), [choice('q-val', 'Välj', ['Option 1', 'Option 2'])], {
      'q-val': ['kind', 'required'],
    });
    expect(say(c0, 'yes').state.cursor).toBe('choice.count');
  });

  it('never visits a heading or a text, and has nothing to walk when all is said', () => {
    const heading = Field.parse({
      id: 'q-h',
      key: 'h',
      type: 'section_break',
      label: { [locale]: 'Del 1' },
    });
    const c = importQuestions(G, fresh(), [heading, text('q-said', 'Namn', true)], {
      'q-said': ['kind', 'required'],
    });
    expect(c.state.pending['toWalk']).toBeUndefined();
    // Nothing to ask: past the walk to the brand, saying why.
    expect(c.state.cursor).toBe('brand.start');
    expect(c.log[0]!.skipped).toEqual([
      { nodeId: 'import.walk', reason: 'guided.skip.nothingToWalk' },
    ]);
  });

  it('ends at a question added by hand after the imported ones', () => {
    let c = importQuestions(G, fresh(), [text('q-a', 'A')], { 'q-a': ['kind'] });
    c = say(c, 'no');
    expect(c.state.cursor).toBe('brand.start');
    c = say(c, 'later');
    c = say(c, 'yes');
    c = answer(G, c, { kind: 'text', value: 'Telefon' }, { locale });
    expect(c.state.pending['toWalk'] ?? null).toBeNull();
  });
});

describe('stopping, and coming back', () => {
  it('"No, stop here" ends the walk: nothing more is walked', () => {
    let c = importQuestions(G, fresh(), S5, KIND);
    c = say(c, 'yes');
    c = say(c, 'no');
    c = go(c);
    expect(c.state.cursor).toBe('import.next');
    c = say(c, 'no');
    expect(c.state.cursor).toBe('brand.start');
    c = say(c, 'later');
    expect(c.state.cursor).toBe('flow.more');
  });

  it('"No, they are right as they are" goes on without walking', () => {
    const c = say(importQuestions(G, fresh(), S5, KIND), 'no');
    expect(c.state.cursor).toBe('brand.start');
    expect(c.state.focus).toBeNull();
  });

  it('goes on from the question in focus after a trip to the editor', () => {
    let c = importQuestions(G, fresh(), S5, KIND);
    c = say(c, 'yes');
    c = say(c, 'no');
    c = go(c);
    const outside = edit(
      c,
      [{ op: 'set', path: 'draft.title', value: { [locale]: 'Från pappret' } }],
      { locale },
    );
    const rebased = rebase(G, c, outside.state.draft);
    expect(rebased.state.cursor).toBe('import.next');
    expect(rebased.state.pending['toWalk']).toBe('q-else');
    expect(say(rebased, 'yes').state.focus).toBe('q-else');
  });
});
