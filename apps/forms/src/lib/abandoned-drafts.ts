import { jsonEqual } from '@tp/shared/builder';
import { emptyDefinition, type FormResponse } from '@tp/shared/forms';

const DAY_MS = 24 * 3600 * 1000;

/**
 * Drafts that were started and went nowhere: the person's own, never published, never answered, not
 * shared, not in an event, with nothing in them, in the address the app gave them (`form-…`), and
 * untouched for a day. Before the guided builder waited for the first answer every press of "Start
 * from questions" left one of these behind.
 *
 * The list offers to move them to the bin, after a confirmation; it never does it by itself. All of
 * it is checked here and none of it is a guess about the title: a form somebody named is theirs.
 */
export function abandonedDrafts(
  forms: readonly FormResponse[],
  userId: string,
  now: number,
): FormResponse[] {
  return forms.filter(
    (form) =>
      form.status === 'draft' &&
      form.publishedVersion === null &&
      form.deletedAt === null &&
      form.eventId === null &&
      form.submissionCount === 0 &&
      form.shareCount === 0 &&
      form.ownerUserId === userId &&
      /^form-[0-9a-z]+$/.test(form.slug) &&
      jsonEqual(form.draftDefinition, emptyDefinition) &&
      now - Date.parse(form.updatedAt) >= DAY_MS,
  );
}
