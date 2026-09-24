import { forms as formSchemas } from '@tp/shared';
import type {
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
