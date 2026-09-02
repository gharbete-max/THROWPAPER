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
  /** English fallback for logs and API clients; the app renders `problem.<code>` instead. */
  message: z.string(),
  params: z.record(z.string()).optional(),
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
  /**
   * Completed responses so far.
   *
   * Required rather than optional-with-a-default: "how many people have answered this" is the one
   * fact that tells an author whether a form is working, and a default of nought would let a route
   * that forgot to count report silence as an answer. Required means the response schema rejects
   * the omission instead.
   */
  submissionCount: z.number().int().nonnegative(),
  completeness: z.array(LocaleCompletenessResponse),
  problems: z.array(DefinitionProblemResponse),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

/**
 * A file attached to a submission, named.
 *
 * The answer itself stores only the storage key — the hash of the content — because that is the
 * one thing about an upload safe to trust. The name somebody chose lives beside it and travels
 * with the submission, so a grid can show "receipt.pdf" instead of sixty-four hex characters.
 */
export const SubmissionUpload = z.object({
  /** The field this was attached to, so a row knows which column it belongs in. */
  fieldKey: z.string(),
  key: z.string(),
  filename: z.string(),
  contentType: z.string(),
  bytes: z.number().int().nonnegative(),
});
export type SubmissionUpload = z.infer<typeof SubmissionUpload>;

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
  /** Empty for a form with no file questions, which is most of them. */
  uploads: z.array(SubmissionUpload).default([]),
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
