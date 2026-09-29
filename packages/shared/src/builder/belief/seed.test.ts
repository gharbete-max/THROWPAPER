import { describe, expect, it } from 'vitest';
import { emptyDefinition, FormDefinition } from '../../forms/definition.js';
import { definitionProblems } from '../../forms/helpers.js';
import { regulatedWordsIn } from '../../forms/wording.js';
import { applyAll, jsonEqual } from '../changes.js';
import { BUILDER_GRAPH } from '../graph/nodes.js';
import type { BuilderGraph, Node } from '../graph/schema.js';
import { answer, back, begin, edit, replay, type Conversation } from '../machine.js';
import { changedByHand } from '../reconcile.js';
import type { BuilderState } from '../state.js';
import { FORM_TEMPLATES } from '../../forms/templates.js';
import { RECIPES, recipeOf } from './recipes.js';
import { seedChanges, type SeedSource } from './seed.js';

/**
 * What "Right" adds — `docs/plan/BELIEF.md`: the recipe's questions, as the conversation's own, in
 * one step Back undoes; and for the two recipes rule 8 keeps out of the catalogue, structure and a
 * bracketed placeholder only.
 */

const G = BUILDER_GRAPH as unknown as BuilderGraph;
const locale = 'en-GB';
/** The catalogue, as the screen hands it to the machine for "Right". */
const templates: readonly SeedSource[] = FORM_TEMPLATES;
const sourceOf = (id: string): SeedSource =>
  recipeOf(id)?.structure ?? FORM_TEMPLATES.find((template) => template.id === id)!;
const node = (id: string): Node => G.nodes.find((candidate) => candidate.id === id)!;
const opts = (n: Node) =>
  'options' in n ? (n.options as readonly { id: string; score?: Record<string, number> }[]) : [];
const fresh = () =>
  begin(G, {
    definition: emptyDefinition,
    title: {},
    pending: { brandKitExists: false, canChangeBrand: false },
  });

/** To the guess, answering as a person building `recipe` would. */
function toGuess(recipe: string): Conversation {
  let c = answer(G, fresh(), { kind: 'option', optionId: 'collect' }, { locale });
  for (;;) {
    const at = node(c.state.cursor);
    if (at.group !== 'guess' || at.kind !== 'question') return c;
    const yes = opts(at).find((o) => o.id === 'yes')!.score?.[recipe];
    const no = opts(at).find((o) => o.id === 'no')!.score?.[recipe];
    c = answer(G, c, { kind: 'option', optionId: yes ? 'yes' : no ? 'no' : 'unsure' }, { locale });
  }
}

const right = (c: Conversation) =>
  answer(
    G,
    c,
    { kind: 'guess', verdict: 'right', templateId: c.state.guess!.templateId },
    { locale, templates },
  );

describe('"Right"', () => {
  const before = toGuess('job-application');
  const after = right(before);
  const template = sourceOf('job-application');
  const fields = after.state.draft.definition.fields;

  it('adds the recipe’s questions, in its order, in place of the conversation’s starter', () => {
    expect(before.state.cursor).toBe('guess.confirm');
    expect(before.state.draft.definition.fields.map((f) => f.key)).toEqual(['name']);
    // The template asks for a full name of its own: one name question, not two.
    expect(fields.map((f) => f.key)).toEqual(template.definition.fields.map((f) => f.key));
  });

  it('gives every question a new id, never a template’s own or one the form used', () => {
    const ids = fields.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(/^q-/);
      expect(before.state.sidecar.retiredIds).not.toContain(id);
      expect(after.state.sidecar.retiredIds).toContain(id);
    }
  });

  it('makes each the conversation’s: a baseline recorded, so none reads as changed by hand', () => {
    for (const field of fields) {
      expect(after.state.sidecar.fields[field.id]).toMatchObject({
        source: 'guided',
        nodeId: 'guess.confirm',
      });
      expect(jsonEqual(after.state.sidecar.fields[field.id]?.guided, field)).toBe(true);
      expect(changedByHand(after.state, field.id)).toBe(false);
    }
  });

  it('leaves a form that can be published, is one step Back undoes, and replays', () => {
    expect(definitionProblems(after.state.draft.definition)).toEqual([]);
    expect(after.log).toHaveLength(before.log.length + 1);
    expect(jsonEqual(back(after), before)).toBe(true);
    expect(jsonEqual(replay(after.base, after.log), after.state)).toBe(true);
  });

  it('shows what it added, then goes on with only the gaps: the brand, then "Add another?"', () => {
    expect(after.state.pending['seeded']).toBe('job-application');
    expect(after.state.cursor).toBe('guess.seeded');
    let c = answer(G, after, { kind: 'continue' }, { locale });
    expect(c.state.cursor).toBe('brand.start');
    c = answer(G, c, { kind: 'option', optionId: 'later' }, { locale });
    expect(c.state.cursor).toBe('flow.more');
  });

  it('needs the template it adds: without the catalogue, it is refused and nothing changes', () => {
    expect(() =>
      answer(
        G,
        before,
        { kind: 'guess', verdict: 'right', templateId: 'job-application' },
        { locale },
      ),
    ).toThrow(/the template to add was not given/);
  });

  it('is refused for a recipe that is not the guess', () => {
    expect(() =>
      answer(G, before, { kind: 'guess', verdict: 'right', templateId: 'rsvp' }, { locale }),
    ).toThrow(/not the guess/);
  });
});

describe('the conversation’s starter question', () => {
  it('gives way to a recipe that asks its own questions, and Back brings it back', () => {
    const before = toGuess('meeting-proxy');
    const [starter] = before.state.draft.definition.fields;
    expect(starter?.key).toBe('name');
    const after = right(before);
    const fields = after.state.draft.definition.fields;
    expect(fields.map((f) => f.id)).not.toContain(starter!.id);
    expect(fields.map((f) => f.key)).toEqual(
      sourceOf('meeting-proxy').definition.fields.map((f) => f.key),
    );
    expect(after.state.sidecar.fields[starter!.id]).toBeUndefined();
    // Its id stays retired: never handed out again.
    expect(after.state.sidecar.retiredIds).toContain(starter!.id);
    expect(jsonEqual(back(after), before)).toBe(true);
  });

  it('stays when a person has changed it: its words are theirs', () => {
    let c = toGuess('meeting-proxy');
    const [starter] = c.state.draft.definition.fields;
    c = edit(
      c,
      [
        {
          op: 'set',
          path: `draft.definition.fields[id=${starter!.id}].label`,
          value: { 'en-GB': 'Your full name' },
        },
      ],
      { locale },
    );
    const after = right(c);
    expect(after.state.draft.definition.fields[0]).toMatchObject({
      id: starter!.id,
      label: { 'en-GB': 'Your full name' },
    });
  });
});

describe('the starter and a recipe that asks the same thing', () => {
  it('keeps the starter, and does not add the recipe’s copy of it', () => {
    const before = toGuess('consent-form');
    expect(before.state.guess?.templateId).toBe('consent-form');
    const after = right(before);
    const keys = after.state.draft.definition.fields.map((f) => f.key);
    expect(keys.filter((key) => key === 'name')).toHaveLength(1);
    expect(after.state.draft.definition.fields[0]).toEqual(before.state.draft.definition.fields[0]);
  });
});

describe('seeding each recipe', () => {
  const start = fresh().state;
  const seeded = (recipe: (typeof RECIPES)[number]): BuilderState =>
    applyAll(start, seedChanges(start, sourceOf(recipe.id), 'guess.confirm')) as BuilderState;

  it.each(RECIPES.map((recipe) => [recipe.id, recipe] as const))(
    '%s gives a form the schema takes, with unique ids and keys',
    (_id, recipe) => {
      const state = seeded(recipe);
      const definition = state.draft.definition;
      expect(() => FormDefinition.parse(definition)).not.toThrow();
      const ids = definition.fields.flatMap((field) =>
        field.type === 'repeating_group'
          ? [field.id, ...field.fields.map((f) => f.id)]
          : [field.id],
      );
      expect(new Set(ids).size).toBe(ids.length);
      const keys = definition.fields.map((field) => field.key);
      expect(new Set(keys).size).toBe(keys.length);
      expect(definition.fields).toHaveLength(sourceOf(recipe.id).definition.fields.length);
    },
  );

  it.each(
    RECIPES.filter((recipe) => recipe.structure).map((recipe) => [recipe.id, recipe] as const),
  )(
    '%s adds structure and a bracketed placeholder, never its wording, in any language',
    (_id, recipe) => {
      const added = seeded(recipe).draft.definition.fields;
      expect(regulatedWordsIn(JSON.stringify(added))).toEqual([]);
      const blocks = added.filter((field) => field.type === 'rich_text');
      expect(blocks).toHaveLength(1);
      for (const text of Object.values(blocks[0]!.type === 'rich_text' ? blocks[0]!.content : {})) {
        expect(text).toMatch(/^[[［].*[\]］]$/su);
      }
    },
  );
});
