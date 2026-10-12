import { forms as formSchemas } from '@tp/shared';
import { answerableChildren } from '@tp/shared/forms';
import type {
  FormRecord,
  OrganisationRecord,
  Repositories,
  SubmissionRecord,
} from '../db/repositories/index.js';
import { resolveTokens } from '../routes/brand-kit.js';
import type { PrivateUploadStore } from '../uploads/private-store.js';
import type { PdfRenderer } from './render.js';
import { renderFinishedDocument, type FinishedDocument } from './finished.js';

export interface FinishedServiceDeps {
  repos: Repositories;
  renderer: PdfRenderer;
  uploadStore: PrivateUploadStore;
}

/**
 * Everything a finished document needs, loaded the one way both routes use.
 *
 * The definition is the **version the person answered**, never the form as it is now: an author
 * who renames a question next week does not change what somebody's saved copy says they were
 * asked. The organisation's brand kit dresses it, as it dresses the form they filled in.
 *
 * `null` when the submission cannot become a document — not complete, withdrawn, or its version
 * unreadable. Callers answer 404 for all three; none of them is the caller's business to tell apart.
 */
export async function buildFinishedDocument(
  deps: FinishedServiceDeps,
  organisation: OrganisationRecord,
  submission: SubmissionRecord,
): Promise<FinishedDocument | null> {
  if (submission.status !== 'complete' || submission.revokedAt) return null;

  const form = await deps.repos.forms.findById(organisation.id, submission.formId);
  if (!form) return null;
  const version = (await deps.repos.forms.listVersions(form.id)).find(
    (candidate) => candidate.id === submission.formVersionId,
  );
  const definition = formSchemas.FormDefinition.safeParse(version?.definition);
  if (!definition.success) return null;

  const uploads = await deps.repos.uploads.listForSubmissions(organisation.id, [submission.id]);
  const { tokens } = await resolveTokens(deps.repos, organisation.id);

  return renderFinishedDocument(
    { renderer: deps.renderer, uploadStore: deps.uploadStore, tokens },
    {
      organisation,
      formTitle: form.title,
      submission,
      definition: definition.data,
      filenames: new Map(uploads.map((upload) => [upload.storageKey, upload.filename])),
    },
  );
}

/**
 * The answers a draft may carry: text, numbers, choices. Not the keys of uploaded files or
 * signatures, which name something in the store and which a request body must not be able to point
 * at. (A drawn signature belongs to Sign.)
 */
export function plainValues(
  definition: formSchemas.FormDefinition,
  values: Record<string, unknown>,
): Record<string, unknown> {
  const plain = (type: string) => type !== 'signature' && type !== 'file';
  const out: Record<string, unknown> = {};
  for (const field of definition.fields) {
    if (!(field.key in values)) continue;
    if (field.type === 'repeating_group') {
      const entries = values[field.key];
      if (!Array.isArray(entries)) continue;
      const allowed = new Set(
        answerableChildren(field)
          .filter((child) => plain(child.type))
          .map((child) => child.key),
      );
      out[field.key] = entries.map((entry) =>
        Object.fromEntries(
          Object.entries(entry && typeof entry === 'object' ? entry : {}).filter(([key]) =>
            allowed.has(key),
          ),
        ),
      );
    } else if (plain(field.type)) {
      out[field.key] = values[field.key];
    }
  }
  return out;
}

/**
 * A form's **draft** as a PDF, blank or filled in by whoever is authoring it. Nothing is written:
 * the submission here exists only in memory, to go through the renderer that makes every
 * finished document, and the form's published version is not asked about. `null` when the draft
 * is not a readable definition.
 */
export async function buildDraftDocument(
  deps: FinishedServiceDeps,
  organisation: OrganisationRecord,
  form: FormRecord,
  input: { locale: string; values: Record<string, unknown> },
): Promise<FinishedDocument | null> {
  const definition = formSchemas.FormDefinition.safeParse(form.draftDefinition);
  if (!definition.success) return null;
  const { tokens } = await resolveTokens(deps.repos, organisation.id);
  const now = new Date();
  return renderFinishedDocument(
    { renderer: deps.renderer, uploadStore: deps.uploadStore, tokens },
    {
      organisation,
      formTitle: form.title,
      draft: true,
      definition: definition.data,
      submission: {
        id: '',
        organisationId: organisation.id,
        formId: form.id,
        formVersionId: '',
        eventId: null,
        reference: '',
        status: 'partial',
        locale: input.locale,
        email: null,
        data: plainValues(definition.data, input.values),
        resumeTokenHash: null,
        resumeExpiresAt: null,
        submittedAt: null,
        revokedAt: null,
        createdAt: now,
        updatedAt: now,
      },
    },
  );
}
