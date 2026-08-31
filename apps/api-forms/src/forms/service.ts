import { forms as formSchemas } from '@tp/shared';
import type { FormRecord } from '../db/repositories/index.js';

/**
 * Maps a stored form onto the API shape, recomputing completeness and structural problems on
 * every read rather than storing them. They are derived from the draft, and a stored copy would
 * be wrong the moment somebody edited a label.
 */
export function toFormResponse(
  form: FormRecord,
  supportedLocales: readonly string[],
): formSchemas.FormResponse {
  const parsed = formSchemas.FormDefinition.safeParse(form.draftDefinition);
  const definition = parsed.success ? parsed.data : formSchemas.emptyDefinition;

  return {
    id: form.id,
    slug: form.slug,
    title: form.title,
    eventId: form.eventId,
    status: form.status,
    opensAt: form.opensAt?.toISOString() ?? null,
    closesAt: form.closesAt?.toISOString() ?? null,
    draftDefinition: definition,
    publishedVersion: form.publishedVersion,
    completeness: formSchemas.definitionCompleteness(definition, supportedLocales),
    problems: parsed.success
      ? formSchemas.definitionProblems(definition)
      : [{ code: 'definition-invalid', message: 'The saved draft is not a valid form' }],
    createdAt: form.createdAt.toISOString(),
    updatedAt: form.updatedAt.toISOString(),
  };
}
