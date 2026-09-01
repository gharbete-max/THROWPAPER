import { z } from 'zod';
import { LocalisedText } from '../api/common.js';

/**
 * A form definition is a **versioned JSON document, never an HTML string** (`SPEC-forms.md` §7).
 *
 * Submissions reference the version they were filled against, so editing a form can never
 * retroactively change what somebody answered.
 *
 * The thirteen types below are exactly the v0.1 field set from `docs/START-HERE.md`. Adding to
 * this union is a scope change, not a detail — the rest of `SPEC-forms.md` §3 is a later phase.
 */
export const FIELD_TYPES = [
  'short_text',
  'long_text',
  'number',
  'email',
  'phone',
  'date',
  'single_select',
  'multi_select',
  'yes_no',
  'section_break',
  'page_break',
  'rich_text',
  'hidden',
] as const;

export const FieldType = z.enum(FIELD_TYPES);
export type FieldType = z.infer<typeof FieldType>;

/** Types that display something but never collect an answer. */
export const PRESENTATIONAL_TYPES = ['section_break', 'page_break', 'rich_text'] as const;

/** Stable machine name for a field. Submission data is keyed by this, not by the label. */
export const FieldKey = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_]*$/, 'Use lower case, digits and underscores, starting with a letter');

const base = {
  id: z.string().min(1).max(64),
  key: FieldKey,
  label: LocalisedText,
  helpText: LocalisedText.optional(),
  placeholder: LocalisedText.optional(),
  required: z.boolean().default(false),
};

export const SelectOption = z.object({
  value: z.string().min(1).max(128),
  label: LocalisedText,
});

/**
 * How a choice field is *presented*. Presentation only — it never changes what is stored, so a
 * form can be restyled after it has been filled in without touching a single submission.
 *
 * Old definitions have no `appearance` at all. Each is defaulted rather than required, so every
 * document written before this existed still parses and still renders exactly as it did. That is
 * why `schemaVersion` stays at 1: nothing became unreadable.
 *
 * Every variant renders a real `input` underneath. Buttons and cards are restyled radios and
 * checkboxes, never divs with click handlers — otherwise the keyboard, the screen reader and the
 * browser's own validation all quietly stop working, and that is not something to retrofit.
 */
export const SINGLE_SELECT_APPEARANCES = ['dropdown', 'radio', 'buttons', 'cards'] as const;
export const MULTI_SELECT_APPEARANCES = ['checkboxes', 'buttons', 'cards'] as const;
export const YES_NO_APPEARANCES = ['dropdown', 'radio', 'buttons'] as const;

export const SingleSelectAppearance = z.enum(SINGLE_SELECT_APPEARANCES);
export type SingleSelectAppearance = z.infer<typeof SingleSelectAppearance>;
export const MultiSelectAppearance = z.enum(MULTI_SELECT_APPEARANCES);
export type MultiSelectAppearance = z.infer<typeof MultiSelectAppearance>;
export const YesNoAppearance = z.enum(YES_NO_APPEARANCES);
export type YesNoAppearance = z.infer<typeof YesNoAppearance>;

const TextRules = {
  minLength: z.number().int().nonnegative().optional(),
  maxLength: z.number().int().positive().optional(),
  /** Applied with no flags, anchored by the validator. Kept simple on purpose. */
  pattern: z.string().max(200).optional(),
};

export const Field = z.discriminatedUnion('type', [
  z.object({ ...base, type: z.literal('short_text'), ...TextRules }),
  z.object({
    ...base,
    type: z.literal('long_text'),
    ...TextRules,
    rows: z.number().int().min(2).max(20).optional(),
  }),
  z.object({
    ...base,
    type: z.literal('number'),
    min: z.number().optional(),
    max: z.number().optional(),
    /** Decimal places accepted. Money and measurements get real precision in packages/calc. */
    decimals: z.number().int().min(0).max(6).optional(),
  }),
  z.object({ ...base, type: z.literal('email') }),
  z.object({ ...base, type: z.literal('phone'), ...TextRules }),
  z.object({
    ...base,
    type: z.literal('date'),
    min: z.string().date().optional(),
    max: z.string().date().optional(),
  }),
  z.object({
    ...base,
    type: z.literal('single_select'),
    options: z.array(SelectOption).min(1),
    appearance: SingleSelectAppearance.default('dropdown'),
  }),
  z.object({
    ...base,
    type: z.literal('multi_select'),
    options: z.array(SelectOption).min(1),
    minSelected: z.number().int().nonnegative().optional(),
    maxSelected: z.number().int().positive().optional(),
    appearance: MultiSelectAppearance.default('checkboxes'),
  }),
  z.object({ ...base, type: z.literal('yes_no'), appearance: YesNoAppearance.default('dropdown') }),

  // Presentational — no answer is collected, so `required` is meaningless and omitted.
  z.object({
    id: base.id,
    key: base.key,
    type: z.literal('section_break'),
    label: LocalisedText,
    helpText: LocalisedText.optional(),
  }),
  z.object({ id: base.id, key: base.key, type: z.literal('page_break') }),
  z.object({
    id: base.id,
    key: base.key,
    type: z.literal('rich_text'),
    /** Plain text with paragraph breaks. Not HTML — that would be a stored-XSS surface. */
    content: LocalisedText,
  }),

  /** Prefilled from a URL parameter or a known contact. Never shown, never edited by the filler. */
  z.object({
    id: base.id,
    key: base.key,
    type: z.literal('hidden'),
    /** Query-string parameter this reads from, e.g. `?ref=abc`. */
    fromParameter: z.string().max(64).optional(),
    defaultValue: z.string().max(500).optional(),
  }),
]);

export type Field = z.infer<typeof Field>;

export const FormSettings = z.object({
  submitLabel: LocalisedText.default({}),
  confirmationMessage: LocalisedText.default({}),
  /** START-HERE v0.1: duplicate control by email. Per-token control arrives with tokenised links. */
  duplicateControl: z.enum(['email', 'none']).default('email'),
  /** Save-and-resume is in v0.1 scope but can be switched off per form. */
  allowSaveAndResume: z.boolean().default(true),
});

export const FormDefinition = z.object({
  /** Bumped when the document shape changes in a way old versions cannot be read as. */
  schemaVersion: z.literal(1),
  fields: z.array(Field).default([]),
  settings: FormSettings.default({}),
});

export type FormDefinition = z.infer<typeof FormDefinition>;
export type FormSettings = z.infer<typeof FormSettings>;

export const emptyDefinition: FormDefinition = {
  schemaVersion: 1,
  fields: [],
  settings: {
    submitLabel: {},
    confirmationMessage: {},
    duplicateControl: 'email',
    allowSaveAndResume: true,
  },
};
