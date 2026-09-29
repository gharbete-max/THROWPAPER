import { describe, expect, it } from 'vitest';
import { emptyDefinition, type Field } from '../forms/definition.js';
import { jsonEqual } from './changes.js';
import { BUILDER_GRAPH } from './graph/nodes.js';
import type { Node } from './graph/schema.js';
import {
  answer,
  back,
  begin,
  edit,
  jumpTargets,
  keepMine,
  rebase,
  replay,
  takeGuided,
  type Answer,
  type Conversation,
} from './machine.js';
import { changedByHand, proposals } from './reconcile.js';
import { MachineError } from './state.js';

/**
 * Reconciliation — `PREDICTIVE-BUILDER.md`, "Reconciliation: the rule everyone forgets", and
 * non-negotiable 4: a question changed by hand, on the preview or in the classic editor, is never
 * written over by the conversation. It proposes; the person keeps theirs or takes the guided one.
 */

const G = BUILDER_GRAPH;
const locale = 'sv-SE';
const fresh = () =>
  begin(G, { definition: emptyDefinition, title: {}, pending: { brandKitExists: false } });
const step = (c: Conversation, given: Answer) => answer(G, c, given, { locale });
const option = (optionId: string): Answer => ({ kind: 'option', optionId });

/** The buttons chain as far as the number of options: the focused question is a choice. */
function aChoice(): Conversation {
  return [
    option('signup'),
    option('unsure'),
    option('unsure'),
    option('later'),
    { kind: 'text', value: 'Mat' } as Answer,
    option('yes'),
    option('yes'),
    option('one'),
    { kind: 'quantity', value: 5 } as Answer,
  ].reduce(step, fresh());
}

const rename = (c: Conversation, id: string, label: string) =>
  edit(
    c,
    [{ op: 'set', path: `draft.definition.fields[id=${id}].label`, value: { [locale]: label } }],
    {
      locale,
    },
  );

const field = (c: Conversation, id: string) =>
  c.state.draft.definition.fields.find((f) => f.id === id) as Field;

describe('a question the conversation made', () => {
  it('records how it left it, so nothing it made reads as changed by hand', () => {
    const c = aChoice();
    const id = c.state.focus!;
    expect(c.state.sidecar.fields[id]?.guided).toEqual(field(c, id));
    expect(changedByHand(c.state, id)).toBe(false);
    for (const each of c.state.draft.definition.fields) {
      expect(changedByHand(c.state, each.id)).toBe(false);
    }
  });

  it('is changed by hand once a person edits it, and is not after Back', () => {
    const c = aChoice();
    const id = c.state.focus!;
    const edited = rename(c, id, 'Maträtt');
    expect(changedByHand(edited.state, id)).toBe(true);
    expect(changedByHand(back(edited).state, id)).toBe(false);
  });
});

describe('a step that would change a question changed by hand', () => {
  const setUp = () => {
    const c = aChoice();
    const id = c.state.focus!;
    return { id, c: rename(c, id, 'Maträtt') };
  };

  it('leaves the person’s version, and proposes its own', () => {
    const { id, c } = setUp();
    const mine = field(c, id);
    const after = step(c, option('pill'));
    expect(field(after, id)).toEqual(mine);
    expect(proposals(after.state)).toEqual([id]);
    // What the conversation would have made: the person's version with its change on top.
    expect(after.state.sidecar.fields[id]?.proposal).toMatchObject({
      label: { [locale]: 'Maträtt' },
      style: { shape: 'pill' },
    });
    // The conversation carries on regardless: nothing blocks, nothing is lost.
    expect(after.state.cursor).toBe('choice.placement');
  });

  it('goes on building its proposal, and stops asking when it comes round to the person’s', () => {
    const { id, c } = setUp();
    // "No, people type an answer", while the person's choice keeps its five options...
    let d = step(step(c, { kind: 'jump', to: 'choice.buttons' }), option('no'));
    expect(field(d, id).type).toBe('single_select');
    expect(d.state.sidecar.fields[id]?.proposal).toMatchObject({ type: 'short_text' });
    // ...and back to "Yes": the conversation's version is the person's again.
    d = step(step(d, { kind: 'jump', to: 'menu.top' }), { kind: 'jump', to: 'choice.buttons' });
    d = step(d, option('yes'));
    expect(proposals(d.state)).toEqual([]);
    expect(field(d, id)).toEqual(field(c, id));
    expect(changedByHand(d.state, id)).toBe(false);
  });

  it('is undone by Back like any step, proposal and all', () => {
    const { c } = setUp();
    const after = step(c, option('pill'));
    expect(jsonEqual(back(after), c)).toBe(true);
    expect(jsonEqual(replay(after.base, after.log), after.state)).toBe(true);
  });
});

describe('Keep mine and Use guided', () => {
  const waiting = () => {
    const c = aChoice();
    const id = c.state.focus!;
    return { id, c: step(rename(c, id, 'Maträtt'), option('pill')) };
  };

  it('Keep mine drops the proposal and keeps the person’s version, still changed by hand', () => {
    const { id, c } = waiting();
    const kept = keepMine(c, id);
    expect(field(kept, id)).toEqual(field(c, id));
    expect(proposals(kept.state)).toEqual([]);
    expect(changedByHand(kept.state, id)).toBe(true);
    expect(kept.state.cursor).toBe(c.state.cursor);
    expect(jsonEqual(back(kept), c)).toBe(true);
  });

  it('Use guided takes the proposal, and the question is the conversation’s again', () => {
    const { id, c } = waiting();
    const taken = takeGuided(c, id);
    expect(field(taken, id)).toEqual(c.state.sidecar.fields[id]?.proposal);
    expect(proposals(taken.state)).toEqual([]);
    expect(changedByHand(taken.state, id)).toBe(false);
    expect(jsonEqual(back(taken), c)).toBe(true);
  });

  it('Revert to guided, with nothing proposed, goes back to how the conversation left it', () => {
    const c = aChoice();
    const id = c.state.focus!;
    const reverted = takeGuided(rename(c, id, 'Maträtt'), id);
    expect(field(reverted, id)).toEqual(field(c, id));
    expect(changedByHand(reverted.state, id)).toBe(false);
  });

  it('are refused, with nothing changed, when there is nothing to keep or take', () => {
    const c = fresh();
    expect(() => keepMine(c, 'q-none')).toThrow(MachineError);
    expect(() => takeGuided(c, 'q-none')).toThrow(MachineError);
  });

  it('stay out of the trail', () => {
    const { id, c } = waiting();
    expect(keepMine(c, id).log.at(-1)).toMatchObject({
      answer: { kind: 'edit' },
      source: 'manual',
    });
  });
});

describe('carrying on after the classic editor', () => {
  it('takes the editor’s draft whole, and what was changed there shows as changed by hand', () => {
    const c = aChoice();
    const id = c.state.focus!;
    const edited = structuredClone(c.state.draft);
    const target = edited.definition.fields.find((f) => f.id === id)!;
    Object.assign(target, { label: { [locale]: 'Från redigeraren' } });
    const again = rebase(G, c, edited);
    expect(again.state.draft).toEqual(edited);
    expect(again.log).toEqual([]);
    expect(again.state.cursor).toBe(c.state.cursor);
    expect(changedByHand(again.state, id)).toBe(true);
    // And the conversation proposes rather than writes over it.
    const on = step(again, option('pill'));
    expect(field(on, id)).toMatchObject({ label: { [locale]: 'Från redigeraren' } });
    expect(proposals(on.state)).toEqual([id]);
  });

  it('moves on when the question it was building was deleted there', () => {
    const c = aChoice();
    const id = c.state.focus!;
    const edited = structuredClone(c.state.draft);
    edited.definition.fields = edited.definition.fields.filter((f) => f.id !== id);
    const again = rebase(G, c, edited);
    expect(again.state.focus).toBeNull();
    // "What shape?" has no question to shape any more: the menu, where every way on is open.
    expect(again.state.cursor).toBe('menu.top');
    expect(() => step(again, { kind: 'jump', to: 'text.label' })).not.toThrow();
  });
});

describe('never clobbers (a property, over the whole graph)', () => {
  /** Every answer at the node, escapes included — as `machine.test.ts` walks them. */
  function answersAt(c: Conversation): Answer[] {
    // Widened: the shipped graph has no pick-many node yet, but the walk takes any graph.
    const node = G.nodes.find((n) => n.id === c.state.cursor) as Node;
    const out: Answer[] = jumpTargets(G, node.id).map((to) => ({ kind: 'jump', to }));
    if (node.kind === 'question' || node.kind === 'pick-one') {
      out.push(...node.options.map((o) => option(o.id)));
    } else if (node.kind === 'pick-many') {
      out.push({ kind: 'options', optionIds: node.options.map((o) => o.id) });
    } else if (node.kind === 'quantity') {
      out.push({ kind: 'quantity', value: node.default });
    } else if (node.kind === 'text-entry') {
      out.push({ kind: 'text', value: 'Vilken dag?' });
    } else if (node.kind === 'preview-moment' || node.kind === 'review-queue') {
      out.push({ kind: 'continue' });
    }
    return out;
  }

  /** A small, fixed pseudo-random sequence: the same walks on every machine. */
  function* lcg(seed: number) {
    let x = seed;
    for (;;) {
      x = (x * 1103515245 + 12345) % 2147483648;
      yield x;
    }
  }

  it('leaves every question changed by hand exactly as it was, through every step of 40 walks', () => {
    let checked = 0;
    for (let seed = 1; seed <= 40; seed += 1) {
      const random = lcg(seed);
      // The high bits: a power-of-two LCG's low bits repeat with a period of a few steps.
      const pick = (n: number) => Math.floor(Number(random.next().value) / 65536) % n;
      let c = fresh();
      for (let move = 0; move < 30; move += 1) {
        const fields = c.state.draft.definition.fields;
        if (fields.length > 0 && pick(4) === 0) {
          const target = fields[pick(fields.length)]!;
          c = rename(c, target.id, `För hand ${seed}.${move}`);
          continue;
        }
        const answers = answersAt(c);
        if (answers.length === 0) break;
        const before = c;
        c = step(c, answers[pick(answers.length)]!);
        for (const each of before.state.draft.definition.fields) {
          if (!changedByHand(before.state, each.id)) continue;
          expect(field(c, each.id), `${seed}.${move}: ${each.id}`).toEqual(each);
          checked += 1;
        }
        expect(jsonEqual(back(c), before)).toBe(true);
      }
    }
    // The walks did meet hand-changed questions, many times.
    expect(checked).toBeGreaterThan(100);
  });
});
