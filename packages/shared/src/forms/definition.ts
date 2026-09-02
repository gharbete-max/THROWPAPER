import { z } from 'zod';
import { LocalisedText } from '../api/common.js';
import { AssetPath } from '../assets.js';
import { FileAccept, MAX_UPLOAD_BYTES } from './uploads.js';

/**
 * A form definition is a **versioned JSON document, never an HTML string** (`SPEC-forms.md` §7).
 *
 * Submissions reference the version they were filled against, so editing a form can never
 * retroactively change what somebody answered.
 *
 * The first thirteen were exactly the v0.1 field set from `docs/START-HERE.md`. Adding to this
 * union is a scope change, not a detail — `image` arrived with A15b because the product is a
 * general form builder rather than a registration tool, and it needed somewhere to put a picture.
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
  'rating',
  'time',
  'file',
  'section_break',
  'page_break',
  'rich_text',
  'image',
  'link',
  'hidden',
] as const;

export const FieldType = z.enum(FIELD_TYPES);
export type FieldType = z.infer<typeof FieldType>;

/** Types that display something but never collect an answer. */
export const PRESENTATIONAL_TYPES = [
  'section_break',
  'page_break',
  'rich_text',
  'image',
  'link',
] as const;

/** Stable machine name for a field. Submission data is keyed by this, not by the label. */
export const FieldKey = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_]*$/, 'Use lower case, digits and underscores, starting with a letter');

/**
 * How much of a row a field takes.
 *
 * Named fractions rather than pixels, because a form has to survive a phone: "half" is half on a
 * wide screen and the whole width on a narrow one. A pixel width would be a promise the layout
 * cannot keep, and the author would be the last to find out.
 */
export const FIELD_WIDTHS = ['full', 'half', 'third'] as const;
export const FieldWidth = z.enum(FIELD_WIDTHS);
export type FieldWidth = z.infer<typeof FieldWidth>;

/**
 * Conditional visibility — "show this only when that was answered a certain way".
 *
 * The comparison is done on the **stored answer**, not on anything visible, so a form that has
 * been restyled or retranslated keeps behaving the same way. `value` is a string for every
 * operator because that is what a builder's input produces; the evaluator coerces per field type.
 */
export const CONDITION_OPERATORS = [
  'equals',
  'notEquals',
  'contains',
  'answered',
  'empty',
  'greaterThan',
  'lessThan',
] as const;
export const ConditionOperator = z.enum(CONDITION_OPERATORS);
export type ConditionOperator = z.infer<typeof ConditionOperator>;

/** Operators that compare against nothing — the box for a value is hidden for these. */
export const VALUELESS_OPERATORS = ['answered', 'empty'] as const;

export const Condition = z.object({
  /** The field being asked about, by key. Must appear *earlier* in the form; cycles are then
   *  impossible by construction rather than by a cycle detector nobody would maintain. */
  fieldKey: FieldKey,
  operator: ConditionOperator,
  value: z.string().max(200).default(''),
});
export type Condition = z.infer<typeof Condition>;

export const VisibilityRule = z.object({
  /** `all` is the safer default: adding a second condition narrows rather than widens. */
  match: z.enum(['all', 'any']).default('all'),
  conditions: z.array(Condition).min(1),
});
export type VisibilityRule = z.infer<typeof VisibilityRule>;

/**
 * Shown by default.
 *
 * `undefined` rather than an empty rule, so "no conditions" cannot be confused with "a rule whose
 * conditions all happen to be satisfied" — and an old definition with no `showWhen` at all keeps
 * rendering exactly as it did.
 */
const showWhen = VisibilityRule.optional();

const base = {
  id: z.string().min(1).max(64),
  key: FieldKey,
  label: LocalisedText,
  helpText: LocalisedText.optional(),
  placeholder: LocalisedText.optional(),
  required: z.boolean().default(false),
  width: FieldWidth.default('full'),
  showWhen,
};

export const SelectOption = z.object({
  value: z.string().min(1).max(128),
  label: LocalisedText,
  /**
   * A picture for this choice. Shown by the `cards` and `buttons` appearances, ignored by a
   * dropdown, which has nowhere to put it.
   *
   * The label stays required even when there is an image. An image-only choice cannot be read
   * aloud, cannot be searched, and cannot be exported — the answer that lands in the CSV is still
   * the label, so it has to exist.
   */
  image: AssetPath.nullable().default(null),
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
/** Stars for satisfaction, numbers for a scale somebody will do arithmetic on later. */
export const RATING_APPEARANCES = ['star', 'number'] as const;

export const SingleSelectAppearance = z.enum(SINGLE_SELECT_APPEARANCES);
export type SingleSelectAppearance = z.infer<typeof SingleSelectAppearance>;
export const MultiSelectAppearance = z.enum(MULTI_SELECT_APPEARANCES);
export type MultiSelectAppearance = z.infer<typeof MultiSelectAppearance>;
export const YesNoAppearance = z.enum(YES_NO_APPEARANCES);
export type YesNoAppearance = z.infer<typeof YesNoAppearance>;
export const RatingAppearance = z.enum(RATING_APPEARANCES);
export type RatingAppearance = z.infer<typeof RatingAppearance>;

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

  /**
   * A rating or a linear scale — satisfaction, likelihood to recommend, how good the coffee was.
   *
   * Stores a plain integer from 1 to `scale`, so the answer is a number in the export and can be
   * averaged, rather than the text of whichever star got clicked.
   *
   * `minLabel` and `maxLabel` name the ends. Without them a 1–10 scale is ambiguous in both
   * directions — a survey that does not say whether 10 is good or bad collects noise.
   */
  z.object({
    ...base,
    type: z.literal('rating'),
    scale: z.number().int().min(2).max(10).default(5),
    appearance: RatingAppearance.default('star'),
    minLabel: LocalisedText.optional(),
    maxLabel: LocalisedText.optional(),
  }),

  /**
   * A file the person filling in the form attaches.
   *
   * The answer is the storage key, not the bytes and not the filename. A filename is written by
   * whoever uploaded it and is shown back only after being looked up — never used to address
   * anything. The original name lives beside the file in `form_uploads`, which is also what makes
   * an unclaimed upload findable later.
   */
  z.object({
    ...base,
    type: z.literal('file'),
    accept: FileAccept.default('both'),
    /** A per-field cap, never above the one the endpoint enforces regardless. */
    maxBytes: z.number().int().min(1024).max(MAX_UPLOAD_BYTES).default(MAX_UPLOAD_BYTES),
  }),

  /**
   * A time of day, `HH:MM` on a 24-hour clock.
   *
   * Stored as a string rather than a number of minutes because that is what `<input type="time">`
   * produces, what a spreadsheet reads back, and what sorts correctly as text.
   */
  z.object({
    ...base,
    type: z.literal('time'),
    min: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .optional(),
    max: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .optional(),
  }),

  // Presentational — no answer is collected, so `required` is meaningless and omitted.
  z.object({
    id: base.id,
    key: base.key,
    type: z.literal('section_break'),
    width: FieldWidth.default('full'),
    showWhen,
    label: LocalisedText,
    helpText: LocalisedText.optional(),
  }),
  z.object({ id: base.id, key: base.key, type: z.literal('page_break') }),
  z.object({
    id: base.id,
    key: base.key,
    type: z.literal('rich_text'),
    width: FieldWidth.default('full'),
    showWhen,
    /** Plain text with paragraph breaks. Not HTML — that would be a stored-XSS surface. */
    content: LocalisedText,
  }),

  /**
   * A picture in the form: header art, or an illustration for the question that follows.
   *
   * `alt` is localised like every other string and may be empty — but only deliberately. An empty
   * alt means "decorative, skip it", which is right for a banner and wrong for a diagram somebody
   * needs in order to answer.
   */
  z.object({
    id: base.id,
    key: base.key,
    type: z.literal('image'),
    width: FieldWidth.default('full'),
    showWhen,
    src: AssetPath,
    alt: LocalisedText.default({}),
    /** Caps the rendered width in pixels. Unset means as wide as the form allows. */
    maxWidth: z.number().int().min(40).max(2000).optional(),
  }),

  /**
   * A link out of the form — terms, a price list, directions, whatever the author wants somebody
   * to be able to read before answering.
   *
   * Opens in a new tab on purpose: a half-filled form is lost if the same tab navigates away, and
   * this exists precisely for the moment somebody stops to check something.
   *
   * Collects nothing, so it is presentational. `http` and `https` only — a form is a public page
   * and `javascript:` in an author-supplied href is script execution against every visitor.
   */
  z.object({
    id: base.id,
    key: base.key,
    type: z.literal('link'),
    width: FieldWidth.default('full'),
    showWhen,
    label: LocalisedText.default({}),
    href: z
      .string()
      .trim()
      .url()
      .refine((value) => /^https?:\/\//i.test(value), 'Links must start with http:// or https://'),
    /** A quieter presentation for a link that is a footnote rather than an action. */
    appearance: z.enum(['button', 'link']).default('button'),
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

export type PresentationalType = (typeof PRESENTATIONAL_TYPES)[number];

/**
 * A field that collects an answer — everything except the presentational ones.
 *
 * A real narrowing rather than a comment, so `validateField` can be an exhaustive switch. While
 * `answerableFields` returned the whole union, that switch needed a `default` branch, and its
 * default silently stored `null` — which is what a new answerable field type would have done all
 * the way through to an empty column in the export.
 */
export type AnswerableField = Exclude<Field, { type: PresentationalType }>;

/**
 * Every property a field of this type carries, read out of the schema itself.
 *
 * Exists so the builder can be **proved** to expose everything a field has. The validator has
 * enforced `minLength`, `maxLength`, `pattern`, `min`, `max`, `decimals`, `minSelected` and
 * `maxSelected` since it was written, and the properties panel offered a control for none of
 * them — a whole validation engine no author could reach, because nothing compared the two lists.
 *
 * `apps/forms/.../field-properties.test.ts` walks this and fails on any property with nowhere to
 * set it, so adding a rule to the schema and forgetting the UI is now a red test rather than a
 * feature nobody can find.
 */
export function fieldProperties(type: FieldType): string[] {
  const variant = Field.options.find((option) => option.shape.type.value === type);
  return variant ? Object.keys(variant.shape) : [];
}

const PROPERTY_SETS = new Map<string, Set<string>>(
  FIELD_TYPES.map((type) => [type, new Set(fieldProperties(type))]),
);

/**
 * Whether a field of this **type** can carry this property.
 *
 * Use this, never `'helpText' in field`.
 *
 * Zod omits an `.optional()` property that was not set, so the key is simply absent from the
 * parsed object — and `'helpText' in field` then reads as "this kind of field has no help text"
 * when it actually means "nobody has written any yet". The builder asked that question about
 * `helpText`, so the box for it appeared only on fields that already had help text: there was no
 * way to *add* help text to anything, and the same was about to be true of `placeholder` and of
 * conditional visibility.
 *
 * A `.default()`ed property is always present after parsing, which is why `width`, `required` and
 * `appearance` happened to work and hid the problem.
 */
export function fieldSupports(type: FieldType, property: string): boolean {
  return PROPERTY_SETS.get(type)?.has(property) ?? false;
}

export const FormSettings = z.object({
  submitLabel: LocalisedText.default({}),
  confirmationMessage: LocalisedText.default({}),
  /** START-HERE v0.1: duplicate control by email. Per-token control arrives with tokenised links. */
  duplicateControl: z.enum(['email', 'none']).default('email'),
  /** Save-and-resume is in v0.1 scope but can be switched off per form. */
  allowSaveAndResume: z.boolean().default(true),
  /**
   * How far through a multi-page form somebody is. A single-page form has no progress to show and
   * ignores this.
   */
  showProgress: z.boolean().default(true),
  /**
   * Where to send somebody after they submit, instead of the confirmation screen.
   *
   * `http` and `https` only. This is author-supplied and ends up in `location.href`, so a
   * `javascript:` URL here would be script execution against every person who fills in the form —
   * the same reason the link field is restricted.
   *
   * The reference is appended as a query parameter, so a destination page can still show it. A
   * redirect that loses the reference makes an event registration unusable at the door.
   */
  redirectUrl: z
    .string()
    .trim()
    .url()
    .refine((value) => /^https?:\/\//i.test(value), 'Links must start with http:// or https://')
    .optional(),
});

export const FormDefinition = z.object({
  /** Bumped when the document shape changes in a way old versions cannot be read as. */
  schemaVersion: z.literal(1),
  fields: z.array(Field).default([]),
  settings: FormSettings.default({}),
});

export type FormDefinition = z.infer<typeof FormDefinition>;
export type FormSettings = z.infer<typeof FormSettings>;

/**
 * A blank form, built by the schema rather than retyped beside it.
 *
 * Every value here is already a `.default()` in `FormSettings`, so parsing an almost-empty object
 * produces them. Writing the literal out again meant two lists to keep in step, and the one that
 * gets forgotten is this one — a new setting would be missing from every form created from
 * scratch while being present on every form the builder had touched.
 */
export const emptyDefinition: FormDefinition = FormDefinition.parse({ schemaVersion: 1 });
