import { describe, expect, it } from 'vitest';
import { emptyDefinition } from '../forms/definition.js';
import { definitionProblems } from '../forms/helpers.js';
import { jsonEqual } from './changes.js';
import { BUILDER_GRAPH } from './graph/nodes.js';
import {
  answer,
  back,
  begin,
  jumpTargets,
  replay,
  resume,
  rewind,
  type Answer,
  type Conversation,
} from './machine.js';
import { MachineError } from './state.js';

/**
 * A seeded random walk over the shipped graph: any answer, Back, a breadcrumb jump, typed text of
 * any shape. After every step the promises of the machine still hold. This is the replay property
 * of `machine.test.ts` taken over paths nobody wrote down. `FUZZ_SEED=<n>` replays a failure.
 */
const SEED = Number(process.env['FUZZ_SEED'] ?? 20261021);

function prng(seed: number) {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (low: number, high: number) => low + Math.floor(next() * (high - low + 1)),
    pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)]!,
  };
}
type Rng = ReturnType<typeof prng>;

const G = BUILDER_GRAPH;
const locale = 'sv-SE';
const fresh = (canChangeBrand: boolean) =>
  begin(G, {
    definition: emptyDefinition,
    title: {},
    pending: { brandKitExists: false, canChangeBrand },
  });

const TEXT_BITS = [
  'Namn',
  ' ',
  'Vilken mat vill du ha?',
  'Åsa',
  '\u{1F600}',
  '\n',
  '"',
  '<b>',
  '0',
  '1e9',
  'x'.repeat(300),
  'Red, Green, Blue',
  ',',
  '',
];

function answersAt(r: Rng, c: Conversation): Answer[] {
  const node = G.nodes.find((candidate) => candidate.id === c.state.cursor)!;
  const out: Answer[] = jumpTargets(G, node.id).map((to) => ({ kind: 'jump', to }));
  const text = () => ({
    kind: 'text' as const,
    value: Array.from({ length: r.int(0, 6) }, () => r.pick(TEXT_BITS)).join(
      r.pick([' ', ', ', '']),
    ),
  });
  switch (node.kind) {
    case 'question':
    case 'pick-one':
      out.push(...node.options.map((o): Answer => ({ kind: 'option', optionId: o.id })));
      break;
    case 'quantity':
      out.push(
        { kind: 'quantity', value: node.min },
        { kind: 'quantity', value: r.int(node.min, node.max) },
        { kind: 'quantity', value: node.max + 1 },
        { kind: 'quantity', value: r.pick([-1, 0.5, Number.NaN, 1e9]) },
        { kind: 'list', labels: Array.from({ length: r.int(0, 6) }, () => r.pick(TEXT_BITS)) },
      );
      break;
    case 'text-entry':
      out.push(text(), text());
      break;
    case 'confirm-guess': {
      const templateId = c.state.guess?.templateId;
      if (templateId) {
        out.push(
          ...(['right', 'sort-of', 'no'] as const).map((verdict): Answer => ({
            kind: 'guess',
            verdict,
            templateId,
          })),
        );
      }
      break;
    }
    case 'preview-moment':
      out.push({ kind: 'continue' });
      break;
    default:
      break;
  }
  return out;
}

describe('a random walk over the builder graph', () => {
  it('every step is accepted or refused as a MachineError; replay, Back and resume always agree', () => {
    for (let walk = 0; walk < 60; walk += 1) {
      const r = prng(SEED + walk);
      let c = fresh(r.next() < 0.5);
      let wasPublishable = false;
      const trace: string[] = [];
      const ctx = () => `seed=${SEED + walk} walk=${walk} path=${trace.join(' > ')}`;

      for (let step = 0; step < 40; step += 1) {
        const roll = r.next();
        const before = c;
        try {
          if (roll < 0.12 && c.log.length > 0) {
            trace.push('back');
            c = back(c);
            // Back is exactly the step before.
            expect(jsonEqual(c, rewind(before, before.log.length - 1)), ctx()).toBe(true);
          } else if (roll < 0.17 && c.log.length > 1) {
            const to = r.int(0, c.log.length);
            trace.push(`rewind(${to})`);
            c = rewind(c, to);
          } else {
            const options = answersAt(r, c);
            if (options.length === 0) break;
            const picked = r.pick(options);
            trace.push(`${c.state.cursor}:${JSON.stringify(picked).slice(0, 60)}`);
            c = answer(G, c, picked, { locale });
          }
        } catch (error) {
          // Refusing an answer is allowed, and must leave the conversation exactly as it was.
          expect(error, `${ctx()} threw ${String(error)}`).toBeInstanceOf(MachineError);
          expect(jsonEqual(c, before), ctx()).toBe(true);
          continue;
        }

        // The state is always the log replayed, and resumable from its own JSON.
        expect(jsonEqual(replay(c.base, c.log), c.state), ctx()).toBe(true);
        const wire = JSON.parse(JSON.stringify(c.log)) as typeof c.log;
        expect(jsonEqual(resume(c.base, wire), c), ctx()).toBe(true);

        // Publishable once means publishable always, until the person's own hand removes it.
        const ok = definitionProblems(c.state.draft.definition).length === 0;
        if (wasPublishable && c.log.length > before.log.length) {
          expect(ok, `${ctx()} stopped being publishable`).toBe(true);
        }
        wasPublishable = ok;
      }
    }
  });
});
