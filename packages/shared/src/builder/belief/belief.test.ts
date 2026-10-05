import { describe, expect, it } from 'vitest';
import { emptyDefinition } from '../../forms/definition.js';
import { BUILDER_GRAPH } from '../graph/nodes.js';
import type { BuilderGraph, Node } from '../graph/schema.js';
import { answer, begin, edit, rebase, toldOf, type Conversation } from '../machine.js';
import { bestQuestion, expectedGain, MAX_ASKED, MAX_UNSURE } from './entropy.js';
import { whyGuess } from './explain.js';
import { RECIPE_IDS, RECIPES } from './recipes.js';
import {
  beliefOf,
  entropy,
  GUESS_AT_MILLE,
  guessOf,
  logLikelihoods,
  probabilities,
  scoredOptions,
  startBelief,
  toldParts,
  type Told,
} from './update.js';
import { FORM_TEMPLATES } from '../../forms/templates.js';
import { expMicro } from '../../interpret/exp.js';

/**
 * The belief engine — `docs/plan/BELIEF.md`, `CAVEATS.md` #50. Integers throughout, so every
 * number here is the number on every machine: these are frozen, and a change to the scores, the
 * recipes or the arithmetic shows up as a change to them, for a person to review.
 */

const G = BUILDER_GRAPH as unknown as BuilderGraph;
const said = (nodeId: string, optionId: string): Told => ({
  nodeId,
  answer: { kind: 'option', optionId },
});
const verdict = (v: 'right' | 'sort-of' | 'no', templateId: string): Told => ({
  nodeId: 'guess.confirm',
  answer: { kind: 'guess', verdict: v, templateId },
});
const node = (id: string): Node => G.nodes.find((candidate) => candidate.id === id)!;
const ppmOf = (log: readonly Told[], id: string) =>
  probabilities(beliefOf(G, log).belief).find((weight) => weight.id === id)?.millinats ?? 0;

/** Proxy and power of attorney, neck and neck: what an association's own paper tends to be. */
const PROXY: readonly Told[] = [
  said('flow.start', 'collect'),
  said('guess.reply', 'no'),
  said('guess.meeting', 'yes'),
  said('guess.behalf', 'yes'),
];

describe('the recipes', () => {
  it('are every template in the catalogue, and the two rule 8 keeps out of it', () => {
    expect(RECIPE_IDS).toEqual([
      ...FORM_TEMPLATES.map((template) => template.id),
      'consent-form',
      'incident-report',
    ]);
    expect(RECIPES.filter((recipe) => recipe.structure).map((r) => r.id)).toEqual([
      'consent-form',
      'incident-report',
    ]);
  });

  it('are named as the catalogue names them, in every language, so the guess never needs it', () => {
    for (const template of FORM_TEMPLATES) {
      expect(RECIPES.find((recipe) => recipe.id === template.id)?.name).toEqual(template.name);
    }
    for (const recipe of RECIPES.filter((r) => r.structure)) {
      expect(recipe.name).toBe(recipe.structure!.name);
      expect(Object.keys(recipe.name).sort()).toEqual(Object.keys(FORM_TEMPLATES[0]!.name).sort());
    }
  });

  it('start even, but for the catalogue’s general sign-up', () => {
    expect(RECIPES.filter((recipe) => recipe.prior !== 0).map((r) => [r.id, r.prior])).toEqual([
      ['event-registration', 700],
    ]);
  });
});

describe('the arithmetic', () => {
  it('is the same on every machine: these numbers, frozen', () => {
    const state = beliefOf(G, PROXY);
    const top = [...probabilities(state.belief)]
      .sort((a, b) => b.millinats - a.millinats)
      .slice(0, 3);
    expect(top).toEqual([
      { id: 'meeting-proxy', millinats: 515_307 },
      { id: 'power-of-attorney', millinats: 465_803 },
      { id: 'motion-submission', millinats: 15_329 },
    ]);
    expect(entropy(startBelief())).toBe(3205);
    expect(entropy(state.belief)).toBe(790);
    expect(guessOf(state)).toEqual({ templateId: 'meeting-proxy', pMille: 515 });
    // What tells the two apart: a proxy is for a meeting on a set date.
    expect(
      bestQuestion(
        G,
        state,
        'guess',
        PROXY.map((told) => told.nodeId),
        () => true,
      ),
    ).toBe('guess.date');
    expect(
      expectedGain(beliefOf(G, [said('flow.start', 'signup')]).belief, node('guess.date')),
    ).toBe(433);
  });

  it('gives probabilities that sum to a million, within rounding', () => {
    for (const log of [[], PROXY, [said('flow.start', 'feedback')]]) {
      const sum = probabilities(beliefOf(G, log).belief).reduce((t, w) => t + w.millinats, 0);
      expect(Math.abs(sum - 1_000_000)).toBeLessThanOrEqual(RECIPES.length);
    }
  });

  it('reads an answer as a likelihood: over a question’s scored answers, a recipe’s sum to one, within a millinat’s rounding', () => {
    for (const each of G.nodes) {
      const options = scoredOptions(each);
      if (options.length === 0) continue;
      for (const id of RECIPE_IDS) {
        const sum = options.reduce(
          (total, option) => total + expMicro(-logLikelihoods(each, option.id)!.get(id)!),
          0,
        );
        // Each log is a whole millinat, so each e^log is within 0.05% of the true value.
        expect(Math.abs(sum - 1_000_000), `${each.id} ${id}`).toBeLessThanOrEqual(1000);
      }
    }
  });

  it('says nothing for "Not sure", and takes nothing a question does not ask', () => {
    expect(logLikelihoods(node('guess.date'), 'unsure')).toBeNull();
    const before = beliefOf(G, [said('flow.start', 'signup')]);
    const after = beliefOf(G, [said('flow.start', 'signup'), said('guess.date', 'unsure')]);
    expect(after.belief).toEqual(before.belief);
    expect(after.unsure).toEqual(['guess.date']);
    // A jump or an edit is not an answer to weigh.
    const jumped = beliefOf(G, [
      said('flow.start', 'signup'),
      { nodeId: 'brand.start', answer: { kind: 'jump' } },
    ]);
    expect(jumped.belief).toEqual(before.belief);
  });
});

describe('the three states of a guess', () => {
  it('Sort of halves the guess, and holds it back until another question is answered', () => {
    const before = ppmOf(PROXY, 'meeting-proxy');
    const log = [...PROXY, verdict('sort-of', 'meeting-proxy')];
    const state = beliefOf(G, log);
    expect(state.held).toEqual(['meeting-proxy']);
    expect(ppmOf(log, 'meeting-proxy')).toBeLessThan(before);
    expect(guessOf(state)?.templateId).toBe('power-of-attorney');
    const answered = beliefOf(G, [...log, said('guess.date', 'yes')]);
    expect(answered.held).toEqual([]);
    expect(guessOf(answered)?.templateId).toBe('meeting-proxy');
  });

  it('No rules the guess out for the rest of the conversation', () => {
    const log = [...PROXY, verdict('no', 'meeting-proxy'), said('guess.date', 'yes')];
    const state = beliefOf(G, log);
    expect(state.rejected).toEqual(['meeting-proxy']);
    expect(state.belief.some((weight) => weight.id === 'meeting-proxy')).toBe(false);
    expect(guessOf(state)?.templateId).toBe('power-of-attorney');
  });

  it('Right settles it: nothing more is asked', () => {
    const state = beliefOf(G, [...PROXY, verdict('right', 'meeting-proxy')]);
    expect(state.confirmed).toBe('meeting-proxy');
    expect(bestQuestion(G, state, 'guess', [], () => true)).toBeNull();
  });
});

describe('which question next', () => {
  const asked = (log: readonly Told[]) => log.map((told) => told.nodeId);

  it('stops at the threshold: the guess is asked instead', () => {
    const sure = [...PROXY, said('guess.date', 'yes')];
    const state = beliefOf(G, sure);
    expect(guessOf(state)!.pMille).toBeGreaterThanOrEqual(GUESS_AT_MILLE);
    expect(bestQuestion(G, state, 'guess', asked(sure), () => true)).toBeNull();
  });

  it(`asks at most ${MAX_ASKED}, and stops after ${MAX_UNSURE} "Not sure"`, () => {
    let log: Told[] = [said('flow.start', 'other')];
    for (let i = 0; i < MAX_UNSURE; i += 1) {
      const next = bestQuestion(G, beliefOf(G, log), 'guess', asked(log), () => true);
      expect(next).not.toBeNull();
      log = [...log, said(next!, 'unsure')];
    }
    expect(bestQuestion(G, beliefOf(G, log), 'guess', asked(log), () => true)).toBeNull();

    const many = G.nodes
      .filter((n) => n.group === 'guess' && scoredOptions(n).length > 0)
      .slice(0, MAX_ASKED)
      .map((n) => said(n.id, 'no'));
    const state = beliefOf(G, [said('flow.start', 'other'), ...many]);
    if (guessOf(state)!.pMille < GUESS_AT_MILLE) {
      expect(bestQuestion(G, state, 'guess', asked(many), () => true)).toBeNull();
    }
  });

  it('never asks a question it cannot ask now, nor one already answered', () => {
    const state = beliefOf(G, [said('flow.start', 'signup')]);
    const first = bestQuestion(G, state, 'guess', [], () => true)!;
    expect(bestQuestion(G, state, 'guess', [first], () => true)).not.toBe(first);
    expect(bestQuestion(G, state, 'guess', [], (n) => n.id !== first)).not.toBe(first);
  });
});

describe('"Why this guess"', () => {
  it('lists the three answers that moved it most, strongest first', () => {
    expect(whyGuess(G, PROXY, 'meeting-proxy')).toEqual([
      { nodeId: 'guess.behalf', optionId: 'yes', millinats: 3369 },
      { nodeId: 'guess.meeting', optionId: 'yes', millinats: 3080 },
      { nodeId: 'flow.start', optionId: 'collect', millinats: 1379 },
    ]);
  });

  it('lists only answers that favoured it', () => {
    const reasons = whyGuess(G, [...PROXY, said('guess.signature', 'no')], 'meeting-proxy');
    expect(reasons.every((reason) => reason.millinats > 0)).toBe(true);
    expect(reasons.map((reason) => reason.nodeId)).not.toContain('guess.signature');
  });
});

/**
 * Every recipe, answered as a person building it would answer: "yes" where the table says yes,
 * "no" where it says no, "Not sure" where it names it on neither side. What the table can tell
 * apart is guessed within "What is this form for?" and five answers.
 */
const opts = (n: Node) =>
  'options' in n ? (n.options as readonly { id: string; score?: Record<string, number> }[]) : [];

/**
 * A conversation to where the guess questions end, answered as a person building `recipe` would:
 * "yes" where the table says yes, "no" where it says no, "Not sure" where it names it on neither
 * side, in the order the engine asks.
 */
function walk(recipe: string): Conversation {
  let c = begin(G, {
    definition: emptyDefinition,
    title: {},
    pending: { brandKitExists: false, canChangeBrand: false },
  });
  const start = opts(node('flow.start'))
    .map((o) => ({ id: o.id, s: o.score?.[recipe] ?? -1 }))
    .sort((a, b) => b.s - a.s)[0]!;
  c = answer(
    G,
    c,
    { kind: 'option', optionId: start.s > 0 ? start.id : 'other' },
    { locale: 'en-GB' },
  );
  return answerAs(c, recipe);
}

/** On from here as a person building `recipe` would answer, to where the guess questions end. */
function answerAs(from: Conversation, recipe: string): Conversation {
  let c = from;
  for (;;) {
    const at = node(c.state.cursor);
    if (at.group !== 'guess' || at.kind !== 'question') return c;
    const yes = opts(at).find((o) => o.id === 'yes')!.score?.[recipe];
    const no = opts(at).find((o) => o.id === 'no')!.score?.[recipe];
    const optionId = yes ? 'yes' : no ? 'no' : 'unsure';
    c = answer(G, c, { kind: 'option', optionId }, { locale: 'en-GB' });
  }
}

/** "No" to the guess, as the screen sends it. */
const no = (c: Conversation) =>
  answer(
    G,
    c,
    { kind: 'guess', verdict: 'no', templateId: c.state.guess!.templateId },
    { locale: 'en-GB' },
  );

describe('after "No"', () => {
  it('guesses the next recipe at once when it is already sure enough (#119)', () => {
    // A proxy form and a power of attorney answer alike but for one question: "No" to the one
    // leaves the other at 918 per mille, and it is offered, not passed over for the brand.
    const at = walk('meeting-proxy');
    expect(at.state).toMatchObject({
      cursor: 'guess.confirm',
      guess: { templateId: 'meeting-proxy' },
    });
    const after = no(at);
    expect(after.state.cursor).toBe('guess.confirm');
    expect(after.state.guess).toEqual({ templateId: 'power-of-attorney', pMille: 918 });
    expect(after.log.at(-1)).toMatchObject({ nodeId: 'guess.confirm', to: 'guess.confirm' });
    // And "No" to that too goes on, never back to a recipe already refused.
    const again = no(after);
    expect(again.state.guess?.templateId).not.toBe('meeting-proxy');
    expect(beliefOf(G, again.log).rejected).toEqual(['meeting-proxy', 'power-of-attorney']);
  });

  it('asks on when a question is still worth asking', () => {
    const after = no(walk('event-registration'));
    expect(after.state.cursor).toBe('guess.meeting');
  });

  it("goes on to the form's name, then the brand, when neither: five asked, and nothing sure enough", () => {
    const after = no(walk('quote-request'));
    expect(after.state.guess!.pMille).toBeLessThan(GUESS_AT_MILLE);
    expect(after.state.cursor).toBe('flow.title');
  });
});

describe('over a rebase', () => {
  /** The draft changed outside the conversation (the classic editor), then carried on over it. */
  const changedOutside = (c: Conversation): Conversation => {
    const outside = edit(
      c,
      [{ op: 'set', path: 'draft.title', value: { 'en-GB': 'Changed in the editor' } }],
      { locale: 'en-GB' },
    );
    return rebase(G, c, outside.state.draft);
  };

  it('keeps what the belief was told: the same guess, the same "Why", the same next step (#120)', () => {
    const at = walk('meeting-proxy');
    const rebased = changedOutside(at);
    expect(rebased.log).toEqual([]);
    expect(beliefOf(G, toldOf(rebased))).toEqual(beliefOf(G, toldOf(at)));
    const guess = at.state.guess!.templateId;
    expect(whyGuess(G, toldOf(rebased), guess)).toEqual(whyGuess(G, toldOf(at), guess));
    const [a, b] = [no(at), no(rebased)];
    expect(b.state.cursor).toBe(a.state.cursor);
    expect(b.state.guess).toEqual(a.state.guess);
  });

  it('mid-way through the questions, asks on as it would have: nothing again, nothing more', () => {
    const before = walkTo(2); // "What is this form for?" and one guess question
    const straight = answerAs(before, 'meeting-proxy');
    const rebased = answerAs(changedOutside(before), 'meeting-proxy');
    const asked = (c: Conversation) => c.log.map((entry) => entry.nodeId);
    expect(asked(rebased)).toEqual(asked(straight).slice(before.log.length));
    expect(rebased.state.cursor).toBe('guess.confirm');
    expect(rebased.state.guess).toEqual(straight.state.guess);
  });

  it('carries on through a second rebase, and forgets nothing that was said', () => {
    const once = changedOutside(walkTo(3));
    const step = answer(G, once, { kind: 'option', optionId: 'yes' }, { locale: 'en-GB' });
    const twice = changedOutside(step);
    expect(toldOf(twice)).toEqual(toldParts(G, toldOf(step)));
    expect(toldOf(twice)).toHaveLength(4);
  });

  it('keeps "Right": nothing is guessed again after it', () => {
    const at = walk('meeting-proxy');
    const right = answer(
      G,
      at,
      { kind: 'guess', verdict: 'right', templateId: 'meeting-proxy' },
      { locale: 'en-GB', templates: FORM_TEMPLATES },
    );
    expect(beliefOf(G, toldOf(changedOutside(right))).confirmed).toBe('meeting-proxy');
  });
});

/** `walk('meeting-proxy')`, stopped after `steps` steps of its log. */
function walkTo(steps: number): Conversation {
  let c = begin(G, {
    definition: emptyDefinition,
    title: {},
    pending: { brandKitExists: false, canChangeBrand: false },
  });
  const full = walk('meeting-proxy');
  for (const entry of full.log.slice(0, steps)) {
    c = answer(G, c, entry.answer as Parameters<typeof answer>[2], { locale: 'en-GB' });
  }
  return c;
}

describe('every recipe, answered as itself', () => {
  /** They answer the five broadest questions alike (`BELIEF.md`, "Known limits"). */
  const twins = ['member-details', 'absence-notice'];

  it.each(RECIPE_IDS.filter((id) => !twins.includes(id)))('%s is guessed', (recipe) => {
    const c = walk(recipe);
    expect(c.state.cursor).toBe('guess.confirm');
    expect(c.state.guess?.templateId).toBe(recipe);
    expect(c.state.guess!.pMille).toBeGreaterThanOrEqual(GUESS_AT_MILLE);
  });

  it.each(twins)('%s ends as one of the two likeliest, with its twin', (recipe) => {
    const c = walk(recipe);
    const top = [...probabilities(beliefOf(G, c.log).belief)]
      .sort((a, b) => b.millinats - a.millinats)
      .slice(0, 2)
      .map((weight) => weight.id);
    expect(top.sort()).toEqual([...twins].sort());
  });
});
