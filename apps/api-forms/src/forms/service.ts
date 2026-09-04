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
  /**
   * Completed responses, counted by the caller.
   *
   * A parameter rather than something this function fetches, because it maps a record it was
   * handed and has no repository. Callers that list many forms count them in one query.
   */
  submissionCount: number,
  /**
   * Who is looking, and what they are allowed to do.
   *
   * Required rather than optional. Every route that returns a form has to have decided this
   * already in order to have let the request through, so passing it costs nothing — and making it
   * optional would mean a route that forgot could hand back a form claiming the most permissive
   * access there is. A missing argument is a compile error; a wrong default is a security bug.
   */
  viewer: {
    access: formSchemas.FormAccess;
    /** The share addressed to this reader, if any. Independent of `access` — see the schema. */
    sharedRole?: formSchemas.FormShareRole | null;
    /** The owner's display name, resolved by the caller. Null when nobody owns it. */
    ownerName?: string | null;
    shareCount?: number;
  },
): formSchemas.FormResponse {
  const parsed = formSchemas.FormDefinition.safeParse(form.draftDefinition);
  const definition = parsed.success ? parsed.data : formSchemas.emptyDefinition;

  return {
    ownerUserId: form.ownerUserId,
    ownerName: viewer.ownerName ?? null,
    deletedAt: form.deletedAt?.toISOString() ?? null,
    access: viewer.access,
    sharedRole: viewer.sharedRole ?? null,
    shareCount: viewer.shareCount ?? 0,
    id: form.id,
    slug: form.slug,
    title: form.title,
    eventId: form.eventId,
    status: form.status,
    opensAt: form.opensAt?.toISOString() ?? null,
    closesAt: form.closesAt?.toISOString() ?? null,
    draftDefinition: definition,
    publishedVersion: form.publishedVersion,
    submissionCount,
    /*
     * Against the languages **this form** offers, not the organisation's whole list.
     *
     * An organisation supporting twelve rarely writes a form in more than two. Reporting the
     * other ten as incomplete is accurate and useless: it is the state every form is in by
     * design, so the indicator stops carrying information. `formLocales` is the one place that
     * decides which languages a form is actually in — the public renderer already asks it.
     */
    completeness: formSchemas.definitionCompleteness(
      definition,
      formSchemas.formLocales(definition.settings, supportedLocales),
    ),
    problems: parsed.success
      ? formSchemas.definitionProblems(definition)
      : [{ code: 'definition-invalid', message: 'The saved draft is not a valid form' }],
    createdAt: form.createdAt.toISOString(),
    updatedAt: form.updatedAt.toISOString(),
  };
}
