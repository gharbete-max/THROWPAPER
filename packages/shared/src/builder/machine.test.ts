import { describe, expect, it } from 'vitest';
import { definitionProblems } from '../forms/helpers.js';
import { emptyDefinition } from '../forms/definition.js';
import { jsonEqual } from './changes.js';
import { BUILDER_GRAPH } from './graph/nodes.js';
import type { BuilderGraph, Node, Op } from './graph/schema.js';
import {
  answer,
  back,
  begin,
  edit,
  jumpTargets,
  replay,
  rewind,
  trail,
  type Answer,
  type Conversation,
} from './machine.js';
import { MachineError } from './state.js';

/**
 * The machine's promises, each checked over the shipped graph rather than asserted in a comment:
 *
 * - **Never a dead end** (non-negotiable 3): every answer the graph offers, from every state a
 *   person can reach — including by the escapes — is accepted.
 * - **Publishable from the first answer, and for ever after**: once the draft is a form that can
 *   be published, no answer makes it one that cannot (`definitionProblems`, what publishing
 *   refuses on).
 * - **Replay reproduces the draft exactly**, and Back is exactly the step before.
 */

const G = BUILDER_GRAPH;
const locale = 'sv-SE';
const fresh = () =>
  begin(G, { definition: emptyDefinition, title: {}, pending: { brandKitExists: false } });

const nodeAt = (c: Conversation): Node => {
  const node = G.nodes.find((candidate) => candidate.id === c.state.cursor);
  if (!node) throw new Error(`no node ${c.state.cursor}`);
  return node;
};

/** Every answer a person can give at the node the conversation is at, escapes included. */
function everyAnswer(c: Conversation): Answer[] {
  const node = nodeAt(c);
  const answers: Answer[] = jumpTargets(G, node.id).map((to) => ({ kind: 'jump', to }));
  switch (node.kind) {
    case 'question':
    case 'pick-one':
      answers.push(...node.options.map((o): Answer => ({ kind: 'option', optionId: o.id })));
      break;
    case 'pick-many':
      answers.push({ kind: 'options', optionIds: node.options.map((o) => o.id) });
      break;
    case 'quantity':
      answers.push(
        { kind: 'quantity', value: node.min },
        { kind: 'quantity', value: node.default },
        { kind: 'quantity', value: node.max },
      );
      break;
    case 'text-entry':
      answers.push({ kind: 'text', value: 'Vilken mat vill du ha?' });
      break;
    case 'confirm-guess':
      answers.push({ kind: 'guess', verdict: 'right' });
      break;
    case 'preview-moment':
    case 'review-queue':
      answers.push({ kind: 'continue' });
      break;
    default:
      break;
  }
  return answers;
}

const publishable = (c: Conversation) => definitionProblems(c.state.draft.definition).length === 0;

describe('the buttons chain (acceptance scenario S2)', () => {
  const chain: Answer[] = [
    { kind: 'option', optionId: 'signup' },
    { kind: 'option', optionId: 'later' },
    { kind: 'text', value: '  Vilken mat vill du ha?  ' },
    { kind: 'option', optionId: 'yes' },
    { kind: 'option', optionId: 'yes' },
    { kind: 'option', optionId: 'one' },
    { kind: 'quantity', value: 4 },
    { kind: 'option', optionId: 'pill' },
    { kind: 'option', optionId: 'under-full' },
  ];
  const run = () => chain.reduce((c, a) => answer(G, c, a, { locale }), fresh());

  it('builds four pill buttons under the question, full width, from answers alone', () => {
    const c = run();
    expect(c.state.cursor).toBe('choice.preview');
    const [name, food] = c.state.draft.definition.fields;
    expect(name).toMatchObject({ key: 'name', type: 'short_text', required: true });
    expect(food).toMatchObject({
      type: 'single_select',
      label: { 'sv-SE': 'Vilken mat vill du ha?' },
      required: true,
      appearance: 'buttons',
      width: 'full',
      style: { shape: 'pill', size: 'regular', accent: 'primary', columns: '1' },
    });
    expect(food && 'options' in food ? food.options.map((o) => o.label['sv-SE']) : []).toEqual([
      'Alternativ 1',
      'Alternativ 2',
      'Alternativ 3',
      'Alternativ 4',
    ]);
    expect(publishable(c)).toBe(true);
  });

  it('keeps a trail of every answer, and says why a question was not asked', () => {
    const crumbs = trail(run());
    expect(crumbs.map((crumb) => crumb.nodeId)).toEqual([
      'flow.start',
      'brand.start',
      'text.label',
      'text.required',
      'choice.buttons',
      'choice.answers',
      'choice.count',
      'choice.shape',
      'choice.placement',
    ]);
    expect(fresh().state.cursor).toBe('flow.start');
    expect(crumbs[0]?.skipped).toEqual([
      { nodeId: 'guess.confirm', reason: 'guided.skip.nothingToGuess' },
    ]);
  });

  it('goes back to any breadcrumb, and from there on is exactly what it was', () => {
    const c = run();
    for (const crumb of trail(c)) {
      const there = rewind(c, crumb.step);
      expect(there.state.cursor).toBe(crumb.nodeId);
      const again = c.log
        .slice(crumb.step)
        .reduce((d, entry) => answer(G, d, entry.answer, { locale }), there);
      expect(jsonEqual(again, c)).toBe(true);
    }
  });
});

describe('every answer, from every state a person can reach', () => {
  // Breadth first to a depth that reaches every node, through every escape and loop; states
  // that differ only in wording are one state, so the frontier stays in the low thousands.
  const DEPTH = 7;
  const signature = (c: Conversation) =>
    JSON.stringify([
      c.state.cursor,
      c.state.focus,
      c.state.pending,
      c.state.sidecar.brandDecided ?? null,
      c.state.draft.definition.fields.map((field) => [
        field.type,
        'options' in field ? field.options.length : 0,
        'appearance' in field ? field.appearance : null,
        'style' in field ? field.style : null,
        'required' in field ? field.required : null,
      ]),
    ]);

  it('is accepted, keeps a publishable draft publishable, replays and undoes exactly', () => {
    const seen = new Set<string>();
    const reached = new Set<string>();
    let frontier: Conversation[] = [fresh()];
    let transitions = 0;
    for (let depth = 0; depth < DEPTH; depth += 1) {
      const next: Conversation[] = [];
      for (const c of frontier) {
        for (const given of everyAnswer(c)) {
          const after = answer(G, c, given, { locale });
          transitions += 1;
          reached.add(after.state.cursor);
          if (publishable(c))
            expect(publishable(after), `${c.state.cursor} ${JSON.stringify(given)}`).toBe(true);
          expect(jsonEqual(replay(after.base, after.log), after.state)).toBe(true);
          expect(jsonEqual(back(after), c)).toBe(true);
          const key = signature(after);
          if (!seen.has(key)) {
            seen.add(key);
            next.push(after);
          }
        }
      }
      frontier = next;
    }
    // The walk really went everywhere: every node is reached by some answer, but the guess,
    // which nothing can make before the belief engine (S11), so it is always skipped.
    expect([...reached].sort()).toEqual(
      G.nodes
        .map((node) => node.id)
        .filter((id) => id !== 'guess.confirm')
        .sort(),
    );
    expect(transitions).toBeGreaterThan(5000);
  });

  it('makes the draft publishable with the first answer, whichever it is', () => {
    const first = nodeAt(fresh());
    expect(first.kind).toBe('question');
    for (const option of 'options' in first ? first.options : []) {
      expect(
        publishable(answer(G, fresh(), { kind: 'option', optionId: option.id }, { locale })),
      ).toBe(true);
    }
  });
});

describe('long walks, with Back', () => {
  /** A seeded generator: the same walks on every run and every machine. */
  function* lcg(seed: number) {
    let x = seed >>> 0;
    for (;;) {
      x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
      yield x;
    }
  }

  it.each([1, 2, 3, 4, 5, 6, 7, 8])(
    'walk %i: the state is always the replay of its log',
    (seed) => {
      const random = lcg(seed);
      const pick = (n: number) => (random.next().value as number) % n;
      let c = fresh();
      const history: Conversation[] = [c];
      for (let step = 0; step < 80; step += 1) {
        if (c.log.length > 0 && pick(5) === 0) {
          c = back(c);
          history.pop();
          expect(jsonEqual(c, history[history.length - 1])).toBe(true);
        } else {
          const options = everyAnswer(c);
          if (options.length === 0) break;
          c = answer(G, c, options[pick(options.length)]!, { locale });
          history.push(c);
        }
        expect(jsonEqual(replay(c.base, c.log), c.state)).toBe(true);
      }
      // And a step taken back is exactly the rewind to it.
      for (let length = c.log.length; length > 0; length -= 1) {
        const stepped = back(rewind(c, length));
        expect(jsonEqual(stepped, rewind(c, length - 1))).toBe(true);
      }
    },
  );
});

describe('what a person writes', () => {
  it('is trimmed and otherwise verbatim, in the author’s language', () => {
    let c = answer(G, fresh(), { kind: 'option', optionId: 'collect' }, { locale: 'en-GB' });
    c = answer(G, c, { kind: 'option', optionId: 'later' }, { locale: 'en-GB' });
    c = answer(G, c, { kind: 'text', value: '\t  e-POST  ,  please!! \n' }, { locale: 'en-GB' });
    expect(c.state.draft.definition.fields[1]).toMatchObject({
      label: { 'en-GB': 'e-POST  ,  please!!' },
    });
  });

  it('survives a detour: options written for a choice come back with it', () => {
    let c = fresh();
    for (const given of [
      { kind: 'option', optionId: 'signup' },
      { kind: 'option', optionId: 'later' },
      { kind: 'text', value: 'Mat' },
      { kind: 'option', optionId: 'no' },
      { kind: 'option', optionId: 'yes' },
      { kind: 'option', optionId: 'one' },
      { kind: 'quantity', value: 5 },
    ] as Answer[]) {
      c = answer(G, c, given, { locale });
    }
    const id = c.state.focus!;
    c = edit(
      c,
      [
        {
          op: 'set',
          path: `draft.definition.fields[id=${id}].label`,
          value: { 'sv-SE': 'Maträtt' },
        },
      ],
      { locale },
    );
    // Out through the escape, "No, people type an answer", then back in with "Yes".
    c = answer(G, c, { kind: 'jump', to: 'choice.buttons' }, { locale });
    c = answer(G, c, { kind: 'option', optionId: 'no' }, { locale });
    expect(c.state.draft.definition.fields[1]).not.toHaveProperty('options');
    expect(c.state.sidecar.fields[id]?.setAside).toHaveProperty('options');
    c = answer(G, c, { kind: 'jump', to: 'menu.top' }, { locale });
    c = answer(G, c, { kind: 'jump', to: 'choice.buttons' }, { locale });
    c = answer(G, c, { kind: 'option', optionId: 'yes' }, { locale });
    const food = c.state.draft.definition.fields[1];
    expect(food && 'options' in food ? food.options : []).toHaveLength(5);
    expect(c.state.sidecar.fields[id]?.setAside).toBeUndefined();
  });
});

describe('what the machine refuses, leaving the conversation as it was', () => {
  const at = (answers: Answer[]) => answers.reduce((c, a) => answer(G, c, a, { locale }), fresh());
  const cases: [string, Conversation, Answer, string][] = [
    [
      'an option the node does not have',
      fresh(),
      { kind: 'option', optionId: 'nope' },
      'wrong-answer',
    ],
    ['the wrong kind of answer', fresh(), { kind: 'quantity', value: 3 }, 'wrong-answer'],
    [
      'a jump its escape does not offer',
      fresh(),
      { kind: 'jump', to: 'choice.count' },
      'wrong-answer',
    ],
    [
      'a count out of range',
      at([
        { kind: 'option', optionId: 'signup' },
        { kind: 'option', optionId: 'later' },
        { kind: 'text', value: 'Mat' },
        { kind: 'option', optionId: 'yes' },
        { kind: 'option', optionId: 'yes' },
        { kind: 'option', optionId: 'one' },
      ]),
      { kind: 'quantity', value: 13 },
      'out-of-range',
    ],
    [
      'a count that is not whole',
      at([
        { kind: 'option', optionId: 'signup' },
        { kind: 'option', optionId: 'later' },
        { kind: 'text', value: 'Mat' },
        { kind: 'option', optionId: 'yes' },
        { kind: 'option', optionId: 'yes' },
        { kind: 'option', optionId: 'one' },
      ]),
      { kind: 'quantity', value: 2.5 },
      'out-of-range',
    ],
    [
      'an empty answer to a question that needs one',
      at([
        { kind: 'option', optionId: 'signup' },
        { kind: 'option', optionId: 'later' },
      ]),
      { kind: 'text', value: '   ' },
      'empty-answer',
    ],
  ];

  it.each(cases)('%s', (_name, c, given, code) => {
    const before = JSON.stringify(c);
    expect(() => answer(G, c, given, { locale })).toThrow(expect.objectContaining({ code }));
    expect(JSON.stringify(c)).toBe(before);
  });

  it('refuses a language that is not a locale, the end, and going back from the start', () => {
    expect(() =>
      answer(G, fresh(), { kind: 'option', optionId: 'signup' }, { locale: 'svenska' }),
    ).toThrow(MachineError);
    const end = at([
      { kind: 'option', optionId: 'signup' },
      { kind: 'option', optionId: 'later' },
      { kind: 'text', value: 'Mat' },
      { kind: 'option', optionId: 'yes' },
      { kind: 'option', optionId: 'no' },
      { kind: 'option', optionId: 'no' },
    ]);
    expect(end.state.cursor).toBe('end');
    expect(() => answer(G, end, { kind: 'continue' }, { locale })).toThrow(
      expect.objectContaining({ code: 'nothing-to-do' }),
    );
    expect(jumpTargets(G, 'end')).toEqual(['menu.top']);
    expect(() => back(fresh())).toThrow(expect.objectContaining({ code: 'nothing-to-do' }));
  });
});

describe('hand edits (source: manual)', () => {
  const started = () => answer(G, fresh(), { kind: 'option', optionId: 'signup' }, { locale });
  const id = (c: Conversation, i = 0) => c.state.draft.definition.fields[i]!.id;

  it.each<[string, (c: Conversation) => Op[]]>([
    [
      'a rename',
      (c) => [
        {
          op: 'set',
          path: `draft.definition.fields[id=${id(c)}].label`,
          value: { 'sv-SE': 'Ditt namn' },
        },
      ],
    ],
    [
      'help text, added',
      (c) => [
        {
          op: 'set',
          path: `draft.definition.fields[id=${id(c)}].helpText`,
          value: { 'sv-SE': 'Som i passet' },
        },
      ],
    ],
    [
      'a new question',
      () => [
        {
          op: 'add',
          path: 'draft.definition.fields',
          value: { $newField: { type: 'email', word: 'email', key: 'email' } },
        },
      ],
    ],
    ['a removed question', (c) => [{ op: 'remove', path: `draft.definition.fields[id=${id(c)}]` }]],
    [
      'a moved question',
      (c) => [
        {
          op: 'add',
          path: 'draft.definition.fields',
          value: { $newField: { type: 'email', key: 'email' } },
        },
        { op: 'reorder', path: 'draft.definition.fields', id: id(c), after: null },
      ],
    ],
    [
      'a shape',
      (c) => [
        { op: 'set', path: `draft.definition.fields[id=${id(c)}].type`, value: 'single_select' },
        { op: 'set', path: `draft.definition.fields[id=${id(c)}].style.shape`, value: 'rounded' },
      ],
    ],
  ])('%s is one step in the log, and Back undoes it exactly', (_name, ops) => {
    const c = started();
    const edited = edit(c, ops(c), { locale });
    expect(edited.log.at(-1)).toMatchObject({
      source: 'manual',
      answer: { kind: 'edit' },
      to: c.state.cursor,
    });
    expect(jsonEqual(edited.state, c.state)).toBe(false);
    expect(jsonEqual(back(edited), c)).toBe(true);
    expect(trail(edited)).toEqual(trail(c));
  });

  it('refuses a path the builder may not write, and a value the question cannot hold', () => {
    const c = started();
    expect(() =>
      edit(c, [{ op: 'set', path: 'draft.definition.settings.submitLabel', value: {} }], {
        locale,
      }),
    ).toThrow(expect.objectContaining({ code: 'not-writable' }));
    expect(() =>
      edit(
        c,
        [{ op: 'set', path: `draft.definition.fields[id=${id(c)}].style.shape`, value: 'pill' }],
        { locale },
      ),
    ).toThrow(expect.objectContaining({ code: 'invalid-draft' }));
    expect(() =>
      edit(c, [{ op: 'set', path: 'draft.definition.fields[focus].required', value: true }], {
        locale,
      }),
    ).toThrow(expect.objectContaining({ code: 'no-focus' }));
  });
});

describe('replay needs no graph', () => {
  it('reproduces a session recorded under one graph after the graph has changed', () => {
    const recorded = [
      { kind: 'option', optionId: 'feedback' },
      { kind: 'option', optionId: 'later' },
      { kind: 'text', value: 'Vad tyckte du?' },
    ] as Answer[];
    const c = recorded.reduce((d, a) => answer(G, d, a, { locale }), fresh());

    // The next graph version makes "feedback" add a different question.
    const changed = structuredClone(G) as unknown as {
      nodes: { id: string; options?: { id: string; patch: unknown[] }[] }[];
    };
    changed.nodes[0]!.options!.find((o) => o.id === 'feedback')!.patch = [
      { op: 'set', path: 'pending.purpose', value: 'feedback' },
      {
        op: 'add',
        path: 'draft.definition.fields',
        value: { $newField: { type: 'rating', key: 'score' } },
      },
    ];
    const now = recorded.reduce(
      (d, a) => answer(changed as unknown as BuilderGraph, d, a, { locale }),
      fresh(),
    );
    expect(jsonEqual(now.state.draft, c.state.draft)).toBe(false);
    expect(jsonEqual(replay(c.base, c.log), c.state)).toBe(true);
  });
});
