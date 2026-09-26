import { describe, expect, it } from 'vitest';
import { answerableFields } from '../../forms/helpers.js';
import { BUILDER_GRAPH } from './nodes.js';
import { optionsOf, type Node } from './schema.js';
import { opProblem, parsePath, resolvePath } from './paths.js';

/**
 * The shipped graph, held to what `docs/plan/BUILDER-GRAPH.md` says slice S1 ships.
 *
 * `validate.test.ts` proves the rules catch mistakes; this proves the graph is the one planned —
 * the nodes, the kinds, and the one promise S1 can already check from the data alone.
 */

const nodes: readonly Node[] = BUILDER_GRAPH.nodes;

describe('the S1 graph', () => {
  it('is data: it survives a JSON round trip exactly', () => {
    expect(JSON.parse(JSON.stringify(BUILDER_GRAPH))).toEqual(BUILDER_GRAPH);
  });

  it('asks fifteen things, and has one menu and one end', () => {
    const asking = nodes.filter((n) => n.kind !== 'menu' && n.kind !== 'end');
    expect(asking).toHaveLength(15);
    expect(nodes.filter((n) => n.kind === 'menu').map((n) => n.id)).toEqual(['menu.top']);
    expect(nodes.filter((n) => n.kind === 'end').map((n) => n.id)).toEqual(['end']);
  });

  it('covers what the brief names: a brand kit, the buttons chain, a text question, a quantity, a guess', () => {
    const ids = nodes.map((n) => n.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        'brand.start',
        'brand.logoSlot',
        'choice.buttons',
        'choice.answers',
        'choice.count',
        'choice.shape',
        'choice.placement',
        'text.label',
        'guess.confirm',
      ]),
    );
    expect(nodes.find((n) => n.id === 'choice.count')?.kind).toBe('quantity');
    expect(nodes.find((n) => n.id === 'guess.confirm')?.kind).toBe('confirm-guess');
  });

  /**
   * "Publishable from the first answer" (PREDICTIVE-BUILDER.md). The machine that applies patches
   * is slice S2; what S1 can prove is that the data asks for it: every answer to the first question
   * adds a field that collects an answer.
   */
  it('adds a real question with every answer to the first node', () => {
    const start = nodes.find((n) => n.id === BUILDER_GRAPH.start)!;
    for (const option of optionsOf(start)) {
      const added = option.patch.filter(
        (op) => op.op === 'add' && op.path === 'draft.definition.fields',
      );
      expect(added, option.id).toHaveLength(1);
      const op = added[0] as unknown as { value: { $newField: { type: string } } };
      const type = op.value.$newField.type;
      const probe = answerableFields({
        schemaVersion: 1,
        fields: [{ id: 'x', key: 'x', type, label: { 'en-GB': 'x' } }],
        settings: {},
      } as never);
      expect(probe, `${option.id} adds ${type}`).toHaveLength(1);
    }
  });

  /** Offering the `tab` or `segmented` shape now would write a value the schema refuses (S5). */
  it('offers only shapes the form schema already has', () => {
    const shapes = optionsOf(nodes.find((n) => n.id === 'choice.shape')!);
    for (const option of shapes) for (const op of option.patch) expect(opProblem(op)).toBeNull();
    expect(shapes.map((o) => o.id)).toEqual(['pill', 'rounded', 'square', 'tile']);
  });
});

describe('paths', () => {
  it('address fields by what they are, not where they are', () => {
    const state = {
      focus: 'q-2',
      draft: {
        definition: {
          fields: [
            { id: 'q-1', label: 'a' },
            { id: 'q-2', label: 'b' },
          ],
        },
      },
    };
    const label = parsePath('draft.definition.fields[focus].label')!;
    expect(resolvePath(state, label)).toBe('b');
    const reordered = {
      ...state,
      draft: { definition: { fields: [...state.draft.definition.fields].reverse() } },
    };
    expect(resolvePath(reordered, label)).toBe('b');
  });

  it.each([
    '',
    'nowhere.x',
    'draft..x',
    'draft[',
    'draft[position=1]',
    'draft.1x',
    'pending[id=a b]',
  ])('refuse "%s"', (text) => {
    expect(parsePath(text)).toBeNull();
  });
});
