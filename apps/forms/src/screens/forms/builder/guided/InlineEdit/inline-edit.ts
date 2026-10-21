import type { Json, Op } from '@tp/shared/builder';
import { CHOICE_ACCENTS, CHOICE_SIZES, ChoiceStyle, type Field } from '@tp/shared/forms';

/**
 * Inline editing on the preview — `PREDICTIVE-BUILDER.md`, "The preview contract" — as a function
 * from a gesture to the patch it writes. The screen calls `edit()` with what this returns, so
 * every gesture is a step in the conversation's log, as undoable as an answer.
 *
 * **Snapping** (`CAVEATS.md` #55): a handle can only land on a value the form schema has. Sizes step
 * through `CHOICE_SIZES` and stop at both ends — there is no size under the 44px target to step
 * to; the colour is one of the brand's three roles, never a colour; the shape is one of the named
 * shapes. Nothing here can produce a pixel, a radius or a hex.
 */

type Choice = Extract<Field, { type: 'single_select' | 'multi_select' | 'yes_no' }>;
type Option = Extract<Field, { type: 'single_select' }>['options'][number];

/** The shapes the preview offers: the schema's named shapes, and the tile (the cards look). */
export const INLINE_SHAPES = ['pill', 'rounded', 'square', 'tab', 'segmented', 'tile'] as const;
export type InlineShape = (typeof INLINE_SHAPES)[number];

const at = (field: Field, property: string) =>
  `draft.definition.fields[id=${field.id}].${property}`;

/** A choice whose look can be edited on the preview: drawn as buttons or cards, not a dropdown. */
export function editableChoice(field: Field | null | undefined): field is Choice {
  return (
    !!field &&
    (field.type === 'single_select' || field.type === 'multi_select' || field.type === 'yes_no') &&
    (field.appearance === 'buttons' || field.appearance === 'cards')
  );
}

/** Which shapes a question can take: a yes/no question has no cards look. */
export function shapesFor(field: Choice): readonly InlineShape[] {
  return field.type === 'yes_no' ? INLINE_SHAPES.filter((s) => s !== 'tile') : INLINE_SHAPES;
}

/** The shape a question shows now, as the preview names it. */
export function currentShape(field: Choice): InlineShape | null {
  if (field.appearance === 'cards') return 'tile';
  const shape = field.style?.shape ?? 'theme';
  return shape === 'theme' ? null : shape;
}

export function shapeOps(field: Choice, shape: InlineShape): Op[] {
  if (shape === 'tile') return [{ op: 'set', path: at(field, 'appearance'), value: 'cards' }];
  return [
    ...(field.appearance === 'buttons'
      ? []
      : [{ op: 'set', path: at(field, 'appearance'), value: 'buttons' } as Op]),
    { op: 'set', path: at(field, 'style.shape'), value: shape },
  ];
}

/**
 * One step of the size handle, snapped: from `regular` down is nowhere, from `large` up is nowhere
 * — `null`, and the handle does not move.
 */
export function sizeOps(field: Choice, by: -1 | 1): Op[] | null {
  const size = ChoiceStyle.parse(field.style ?? {}).size;
  const next = CHOICE_SIZES[CHOICE_SIZES.indexOf(size) + by];
  return next ? [{ op: 'set', path: at(field, 'style.size'), value: next }] : null;
}

/** A swatch: one of the brand's roles, whose derived edge is held to 3:1 (`locked.test.ts`). */
export function accentOps(field: Choice, role: (typeof CHOICE_ACCENTS)[number]): Op[] {
  return [{ op: 'set', path: at(field, 'style.accent'), value: role }];
}

/**
 * The question's words, in the language being written. The other languages stay exactly as they
 * were — renaming the Swedish never touches the English. Empty words are not a rename.
 */
export function renameOps(field: Field, locale: string, text: string): Op[] | null {
  if (!('label' in field)) return null;
  const words = text.trim();
  if (words === '' || field.label[locale] === words) return null;
  return [{ op: 'set', path: at(field, 'label'), value: { ...field.label, [locale]: words } }];
}

/** One answer's words, in the language being written; its value, and every other, unchanged. */
export function renameOptionOps(
  field: Choice,
  value: string,
  locale: string,
  text: string,
): Op[] | null {
  if (field.type === 'yes_no') return null;
  const words = text.trim();
  const option = field.options.find((o) => o.value === value);
  if (!option || words === '' || option.label[locale] === words) return null;
  const options = field.options.map((o): Option =>
    o.value === value ? { ...o, label: { ...o.label, [locale]: words } } : o,
  );
  return [{ op: 'set', path: at(field, 'options'), value: options as unknown as Json }];
}

/** An answer moved to a new place — by drag, or by its Move up / Move down twin. */
export function moveOptionOps(field: Choice, value: string, to: number): Op[] | null {
  if (field.type === 'yes_no') return null;
  const from = field.options.findIndex((o) => o.value === value);
  if (from < 0 || to < 0 || to >= field.options.length || to === from) return null;
  const options = [...field.options];
  const [moved] = options.splice(from, 1);
  options.splice(to, 0, moved!);
  return [{ op: 'set', path: at(field, 'options'), value: options as unknown as Json }];
}
