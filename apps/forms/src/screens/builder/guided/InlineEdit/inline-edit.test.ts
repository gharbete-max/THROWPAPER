import { describe, expect, it } from 'vitest';
import {
  BUILDER_GRAPH,
  answer,
  back,
  begin,
  edit,
  jsonEqual,
  opProblem,
  type Answer,
  type Conversation,
} from '@tp/shared/builder';
import { CHOICE_ACCENTS, emptyDefinition, type Field } from '@tp/shared/forms';
import {
  INLINE_SHAPES,
  accentOps,
  currentShape,
  editableChoice,
  moveOptionOps,
  renameOps,
  renameOptionOps,
  shapeOps,
  shapesFor,
  sizeOps,
} from './inline-edit.js';

/**
 * Inline editing — `CAVEATS.md` #55 (`tap-target-floor`): every handle snaps to a value the form
 * schema has, so no gesture can make a choice smaller than 44px or paint it a free colour. Each
 * gesture is run through the real machine (`edit`), which refuses anything `WRITABLE` does not
 * allow and any draft the schema would not store exactly.
 */

const G = BUILDER_GRAPH;
const locale = 'sv-SE';

/** Four pill buttons, as the buttons chain makes them. */
function aChoice(): { c: Conversation; field: () => Field } {
  const c = (
    [
      { kind: 'option', optionId: 'signup' },
      { kind: 'option', optionId: 'later' },
      { kind: 'text', value: 'Vilken dag?' },
      { kind: 'option', optionId: 'yes' },
      { kind: 'option', optionId: 'yes' },
      { kind: 'option', optionId: 'one' },
      { kind: 'quantity', value: 4 },
      { kind: 'option', optionId: 'pill' },
    ] as Answer[]
  ).reduce(
    (d, given) => answer(G, d, given, { locale }),
    begin(G, { definition: emptyDefinition, title: {}, pending: { brandKitExists: false } }),
  );
  const id = c.state.focus!;
  return { c, field: () => c.state.draft.definition.fields.find((f) => f.id === id)! };
}

const choiceOf = (c: Conversation) => {
  const field = c.state.draft.definition.fields.find((f) => f.id === c.state.focus);
  if (!editableChoice(field) || field.type !== 'single_select') throw new Error('not a choice');
  return field;
};

describe('every gesture', () => {
  it('writes only what the conversation may write, and the machine takes it', () => {
    const { c } = aChoice();
    const field = choiceOf(c);
    const gestures = [
      ...shapesFor(field).map((shape) => shapeOps(field, shape)),
      sizeOps(field, 1)!,
      ...CHOICE_ACCENTS.map((role) => accentOps(field, role)),
      renameOps(field, locale, 'Vilken dag passar?')!,
      renameOptionOps(field, field.options[0]!.value, locale, 'Lördag')!,
      moveOptionOps(field, field.options[0]!.value, 2)!,
    ];
    for (const ops of gestures) {
      for (const op of ops) expect(opProblem(op)).toBeNull();
      const after = edit(c, ops, { locale });
      // A step like any answer: Back is exactly where it was.
      expect(jsonEqual(back(after), c)).toBe(true);
    }
  });
});

describe('the handles snap', () => {
  it('size steps up to large, and no further; down to regular, and no further', () => {
    const { c } = aChoice();
    expect(sizeOps(choiceOf(c), -1)).toBeNull();
    const large = edit(c, sizeOps(choiceOf(c), 1)!, { locale });
    expect(choiceOf(large).style?.size).toBe('large');
    expect(sizeOps(choiceOf(large), 1)).toBeNull();
  });

  it('colour is a brand role, never a colour', () => {
    const { c } = aChoice();
    for (const role of CHOICE_ACCENTS) {
      const [op] = accentOps(choiceOf(c), role);
      expect(op).toMatchObject({ value: role });
    }
    // The schema refuses anything else, so a handle could not write one if it tried.
    expect(
      opProblem({
        op: 'set',
        path: 'draft.definition.fields[focus].style.accent',
        value: '#ff0000',
      }),
    ).not.toBeNull();
  });

  it('the shape is one of the named shapes; the tile is the cards look', () => {
    const { c } = aChoice();
    expect(currentShape(choiceOf(c))).toBe('pill');
    const tiled = edit(c, shapeOps(choiceOf(c), 'tile'), { locale });
    expect(choiceOf(tiled).appearance).toBe('cards');
    expect(currentShape(choiceOf(tiled))).toBe('tile');
    const tabs = edit(tiled, shapeOps(choiceOf(tiled), 'tab'), { locale });
    expect(choiceOf(tabs)).toMatchObject({ appearance: 'buttons', style: { shape: 'tab' } });
    expect(INLINE_SHAPES).toEqual(['pill', 'rounded', 'square', 'tab', 'segmented', 'tile']);
  });
});

describe('words', () => {
  it('rename in the language being written, and leave every other language alone', () => {
    const { c } = aChoice();
    const field = choiceOf(c);
    const both = edit(
      c,
      [
        {
          op: 'set',
          path: `draft.definition.fields[id=${field.id}].label`,
          value: { 'sv-SE': 'Vilken dag?', 'en-GB': 'Which day?' },
        },
      ],
      { locale },
    );
    const renamed = edit(both, renameOps(choiceOf(both), locale, '  Vilken dag passar?  ')!, {
      locale,
    });
    expect(choiceOf(renamed).label).toEqual({
      'sv-SE': 'Vilken dag passar?',
      'en-GB': 'Which day?',
    });
  });

  it('are not changed by nothing: empty words or the same words are no step at all', () => {
    const { c } = aChoice();
    const field = choiceOf(c);
    expect(renameOps(field, locale, '   ')).toBeNull();
    expect(renameOps(field, locale, 'Vilken dag?')).toBeNull();
    expect(renameOptionOps(field, field.options[0]!.value, locale, '')).toBeNull();
  });

  it('an answer renamed keeps its value, which responses already point at', () => {
    const { c } = aChoice();
    const field = choiceOf(c);
    const [first] = field.options;
    const after = edit(c, renameOptionOps(field, first!.value, locale, 'Lördag')!, { locale });
    expect(choiceOf(after).options[0]).toEqual({
      ...first,
      label: { ...first!.label, [locale]: 'Lördag' },
    });
  });
});

describe('moving an answer', () => {
  it('moves it, keeps every answer, and refuses a place that is not there', () => {
    const { c } = aChoice();
    const field = choiceOf(c);
    const values = field.options.map((o) => o.value);
    const after = edit(c, moveOptionOps(field, values[0]!, 3)!, { locale });
    expect(choiceOf(after).options.map((o) => o.value)).toEqual([
      values[1],
      values[2],
      values[3],
      values[0],
    ]);
    expect(moveOptionOps(field, values[0]!, 4)).toBeNull();
    expect(moveOptionOps(field, values[0]!, -1)).toBeNull();
    expect(moveOptionOps(field, values[0]!, 0)).toBeNull();
  });
});
