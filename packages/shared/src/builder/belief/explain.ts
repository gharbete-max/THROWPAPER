import type { BuilderGraph } from '../graph/schema.js';
import { logLikelihoods, type Told } from './update.js';

/**
 * "Why this guess" — `docs/plan/BELIEF.md`, "The guess": the three answers that moved it most. An
 * answer moved a recipe by how much more likely it made it than the others on average: `log
 * P(option | guess)` less the mean of `log P(option | r)` over every other recipe. Only answers
 * that favoured it are listed, largest first, ties to the later answer. Never hidden: the screen
 * shows it one press from the guess.
 */

export interface Reason {
  /** The node answered, and the option chosen: the trail's words for it. */
  readonly nodeId: string;
  readonly optionId: string;
  /** How far it moved the guess ahead of the rest, in millinats. */
  readonly millinats: number;
}

export function whyGuess(graph: BuilderGraph, log: readonly Told[], templateId: string): Reason[] {
  const reasons: (Reason & { readonly at: number })[] = [];
  log.forEach((entry, at) => {
    const { answer } = entry;
    const chosen =
      answer.kind === 'option' && answer.optionId !== undefined
        ? [answer.optionId]
        : answer.kind === 'options'
          ? (answer.optionIds ?? [])
          : [];
    const node = graph.nodes.find((candidate) => candidate.id === entry.nodeId);
    if (!node) return;
    for (const optionId of chosen) {
      const logs = logLikelihoods(node, optionId);
      const mine = logs?.get(templateId);
      if (!logs || mine === undefined) continue;
      const others = [...logs].filter(([id]) => id !== templateId).map(([, value]) => value);
      const sum = others.reduce((total, value) => total + value, 0);
      // The mean, rounded half up, in whole millinats.
      const mean = Math.floor((2 * sum + others.length) / (2 * others.length));
      const millinats = mine - mean;
      if (millinats > 0) reasons.push({ nodeId: node.id, optionId, millinats, at });
    }
  });
  return reasons
    .sort((a, b) => b.millinats - a.millinats || b.at - a.at)
    .slice(0, 3)
    .map(({ nodeId, optionId, millinats }) => ({ nodeId, optionId, millinats }));
}
