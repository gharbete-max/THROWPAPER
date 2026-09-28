import { describe, expect, it } from 'vitest';
import { definitionProblems } from '../forms/helpers.js';
import { emptyDefinition } from '../forms/definition.js';
import { jsonEqual } from './changes.js';
import { BUILDER_GRAPH } from './graph/nodes.js';
import type { BuilderGraph, Node } from './graph/schema.js';
import {
  answer,
  answerAt,
  back,
  begin,
  fill,
  replay,
  rewind,
  trail,
  type Answer,
  type Conversation,
  type Given,
} from './machine.js';
import { fromSession, toSession } from './session.js';
import { MachineError } from './state.js';

/**
 * Answers given ahead of their turn (S6): a sentence that says several things — "three buttons,
 * pill shape, side by side" — answers each node it names at once (T5), a list answers "How many
 * options?" with the options themselves (T6), and a guess confirmed answers another question of
 * the group (T7). The machine's side: each answer its own step, the conversation left where it
 * was, and nothing answered ahead asked again.
 */

const G = BUILDER_GRAPH;
const locale = 'sv-SE';
const fresh = () =>
  begin(G, { definition: emptyDefinition, title: {}, pending: { brandKitExists: false } });
const option = (optionId: string): Answer => ({ kind: 'option', optionId });

/** A new question, "Vilken dag?", at "Do you want buttons?". */
function atButtons(): Conversation {
  return [
    option('signup'),
    option('later'),
    { kind: 'text', value: 'Vilken dag?' } as const,
    option('yes'),
  ].reduce((c, a) => answer(G, c, a, { locale }), fresh());
}

const given = (nodeId: string, a: Answer): Given => ({ nodeId, answer: a, tier: 'T5' });
/** "three buttons, pill shape, side by side", as the ladder hands it over. */
const threePillsInARow: Given[] = [
  given('choice.buttons', option('yes')),
  given('choice.count', { kind: 'quantity', value: 3 }),
  given('choice.shape', option('pill')),
  given('choice.placement', option('row')),
];

const focused = (c: Conversation) =>
  c.state.draft.definition.fields.find((field) => field.id === c.state.focus);

describe('a sentence that answers several questions at once', () => {
  it('answers each as its own step, and stays at the first question it did not answer', () => {
    const start = atButtons();
    expect(start.state.cursor).toBe('choice.buttons');
    const { conversation: c, refused } = fill(G, start, threePillsInARow, { locale });
    expect(refused).toEqual([null, null, null, null]);
    expect(c.log.length - start.log.length).toBe(4);
    // "One answer or several?" was not said: that is where the conversation is.
    expect(c.state.cursor).toBe('choice.answers');
    expect(focused(c)).toMatchObject({
      type: 'single_select',
      appearance: 'buttons',
      style: { shape: 'pill', columns: 'auto' },
    });
    const field = focused(c);
    expect(field && 'options' in field ? field.options.length : 0).toBe(3);
    expect(c.state.sidecar.fields[c.state.focus!]?.decided).toEqual({
      options: true,
      shape: true,
      placement: true,
    });
    expect(c.log.slice(start.log.length).map((entry) => entry.tier)).toEqual([
      'T5',
      'T5',
      'T5',
      'T5',
    ]);
  });

  it('does not ask again what was said: the rest is passed by, and the trail says why', () => {
    const { conversation } = fill(G, atButtons(), threePillsInARow, { locale });
    const c = answer(G, conversation, option('one'), { locale });
    expect(c.state.cursor).toBe('choice.preview');
    expect(trail(c).at(-1)?.skipped).toEqual([
      { nodeId: 'choice.count', reason: 'guided.skip.decided' },
      { nodeId: 'choice.shape', reason: 'guided.skip.decided' },
      { nodeId: 'choice.placement', reason: 'guided.skip.decided' },
    ]);
    expect(definitionProblems(c.state.draft.definition)).toEqual([]);
  });

  it('is undone one answer at a time by Back, last first, staying where the person was', () => {
    const start = atButtons();
    const { conversation: c } = fill(G, start, threePillsInARow, { locale });
    let here = c;
    for (let undone = 1; undone <= 3; undone += 1) {
      here = back(here);
      expect(here.state.cursor).toBe('choice.answers');
      expect(jsonEqual(here, rewind(c, c.log.length - undone))).toBe(true);
    }
    // The last Back takes back "buttons", answered in its turn: back at that question.
    here = back(here);
    expect(jsonEqual(here, start)).toBe(true);
    expect(jsonEqual(replay(c.base, c.log), c.state)).toBe(true);
  });

  it('leaves out what cannot be answered now, and keeps the rest', () => {
    const { conversation: c, refused } = fill(
      G,
      atButtons(),
      [given('choice.buttons', option('no')), given('choice.shape', option('pill'))],
      { locale },
    );
    // "No buttons" moves on; a shape for buttons nobody wants is not a question any more.
    expect(refused).toEqual([null, 'not-now']);
    expect(c.state.cursor).toBe('flow.more');
    expect(focused(c)).toMatchObject({ type: 'short_text' });
  });

  it('still asks a question the person goes to by name, even when it was decided', () => {
    const { conversation } = fill(G, atButtons(), threePillsInARow, { locale });
    const c = answer(G, conversation, { kind: 'jump', to: 'choice.shape' }, { locale });
    expect(c.state.cursor).toBe('choice.shape');
    const changed = answer(G, c, option('square'), { locale });
    expect(focused(changed)).toMatchObject({ style: { shape: 'square' } });
  });

  it('survives being saved and read back', () => {
    const { conversation: c } = fill(G, atButtons(), threePillsInARow, { locale });
    expect(jsonEqual(fromSession(JSON.parse(JSON.stringify(toSession(G, c)))), c)).toBe(true);
  });
});

describe('what answering ahead refuses, leaving the conversation as it was', () => {
  it('a node that settles no slot: it is answered only in its turn', () => {
    expect(() => answerAt(G, atButtons(), 'flow.more', option('no'), { locale })).toThrowError(
      expect.objectContaining({ code: 'not-now' }) as MachineError,
    );
  });

  it('a node the conversation could not ask now', () => {
    expect(() => answerAt(G, atButtons(), 'choice.shape', option('pill'), { locale })).toThrowError(
      expect.objectContaining({ code: 'not-now' }) as MachineError,
    );
  });

  it('a jump or a hand edit, which are not answers', () => {
    const c = answer(G, atButtons(), option('yes'), { locale });
    for (const a of [{ kind: 'jump', to: 'menu.top' }, { kind: 'edit' }] as Answer[]) {
      expect(() => answerAt(G, c, 'choice.shape', a, { locale })).toThrowError(MachineError);
    }
  });
});

describe('a list is the options themselves (T6)', () => {
  const atCount = () =>
    [option('yes'), option('many')].reduce((c, a) => answer(G, c, a, { locale }), atButtons());

  it('makes one option per label, verbatim, in the language written, the count preserved', () => {
    const c = answer(
      G,
      atCount(),
      { kind: 'list', labels: ['Röd', ' Grön ', 'Blå – mörk'] },
      { locale, tier: 'T6' },
    );
    expect(c.state.cursor).toBe('choice.shape');
    const field = focused(c);
    expect(field && 'options' in field ? field.options : []).toEqual([
      { value: 'option_1', label: { 'sv-SE': 'Röd' }, image: null },
      { value: 'option_2', label: { 'sv-SE': 'Grön' }, image: null },
      { value: 'option_3', label: { 'sv-SE': 'Blå – mörk' }, image: null },
    ]);
    expect(trail(c).at(-1)?.answer).toEqual({
      kind: 'list',
      labels: ['Röd', ' Grön ', 'Blå – mörk'],
    });
    expect(jsonEqual(back(c), atCount())).toBe(true);
  });

  it('can be given ahead of its turn, and is then not asked', () => {
    const c = answer(G, atButtons(), option('yes'), { locale });
    const ahead = answerAt(
      G,
      c,
      'choice.count',
      { kind: 'list', labels: ['Ja', 'Nej'] },
      { locale },
    );
    expect(ahead.state.cursor).toBe('choice.answers');
    const on = answer(G, ahead, option('one'), { locale });
    expect(on.state.cursor).toBe('choice.shape');
  });

  it('refuses a list of the wrong length, an empty label, and a quantity that makes no options', () => {
    const refuse = (labels: string[], code: MachineError['code']) =>
      expect(() => answer(G, atCount(), { kind: 'list', labels }, { locale })).toThrowError(
        expect.objectContaining({ code }) as MachineError,
      );
    refuse(['Bara en'], 'out-of-range');
    refuse(
      Array.from({ length: 13 }, (_, i) => `Val ${i + 1}`),
      'out-of-range',
    );
    refuse(['Röd', '  '], 'empty-answer');

    const copy = JSON.parse(JSON.stringify(G)) as { nodes: { id: string; patch?: unknown[] }[] };
    copy.nodes.find((n) => n.id === 'choice.count')!.patch = [
      { op: 'set', path: 'pending.count', value: { $answer: true } },
    ];
    const counting = copy as unknown as BuilderGraph;
    const c = [option('yes'), option('many')].reduce(
      (here, a) => answer(counting, here, a, { locale }),
      atButtons(),
    );
    expect(() =>
      answer(counting, c, { kind: 'list', labels: ['Röd', 'Grön'] }, { locale }),
    ).toThrowError(expect.objectContaining({ code: 'wrong-answer' }) as MachineError);
  });
});

describe('long walks with answers ahead of their turn', () => {
  function* lcg(seed: number) {
    let x = seed >>> 0;
    for (;;) {
      x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
      yield x;
    }
  }
  /** Every answer a node takes, for answering it from elsewhere. */
  const answersOf = (id: string): Answer[] => {
    const node = G.nodes.find((n) => n.id === id)!;
    if (node.kind === 'quantity') {
      return [
        { kind: 'quantity', value: node.min },
        { kind: 'list', labels: ['Röd', 'Grön', 'Blå'] },
      ];
    }
    return 'options' in node ? node.options.map((o) => option(o.id)) : [];
  };
  const slotted = (G.nodes as readonly Node[])
    .filter((node) => node.slot !== undefined)
    .map((node) => node.id);

  it.each([11, 12, 13, 14, 15, 16])(
    'walk %i: never a broken form, always the replay of its log, Back always the step before',
    (seed) => {
      const random = lcg(seed);
      // High bits: an LCG's low bits repeat with a short period.
      const pick = (n: number) => ((random.next().value as number) >>> 16) % n;
      let c = atButtons();
      const history: Conversation[] = [c];
      let ahead = 0;
      for (let step = 0; step < 60; step += 1) {
        const roll = pick(6);
        if (roll === 0 && history.length > 1) {
          c = back(c);
          history.pop();
          expect(jsonEqual(c, history.at(-1))).toBe(true);
          continue;
        }
        const nodeId = roll <= 2 ? c.state.cursor : slotted[pick(slotted.length)]!;
        const choices = answersOf(nodeId);
        if (choices.length === 0) {
          const node = G.nodes.find((n) => n.id === c.state.cursor)!;
          const onward: Answer =
            node.kind === 'text-entry'
              ? { kind: 'text', value: 'Vilken färg?' }
              : node.kind === 'end'
                ? { kind: 'jump', to: 'menu.top' }
                : node.kind === 'menu'
                  ? { kind: 'jump', to: 'text.label' }
                  : { kind: 'continue' };
          c = answer(G, c, onward, { locale });
          history.push(c);
          continue;
        }
        const { conversation, refused } = fill(
          G,
          c,
          [{ nodeId, answer: choices[pick(choices.length)]!, tier: 'T5' }],
          { locale },
        );
        if (refused[0] === null) {
          if (nodeId !== c.state.cursor) ahead += 1;
          c = conversation;
          history.push(c);
        } else expect(jsonEqual(conversation, c)).toBe(true);
        expect(jsonEqual(replay(c.base, c.log), c.state)).toBe(true);
        expect(definitionProblems(c.state.draft.definition)).toEqual([]);
      }
      // The walk did what it is for: answered something ahead of its turn, more than once.
      expect(ahead).toBeGreaterThan(1);
    },
  );
});
