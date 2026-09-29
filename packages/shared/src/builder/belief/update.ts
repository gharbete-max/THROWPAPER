import { expMicro } from '../../interpret/exp.js';
import { lnMille } from '../../interpret/ln.js';
import type { BuilderGraph, Node, Option } from '../graph/schema.js';
import type { Guess } from '../state.js';
import { RECIPES } from './recipes.js';

/**
 * The belief — `docs/plan/BELIEF.md`: a weight in millinats for each recipe, moved by the answers
 * to scored questions and by the guess's three states, and turned into probabilities with integers
 * only (ADR 0019). Pure: the same log gives the same belief on every machine.
 */

/** A recipe's weight, in millinats. A belief lists them in `recipes.json`'s order. */
export interface Weight {
  readonly id: string;
  readonly millinats: number;
}
export type Belief = readonly Weight[];

/** "This looks like …" is asked at this probability or more, in thousandths (brief §6). */
export const GUESS_AT_MILLE = 800;

const MILLION = 1_000_000;

/** Before any answer: each recipe's prior. */
export function startBelief(): Belief {
  return RECIPES.map((recipe) => ({ id: recipe.id, millinats: recipe.prior }));
}

/** log Σ e^x, in millinats, for whole numbers of millinats. */
export function logSumExp(values: readonly number[]): number {
  const top = Math.max(...values);
  const sum = values.reduce((total, x) => total + expMicro(top - x), 0);
  return top + lnMille(sum, MILLION);
}

/** A node's options that carry a score: those an answer can be weighed by. */
export function scoredOptions(node: Node): readonly Option[] {
  const options = 'options' in node ? (node.options as readonly Option[]) : [];
  return options.filter((option) => option.score !== undefined);
}

const likelihoods = new WeakMap<Node, Map<string, ReadonlyMap<string, number>>>();

/**
 * `log P(option | recipe)` for every recipe, in millinats: the option's score for the recipe (0 if
 * it names none) less the log of the sum over the node's scored options. Null for an option with no
 * score at all — "Not sure" — which says nothing about any recipe.
 */
export function logLikelihoods(node: Node, optionId: string): ReadonlyMap<string, number> | null {
  const scored = scoredOptions(node);
  const option = scored.find((candidate) => candidate.id === optionId);
  if (!option) return null;
  let byOption = likelihoods.get(node);
  if (!byOption) {
    byOption = new Map();
    likelihoods.set(node, byOption);
  }
  const known = byOption.get(optionId);
  if (known) return known;
  const result = new Map<string, number>();
  for (const recipe of RECIPES) {
    const scores = scored.map((candidate) => candidate.score?.[recipe.id] ?? 0);
    result.set(recipe.id, (option.score?.[recipe.id] ?? 0) - logSumExp(scores));
  }
  byOption.set(optionId, result);
  return result;
}

/** The belief after a likelihood: each recipe's weight plus its log-likelihood. */
export function weigh(belief: Belief, logs: ReadonlyMap<string, number>): Belief {
  return belief.map((weight) => ({
    id: weight.id,
    millinats: weight.millinats + (logs.get(weight.id) ?? 0),
  }));
}

/** Each recipe's probability in parts per million, rounded; they sum to 10⁶ within rounding. */
export function probabilities(belief: Belief): readonly Weight[] {
  if (belief.length === 0) return [];
  const top = Math.max(...belief.map((weight) => weight.millinats));
  const shares = belief.map((weight) => expMicro(top - weight.millinats));
  const sum = shares.reduce((total, share) => total + share, 0);
  return belief.map((weight, index) => ({
    id: weight.id,
    // round(share × 10⁶ / sum), halves up.
    millinats: Math.floor((2 * shares[index]! * MILLION + sum) / (2 * sum)),
  }));
}

/** Parts per million as thousandths, rounded half up. */
export const perMille = (ppm: number): number => Math.floor((ppm + 500) / 1000);

/**
 * The belief's entropy in millinats: `ln(S / 10⁶) + Σ p·(m − b) / 10⁶`, with m the largest weight
 * and S the sum of `expMicro(m − b)` — so one logarithm, however many recipes.
 */
export function entropy(belief: Belief): number {
  if (belief.length <= 1) return 0;
  const top = Math.max(...belief.map((weight) => weight.millinats));
  const sum = belief.reduce((total, weight) => total + expMicro(top - weight.millinats), 0);
  const ppm = probabilities(belief);
  const spread = belief.reduce(
    (total, weight, index) => total + ppm[index]!.millinats * (top - weight.millinats),
    0,
  );
  return lnMille(sum, MILLION) + Math.floor((2 * spread + MILLION) / (2 * MILLION));
}

// --- What the log has said -------------------------------------------------------------------

/** A step of the log as the belief reads it: which node, and what was said. */
export interface Told {
  readonly nodeId: string;
  readonly answer: {
    readonly kind: string;
    readonly optionId?: string;
    readonly optionIds?: readonly string[];
    readonly verdict?: string;
    readonly templateId?: string;
  };
}

export interface BeliefState {
  /** The recipes still believed possible, with their weights. */
  readonly belief: Belief;
  /** Said "No" to: never guessed again. */
  readonly rejected: readonly string[];
  /** Said "Sort of" to, and no guess question answered since: not guessed until one is. */
  readonly held: readonly string[];
  /** Said "Right" to: seeded, and nothing more to guess. */
  readonly confirmed: string | null;
  /** Scored questions answered "Not sure": they told nothing, and the person may know no more. */
  readonly unsure: readonly string[];
}

/** "Sort of" is a likelihood of ½ on the guess: ln ½ in millinats. */
const SORT_OF = lnMille(1, 2);

/** What the log has said, from the priors on. */
export function beliefOf(graph: BuilderGraph, log: readonly Told[]): BeliefState {
  let belief = startBelief();
  const rejected: string[] = [];
  let held: string[] = [];
  let confirmed: string | null = null;
  const unsure: string[] = [];
  for (const entry of log) {
    const { answer } = entry;
    if (answer.kind === 'guess' && answer.templateId !== undefined) {
      const guessed = answer.templateId;
      if (answer.verdict === 'right') confirmed = guessed;
      else if (answer.verdict === 'sort-of') {
        belief = belief.map((w) =>
          w.id === guessed ? { id: w.id, millinats: w.millinats + SORT_OF } : w,
        );
        held = [...held.filter((id) => id !== guessed), guessed];
      } else if (answer.verdict === 'no') {
        belief = belief.filter((w) => w.id !== guessed);
        if (!rejected.includes(guessed)) rejected.push(guessed);
        held = held.filter((id) => id !== guessed);
      }
      continue;
    }
    const chosen =
      answer.kind === 'option' && answer.optionId !== undefined
        ? [answer.optionId]
        : answer.kind === 'options'
          ? (answer.optionIds ?? [])
          : [];
    const node = graph.nodes.find((candidate) => candidate.id === entry.nodeId);
    if (!node || chosen.length === 0) continue;
    let moved = false;
    for (const optionId of chosen) {
      const logs = logLikelihoods(node, optionId);
      if (!logs) {
        if (scoredOptions(node).length > 0) unsure.push(node.id);
        continue;
      }
      belief = weigh(belief, logs);
      moved = true;
    }
    if (moved) held = [];
  }
  return { belief, rejected, held, confirmed, unsure };
}

/** The recipe to guess, and how sure: the likeliest that may be guessed; null if none may. */
export function guessOf(state: BeliefState): Guess | null {
  const ppm = probabilities(state.belief);
  let best: Weight | null = null;
  for (const candidate of ppm) {
    if (state.held.includes(candidate.id)) continue;
    if (best === null || candidate.millinats > best.millinats) best = candidate;
  }
  return best === null ? null : { templateId: best.id, pMille: perMille(best.millinats) };
}

// --- Over a rebase ----------------------------------------------------------------------------

/**
 * Where a conversation carried over a draft changed outside it keeps what the belief was told
 * before: `rebase` begins a new log, so Back can never undo the editor, and the belief is read
 * from the log. The answers themselves go into the new base's `pending` under this key, and the
 * belief reads them first (`BELIEF.md`, "Over a rebase").
 */
export const TOLD_BEFORE = 'toldBefore';

/** Whether a step told the belief anything: the guess's verdict, or an answer to a scored question. */
export function tells(graph: BuilderGraph, entry: Told): boolean {
  const { kind } = entry.answer;
  if (kind === 'guess') return true;
  if (kind !== 'option' && kind !== 'options') return false;
  const node = graph.nodes.find((candidate) => candidate.id === entry.nodeId);
  return node !== undefined && scoredOptions(node).length > 0;
}

/** Of steps, what the belief reads — which node, and what was said — and nothing of their changes. */
export function toldParts(graph: BuilderGraph, steps: readonly Told[]): Told[] {
  return steps
    .filter((entry) => tells(graph, entry))
    .map(({ nodeId, answer: { kind, optionId, optionIds, verdict, templateId } }) => ({
      nodeId,
      answer: {
        kind,
        ...(optionId !== undefined && { optionId }),
        ...(optionIds !== undefined && { optionIds: [...optionIds] }),
        ...(verdict !== undefined && { verdict }),
        ...(templateId !== undefined && { templateId }),
      },
    }));
}

const isString = (value: unknown): value is string => typeof value === 'string';

function isTold(value: unknown): value is Told {
  if (typeof value !== 'object' || value === null) return false;
  const { nodeId, answer } = value as { nodeId?: unknown; answer?: unknown };
  if (!isString(nodeId) || typeof answer !== 'object' || answer === null) return false;
  const { kind, optionId, optionIds, verdict, templateId } = answer as Record<string, unknown>;
  return (
    isString(kind) &&
    (optionId === undefined || isString(optionId)) &&
    (optionIds === undefined || (Array.isArray(optionIds) && optionIds.every(isString))) &&
    (verdict === undefined || isString(verdict)) &&
    (templateId === undefined || isString(templateId))
  );
}

/** What the belief was told before a log began: nothing, unless a rebase carried it there. */
export function toldBefore(pending: { readonly [key: string]: unknown }): Told[] {
  const carried = pending[TOLD_BEFORE];
  return Array.isArray(carried) ? carried.filter(isTold) : [];
}
