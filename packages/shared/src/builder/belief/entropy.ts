import { expMicro } from '../../interpret/exp.js';
import type { BuilderGraph, Node } from '../graph/schema.js';
import {
  entropy,
  GUESS_AT_MILLE,
  guessOf,
  logLikelihoods,
  probabilities,
  scoredOptions,
  weigh,
  type Belief,
  type BeliefState,
} from './update.js';

/**
 * Which guess question next — `docs/plan/BELIEF.md`, "Which question next": the one expected to
 * shrink the belief's entropy most, in integers. `next: { best, else }` in the graph asks it; the
 * machine records where it went, so replay needs none of this.
 */

/** At most this many questions of the group are asked: a guess, not an interrogation. */
export const MAX_ASKED = 5;
/** A question expected to tell less than this, in millinats of entropy, is not worth asking. */
export const MIN_GAIN = 50;
/** After this many "Not sure", the person may know no more: the guess stops asking. */
export const MAX_UNSURE = 2;

const MILLION = 1_000_000;

/**
 * The entropy a question is expected to take away: now, less the entropy after each scored option
 * weighted by how likely the person is to choose it, `P(o) = Σ p(r) × P(o | r)`.
 */
export function expectedGain(belief: Belief, node: Node): number {
  const options = scoredOptions(node);
  if (options.length === 0 || belief.length <= 1) return 0;
  const ppm = probabilities(belief);
  let weights = 0;
  let expected = 0;
  for (const option of options) {
    const logs = logLikelihoods(node, option.id)!;
    // P(o) in parts per million: Σ p(r) × e^(log P(o | r)).
    const chance = ppm.reduce(
      (total, share) => total + share.millinats * expMicro(Math.max(0, -(logs.get(share.id) ?? 0))),
      0,
    );
    const p = Math.floor((chance + MILLION / 2) / MILLION);
    weights += p;
    expected += p * entropy(weigh(belief, logs));
  }
  if (weights === 0) return 0;
  return entropy(belief) - Math.floor((2 * expected + weights) / (2 * weights));
}

/**
 * The question of `group` to ask next, or null to go on: null once the guess is confirmed, when a
 * recipe that may be guessed is at the threshold, after `MAX_ASKED` of the group's questions or
 * `MAX_UNSURE` of them answered "Not sure", or when none left would tell `MIN_GAIN`. `asked` are the nodes already answered; `askable` says
 * whether a node's `when` holds. Ties go to the question first in the graph.
 */
export function bestQuestion(
  graph: BuilderGraph,
  state: BeliefState,
  group: string,
  asked: readonly string[],
  askable: (node: Node) => boolean,
): string | null {
  if (state.confirmed !== null) return null;
  const guess = guessOf(state);
  if (guess !== null && guess.pMille >= GUESS_AT_MILLE) return null;
  const members = graph.nodes.filter(
    (node) => node.group === group && scoredOptions(node).length > 0,
  );
  const answered = members.filter((node) => asked.includes(node.id)).length;
  if (answered >= MAX_ASKED) return null;
  const unsure = members.filter((node) => state.unsure.includes(node.id)).length;
  if (unsure >= MAX_UNSURE) return null;
  let best: { id: string; gain: number } | null = null;
  for (const node of members) {
    if (asked.includes(node.id) || !askable(node)) continue;
    const gain = expectedGain(state.belief, node);
    if (best === null || gain > best.gain) best = { id: node.id, gain };
  }
  return best !== null && best.gain >= MIN_GAIN ? best.id : null;
}
