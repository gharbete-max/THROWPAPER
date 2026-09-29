import { z } from 'zod';
import table from './recipes.json';
import { STRUCTURES, type Structure } from './structures.js';

/**
 * What the engine can guess — `docs/plan/BELIEF.md`, "Recipes": every template in the catalogue,
 * and the two structure-only recipes rule 8 keeps out of it. `recipes.json` holds their priors and
 * a template's name, which the guess says ("This looks like Proxy form. Right?") whether or not the
 * catalogue could be loaded; the questions stay in the templates (brief §6).
 *
 * The catalogue itself is not imported here: the screen already has it from the API, as the gallery
 * does, and hands the one template "Right" adds to the machine (`AnswerContext.templates`). So the
 * guided builder does not carry every template in every language. `belief.test.ts` holds
 * `recipes.json` to the catalogue: a recipe for every template, none for anything else, and each
 * name the template's own, in every language.
 */

const RecipesSchema = z
  .object({
    source: z.string().min(1),
    recipesVersion: z.literal(1),
    recipes: z
      .array(
        z
          .object({
            id: z.string().regex(/^[a-z][a-z0-9-]*$/),
            prior: z.number().int(),
            /** A template's name, as the catalogue has it; a structure names itself. */
            name: z.record(z.string().min(1)).optional(),
            structureOnly: z.literal(true).optional(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

export interface Recipe {
  readonly id: string;
  /** Millinats, before any answer. */
  readonly prior: number;
  /** What the guess calls it, by locale. */
  readonly name: Readonly<Record<string, string>>;
  /** Rule 8: what "Right" adds is this structure, never its wording. Null for a template. */
  readonly structure: Structure | null;
}

function load(): readonly Recipe[] {
  const { recipes } = RecipesSchema.parse(table);
  const ids = recipes.map((recipe) => recipe.id);
  if (new Set(ids).size !== ids.length) throw new Error('recipes.json names a recipe twice');
  return recipes.map((recipe) => {
    const structure =
      recipe.structureOnly === true
        ? (STRUCTURES.find((candidate) => candidate.id === recipe.id) ?? null)
        : null;
    if (recipe.structureOnly === true && !structure) {
      throw new Error(`recipes.json: ${recipe.id} is no structure`);
    }
    const name = structure?.name ?? recipe.name;
    if (!name || (structure && recipe.name)) {
      throw new Error(
        `recipes.json: ${recipe.id} needs a name, from its template or its structure`,
      );
    }
    return { id: recipe.id, prior: recipe.prior, name, structure };
  });
}

/** In the order of `recipes.json`, which is the order every belief keeps. */
export const RECIPES: readonly Recipe[] = load();

export const RECIPE_IDS: readonly string[] = RECIPES.map((recipe) => recipe.id);

export function recipeOf(id: string): Recipe | null {
  return RECIPES.find((recipe) => recipe.id === id) ?? null;
}
