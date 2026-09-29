import type { Field, FormDefinition } from '../../forms/definition.js';
import type { Change } from '../changes.js';
import type { Json } from '../graph/schema.js';
import { fingerprint, stableFieldId } from '../ids.js';
import { changedByHand } from '../reconcile.js';
import type { BuilderState, FieldProvenance } from '../state.js';

/** What "Right" adds from: a template of the catalogue, or a structure-only recipe. */
export interface SeedSource {
  readonly id: string;
  readonly definition: FormDefinition;
}

/**
 * What "Right" adds — `docs/plan/BELIEF.md`, "What "Right" adds": the recipe's questions, copied
 * whole in every language (as the gallery copies a template), appended in the template's order.
 *
 * - **New ids**, fingerprints of the recipe and the question's place, never one the form used —
 *   inner questions of a group too — so an old answer cannot attach to one (`CAVEATS.md` #49).
 * - **The recipe's questions replace the conversation's starter.** "What is this form for?" adds a
 *   question at once, so the form is publishable from the first answer; the recipe has its own. A
 *   starter nobody has changed gives way to them — unless the recipe asks the same thing (its
 *   key), when the starter stays and the recipe's copy is not added. A starter changed by hand
 *   always stays: its words are the person's.
 * - **Every other question of the draft stays**, and a question whose key the draft has is not
 *   added twice.
 * - **Each is the conversation's** (`source: 'guided'`, from `guess.confirm`): the machine records
 *   its baseline as it does any question a step makes, so a hand edit is seen as one.
 *
 * `pending.seeded` names the recipe, which is what the graph reads to go on with only the gaps.
 */

function idsOf(fields: readonly Field[]): string[] {
  return fields.flatMap((field) =>
    field.type === 'repeating_group' ? [field.id, ...field.fields.map((f) => f.id)] : [field.id],
  );
}

export function seedChanges(state: BuilderState, recipe: SeedSource, nodeId: string): Change[] {
  const all = state.draft.definition.fields;
  const theirs = new Set(recipe.definition.fields.map((field) => field.key));
  const superseded = all.filter(
    (field) =>
      state.sidecar.fields[field.id]?.nodeId === 'flow.start' &&
      state.sidecar.fields[field.id]?.proposal === undefined &&
      !changedByHand(state, field.id) &&
      !theirs.has(field.key),
  );
  const existing = all.filter((field) => !superseded.includes(field));
  const used = new Set([...idsOf(all), ...state.sidecar.retiredIds]);
  const keys = new Set(existing.map((field) => field.key));
  const list = ['draft', 'definition', 'fields'] as const;
  const changes: Change[] = [];
  const added: string[] = [];
  for (const field of superseded) {
    changes.push({ op: 'remove', at: [...list, { id: field.id }] });
    changes.push({ op: 'unset', at: ['sidecar', 'fields', field.id] });
  }
  let after = existing.at(-1)?.id ?? null;
  let section = existing.findLast((field) => field.type === 'section_break')?.id ?? '';
  let ordinal = existing.length;

  const newId = (seed: string) => {
    ordinal += 1;
    const id = stableFieldId(fingerprint(`${recipe.id}|${seed}`, ordinal, section), used);
    used.add(id);
    added.push(id);
    return id;
  };

  for (const template of recipe.definition.fields) {
    if (keys.has(template.key)) continue;
    const id = newId(template.id);
    // A copy, so nothing the form does can reach the shipped catalogue.
    const copy = structuredClone(template) as Field & { id: string };
    copy.id = id;
    if (copy.type === 'repeating_group') {
      copy.fields = copy.fields.map((inner) => ({
        ...inner,
        id: newId(`${template.id}.${inner.id}`),
      }));
    }
    keys.add(copy.key);
    if (copy.type === 'section_break') section = id;
    const provenance: FieldProvenance = { source: 'guided', nodeId };
    changes.push({
      op: 'insert',
      at: list,
      value: copy as unknown as Json,
      after: after === null ? null : { id: after },
    });
    changes.push({
      op: 'set',
      at: ['sidecar', 'fields', id],
      value: provenance as unknown as Json,
    });
    after = id;
  }
  changes.push({
    op: 'set',
    at: ['sidecar', 'retiredIds'],
    value: [...state.sidecar.retiredIds, ...added],
  });
  changes.push({ op: 'set', at: ['pending', 'seeded'], value: recipe.id });
  return changes;
}
