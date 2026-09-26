import type { z } from 'zod';
import { Field, type FieldType, type SelectOption } from '../forms/definition.js';
import { V } from '../forms/vocabulary.js';
import type { Json } from './graph/schema.js';

/**
 * Questions the conversation makes, and what happens to one when its type changes.
 *
 * The draft must be a form the schema accepts after **every** answer — publishable from the first
 * one (`PREDICTIVE-BUILDER.md`, "The conversation"). An option that says "one answer only" writes
 * `type: 'single_select'` into a question that was typed text a moment ago and has no options, so
 * a type is never written as a bare value: it becomes the whole question, rebuilt as the new type.
 */

/**
 * The types the conversation can make, or turn a question into, from a label alone: every type
 * that collects one answer. The others need something only a person can give — a picture, a link,
 * the text of a note, the questions inside a repeating block — or collect nothing at all.
 * `WRITABLE` (graph/paths.ts) takes its list of writable types from here, so the graph cannot ask
 * for one the machine cannot build (rule G5).
 */
export const QUESTION_TYPES = [
  'short_text',
  'long_text',
  'number',
  'email',
  'phone',
  'date',
  'time',
  'single_select',
  'multi_select',
  'yes_no',
  'rating',
  'file',
  'signature',
] as const satisfies readonly FieldType[];
export type QuestionType = (typeof QUESTION_TYPES)[number];

type Option = z.infer<typeof SelectOption>;

/** How many options a question has when it becomes a choice before anyone has said how many. */
export const DEFAULT_OPTION_COUNT = 2;

const CHOICES: ReadonlySet<FieldType> = new Set(['single_select', 'multi_select']);

/** "Option 3" in every language the vocabulary carries. */
function placeholderLabel(position: number): Record<string, string> {
  return Object.fromEntries(
    Object.entries(V.option).map(([locale, word]) => [locale, `${word} ${position}`]),
  );
}

/**
 * The options, resized to `count`: the ones there are kept, in order, and placeholders added after
 * them ("Option 3", …) with values no other option has. Shrinking drops from the end — the person
 * asked for fewer — and Back brings them back.
 */
export function resizeOptions(current: readonly Option[] | undefined, count: number): Option[] {
  const kept = (current ?? []).slice(0, count);
  const used = new Set(kept.map((option) => option.value));
  const options = [...kept];
  let serial = 1;
  while (options.length < count) {
    while (used.has(`option_${serial}`)) serial += 1;
    const value = `option_${serial}`;
    used.add(value);
    options.push({ value, label: placeholderLabel(options.length + 1), image: null });
  }
  return options;
}

/** The schema of one field type, the variant of the `Field` union with that `type`. */
export function variantOf(type: FieldType) {
  const variant = Field.options.find((option) => option.shape.type.value === type);
  if (!variant) throw new Error(`no field variant for ${type}`);
  return variant;
}

/**
 * A new question as the schema would store it — defaults filled — so the draft holds exactly what
 * a save and a load would give back, and replay compares equal to it.
 */
export function newQuestion(input: {
  id: string;
  key: string;
  type: QuestionType;
  label: Record<string, string>;
  required: boolean;
}): Field {
  return Field.parse({
    id: input.id,
    key: input.key,
    type: input.type,
    label: input.label,
    required: input.required,
    ...(CHOICES.has(input.type) ? { options: resizeOptions([], DEFAULT_OPTION_COUNT) } : {}),
  });
}

/**
 * The question as the new type: everything the new type can hold is kept (id, key, label, help,
 * required, width, and whatever else is valid there), and what it cannot hold is set aside, not
 * thrown away. Something set aside by an earlier change comes back when the type can hold it again
 * — options written for a choice survive a detour through "people type an answer".
 */
export function retype(
  field: Field,
  type: QuestionType,
  setAside: { readonly [property: string]: Json },
): { field: Field; setAside: { [property: string]: Json } } {
  if (field.type === type) return { field, setAside: { ...setAside } };
  const shape: Record<string, z.ZodTypeAny> = variantOf(type).shape;
  const fits = (property: string, value: unknown) =>
    property !== 'type' && shape[property]?.safeParse(value).success === true;

  const kept: Record<string, unknown> = {};
  const aside: { [property: string]: Json } = {};
  for (const [property, value] of Object.entries(field)) {
    if (property === 'type') continue;
    if (fits(property, value)) kept[property] = value;
    else aside[property] = value as Json;
  }
  for (const [property, value] of Object.entries(setAside)) {
    if (property in kept) continue;
    if (fits(property, value)) kept[property] = value;
    else if (!(property in aside)) aside[property] = value;
  }
  if (CHOICES.has(type) && kept['options'] === undefined) {
    kept['options'] = resizeOptions([], DEFAULT_OPTION_COUNT);
  }
  return { field: Field.parse({ ...kept, type }), setAside: aside };
}
