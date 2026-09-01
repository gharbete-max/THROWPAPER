import { z } from 'zod';
import { Locale, LocalisedText, Uuid } from '../api/common.js';
import { FormDefinition } from './definition.js';

/** Product API shapes for the builder. The public renderer's shapes arrive in 3b. */
export const FormStatus = z.enum(['draft', 'published', 'closed', 'archived']);
export type FormStatus = z.infer<typeof FormStatus>;

const IsoDateTime = z.string().datetime({ offset: true });

export const FormSlug = z
  .string()
  .min(3)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-]*$/, 'Use lower case, digits and hyphens');

export const CreateForm = z.object({
  title: LocalisedText,
  slug: FormSlug,
  /** Optional: a form can stand alone, or collect registrations for one event. */
  eventId: Uuid.nullable().optional(),
  /**
   * Start from a prebuilt template instead of an empty form.
   *
   * The template is **copied into the draft**, not referenced. An author edits their form, not a
   * shared original — otherwise improving a template would silently rewrite forms that people are
   * already filling in.
   */
  templateId: z.string().min(1).max(64).optional(),
});

export const UpdateForm = z.object({
  title: LocalisedText.optional(),
  eventId: Uuid.nullable().optional(),
  opensAt: IsoDateTime.nullable().optional(),
  closesAt: IsoDateTime.nullable().optional(),
  status: FormStatus.exclude(['archived']).optional(),
});

/** Autosave. Saving a draft never creates a version — publishing does. */
export const SaveDraft = z.object({ definition: FormDefinition });

export const PublishForm = z.object({
  /**
   * Publishing with missing required translations is blocked unless the operator explicitly
   * overrides it (SPEC-shared.md §packages/i18n). The override is recorded in the audit log.
   */
  overrideIncompleteTranslations: z.boolean().default(false),
});

export const FormVersionSummary = z.object({
  id: Uuid,
  version: z.number().int().positive(),
  publishedAt: IsoDateTime.nullable(),
  createdAt: IsoDateTime,
});

export const LocaleCompletenessResponse = z.object({
  locale: Locale,
  missing: z.array(z.string()),
  complete: z.boolean(),
});

export const DefinitionProblemResponse = z.object({
  code: z.string(),
  message: z.string(),
  fieldId: z.string().optional(),
});

export const FormResponse = z.object({
  id: Uuid,
  slug: FormSlug,
  title: LocalisedText,
  eventId: Uuid.nullable(),
  status: FormStatus,
  opensAt: IsoDateTime.nullable(),
  closesAt: IsoDateTime.nullable(),
  /** The working copy the builder edits. */
  draftDefinition: FormDefinition,
  publishedVersion: z.number().int().nullable(),
  completeness: z.array(LocaleCompletenessResponse),
  problems: z.array(DefinitionProblemResponse),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const SubmissionResponse = z.object({
  id: Uuid,
  reference: z.string(),
  status: z.enum(['partial', 'complete']),
  locale: z.string(),
  /** The version the answers were given against — a later edit does not move them. */
  formVersion: z.number().int().positive(),
  data: z.record(z.unknown()),
  submittedAt: IsoDateTime.nullable(),
  createdAt: IsoDateTime,
});

export const SubmissionListResponse = z.object({
  submissions: z.array(SubmissionResponse),
  /** The definition to read the answers against: the published one at the time of listing. */
  definition: FormDefinition,
});

export const FormListResponse = z.object({ forms: z.array(FormResponse) });
export const FormVersionListResponse = z.object({ versions: z.array(FormVersionSummary) });

export type CreateForm = z.infer<typeof CreateForm>;
export type UpdateForm = z.infer<typeof UpdateForm>;
export type FormResponse = z.infer<typeof FormResponse>;
export type FormVersionSummary = z.infer<typeof FormVersionSummary>;
export type SubmissionResponse = z.infer<typeof SubmissionResponse>;
