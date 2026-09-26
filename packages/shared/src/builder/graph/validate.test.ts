import { describe, expect, it } from 'vitest';
import { LOCALE_CODES } from '@tp/i18n';
import { BUILDER_GRAPH } from './nodes.js';
import {
  MAX_CHAIN,
  catalogueProblems,
  messageKeysOf,
  structuralProblems,
  validateGraph,
  type Catalogues,
  type GraphRule,
} from './validate.js';
import type { BuilderGraph } from './schema.js';

/**
 * One broken graph per rule, each proving the rule catches what it names.
 *
 * A validator that passes the real graph proves only that the real graph is fine today. These
 * prove the validator would notice tomorrow: each case breaks the shipped graph in exactly one
 * way and expects exactly that rule to fire. The catalogue rules (G4, G10, G13) are exercised here
 * with a synthetic catalogue; `apps/forms/src/lib/guided-graph.test.ts` runs them on the real one.
 */

type Mutable = { nodes: Record<string, unknown>[] } & Record<string, unknown>;
const copy = (): Mutable => JSON.parse(JSON.stringify(BUILDER_GRAPH)) as Mutable;
const node = (graph: Mutable, id: string) => {
  const found = graph.nodes.find((n) => n.id === id);
  if (!found) throw new Error(`no node ${id}`);
  return found as Record<string, unknown> & { options?: Record<string, unknown>[] };
};
const rules = (graph: unknown) => new Set(structuralProblems(graph).map((p) => p.rule));

/** A catalogue in which every key the graph uses has a short, harmless value in every locale. */
function catalogueFor(graph: BuilderGraph): Catalogues {
  const keys = graph.nodes.flatMap(messageKeysOf);
  return Object.fromEntries(
    LOCALE_CODES.map((locale) => [locale, Object.fromEntries(keys.map((key) => [key, 'Ok']))]),
  );
}

describe('the shipped graph', () => {
  it('passes every structural rule', () => {
    expect(structuralProblems(BUILDER_GRAPH)).toEqual([]);
  });

  it('passes the catalogue rules against a catalogue that has its keys', () => {
    expect(catalogueProblems(BUILDER_GRAPH, catalogueFor(BUILDER_GRAPH))).toEqual([]);
  });
});

describe('each rule catches its own mistake', () => {
  const cases: [GraphRule, string, (graph: Mutable) => void][] = [
    ['G0', 'an unknown node kind', (g) => (node(g, 'text.required').kind = 'slider')],
    ['G0', 'a literal string where a message key belongs', (g) => (node(g, 'end').ask = 'Done!')],
    ['G1', 'a next that names nothing', (g) => (node(g, 'text.required').next = 'text.nowhere')],
    [
      'G1',
      'an escape to a group that does not exist',
      (g) => (node(g, 'text.label').escape = 'menu.siblings(nothing)'),
    ],
    ['G1', 'two nodes with one id', (g) => (node(g, 'choice.count').id = 'choice.shape')],
    [
      'G1',
      'a negative option that does not exist',
      (g) => (node(g, 'flow.more').negative = 'maybe'),
    ],
    [
      'G2',
      'a node nothing leads to',
      (g) =>
        g.nodes.push({
          id: 'text.orphan',
          group: 'orphan',
          kind: 'preview-moment',
          ask: 'guided.preview.ask',
          help: 'guided.preview.ask',
          preview: 'x',
          next: 'end',
          escape: 'menu.top',
        }),
    ],
    ['G3', 'an escape to a node that is not a menu', (g) => (node(g, 'text.label').escape = 'end')],
    [
      'G5',
      'a patch on a path the draft does not have',
      (g) =>
        (node(g, 'text.required').options![0]!.patch = [
          { op: 'set', path: 'draft.definition.fields[focus].colour', value: '#f00' },
        ]),
    ],
    [
      'G5',
      'a value the schema refuses (a shape that does not exist yet)',
      (g) =>
        (node(g, 'choice.shape').options![0]!.patch = [
          { op: 'set', path: 'draft.definition.fields[focus].style.shape', value: 'segmented' },
        ]),
    ],
    [
      'G5',
      'an operation the path does not allow',
      (g) =>
        (node(g, 'text.required').options![0]!.patch = [{ op: 'remove', path: 'draft.title' }]),
    ],
    [
      'G6',
      'a loop that turns without anybody answering',
      (g) => {
        const loop = (id: string, next: string) => ({
          id,
          group: 'loop',
          kind: 'preview-moment',
          ask: 'guided.preview.ask',
          help: 'guided.preview.ask',
          preview: 'x',
          next,
          escape: 'menu.top',
        });
        g.nodes.push(loop('loop.a', 'loop.b'), loop('loop.b', 'loop.a'));
      },
    ],
    [
      'G7',
      'a question with five answers',
      (g) => {
        const options = node(g, 'text.required').options!;
        options.push(...[1, 2, 3].map((n) => ({ ...options[0], id: `extra${n}` })));
      },
    ],
    [
      'G7',
      'a quantity whose default is outside its range',
      (g) => (node(g, 'choice.count').default = 40),
    ],
    [
      'G8',
      'a guard that does not parse',
      (g) => (node(g, 'choice.answers').when = 'pending.buttons =='),
    ],
    [
      'G8',
      'a guard with no reason to show when it skips',
      (g) => delete node(g, 'choice.answers').skip,
    ],
    [
      'G8',
      'a guard that reads something nothing writes',
      (g) => (node(g, 'choice.answers').when = 'pending.buttonz == true'),
    ],
    [
      'G8',
      'a `next` list that can have no branch hold',
      (g) =>
        (node(g, 'brand.start').next = [
          { when: 'pending.brandKitExists == true', to: 'brand.logoSlot' },
        ]),
    ],
    [
      'G8',
      'a skip list that can have no reason hold',
      (g) =>
        (node(g, 'choice.count').skip = [
          { when: 'pending.buttons != true', skip: 'guided.skip.noButtons' },
        ]),
    ],
    [
      'G8',
      'a skip reason whose guard does not parse',
      (g) =>
        (node(g, 'choice.count').skip = [
          { when: 'pending.buttons !=', skip: 'guided.skip.noButtons' },
          { when: 'true', skip: 'guided.skip.decided' },
        ]),
    ],
    [
      'G9',
      'a score for a template that does not exist',
      (g) => (node(g, 'flow.start').options![0]!.score = { 'moon-landing': 100 }),
    ],
    [
      'G9',
      'a score that is not a whole number',
      (g) => (node(g, 'flow.start').options![0]!.score = { rsvp: 0.2 }),
    ],
    [
      'G11',
      `a chain longer than ${MAX_CHAIN} before a preview`,
      (g) => {
        const shape = node(g, 'choice.shape');
        for (const n of [1, 2, 3]) {
          g.nodes.push({
            ...node(g, 'choice.placement'),
            id: `choice.extra${n}`,
            next: n < 3 ? `choice.extra${n + 1}` : 'choice.preview',
          });
        }
        shape.next = 'choice.extra1';
      },
    ],
    ['G12', 'something that does not survive JSON', (g) => (node(g, 'end').help = undefined)],
  ];

  it.each(cases)('%s: %s', (rule, _what, breakIt) => {
    const graph = copy();
    breakIt(graph);
    expect([...rules(graph)]).toContain(rule);
  });

  const g4 = (catalogues: Catalogues) =>
    catalogueProblems(BUILDER_GRAPH, catalogues).map((problem) => problem.rule);

  it('G4: a key missing from one locale', () => {
    const catalogues = catalogueFor(BUILDER_GRAPH) as Record<string, Record<string, string>>;
    delete catalogues['is-IS']!['guided.choice.count.ask'];
    expect(g4(catalogues)).toContain('G4');
  });

  it('G4: a key present but empty', () => {
    const catalogues = catalogueFor(BUILDER_GRAPH) as Record<string, Record<string, string>>;
    catalogues['ja-JP']!['guided.flow.more.help'] = '  ';
    expect(g4(catalogues)).toContain('G4');
  });

  it('G10: a question over nine words in English', () => {
    const catalogues = catalogueFor(BUILDER_GRAPH) as Record<string, Record<string, string>>;
    catalogues['en-GB']!['guided.choice.count.ask'] =
      'How many different options would you like people to choose from?';
    expect(g4(catalogues)).toContain('G10');
  });

  it('G10: a question too long in a language written without spaces', () => {
    const catalogues = catalogueFor(BUILDER_GRAPH) as Record<string, Record<string, string>>;
    catalogues['zh-CN']!['guided.choice.count.ask'] =
      '您希望为人们提供多少个不同的选项以便他们从中进行选择呢请告诉我们';
    expect(g4(catalogues)).toContain('G10');
  });

  it('G10: a banned word, in any language', () => {
    const english = catalogueFor(BUILDER_GRAPH) as Record<string, Record<string, string>>;
    english['en-GB']!['guided.choice.answers.help'] = 'Pick the input type for this.';
    expect(g4(english)).toContain('G10');
    const swedish = catalogueFor(BUILDER_GRAPH) as Record<string, Record<string, string>>;
    swedish['sv-SE']!['guided.choice.answers.one'] = 'Ett fält med ett svar';
    expect(g4(swedish)).toContain('G10');
  });

  it('G10: a banned word is a whole word, so "controller" is not "control"', () => {
    const catalogues = catalogueFor(BUILDER_GRAPH) as Record<string, Record<string, string>>;
    catalogues['en-GB']!['guided.choice.answers.help'] = 'Ask the controller.';
    expect(g4(catalogues)).not.toContain('G10');
  });

  it('G13: an example chip with operative wording', () => {
    const catalogues = catalogueFor(BUILDER_GRAPH) as Record<string, Record<string, string>>;
    catalogues['en-GB']!['guided.text.label.exampleName'] = 'I give my consent';
    expect(g4(catalogues)).toContain('G13');
  });

  it('runs no catalogue rule on a graph whose shape is wrong', () => {
    expect(validateGraph({ nodes: 'no' }, catalogueFor(BUILDER_GRAPH)).map((p) => p.rule)).toEqual(
      expect.arrayContaining(['G0']),
    );
  });
});
