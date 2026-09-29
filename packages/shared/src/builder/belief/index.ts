/**
 * The belief engine — `docs/plan/BELIEF.md` (S11): what it can guess, what an answer says, which
 * question next, the guess, and what "Right" adds.
 */
export { RECIPES, RECIPE_IDS, recipeOf, type Recipe } from './recipes.js';
export { STRUCTURES, type Structure } from './structures.js';
export {
  beliefOf,
  entropy,
  GUESS_AT_MILLE,
  guessOf,
  logLikelihoods,
  logSumExp,
  perMille,
  probabilities,
  scoredOptions,
  startBelief,
  TOLD_BEFORE,
  toldBefore,
  toldParts,
  tells,
  weigh,
  type Belief,
  type BeliefState,
  type Told,
  type Weight,
} from './update.js';
export { bestQuestion, expectedGain, MAX_ASKED, MAX_UNSURE, MIN_GAIN } from './entropy.js';
export { whyGuess, type Reason } from './explain.js';
export { seedChanges, type SeedSource } from './seed.js';
