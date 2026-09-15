import { forms as formSchemas } from '@tp/shared';
import type { Repositories, SubmissionRecord } from '../db/repositories/index.js';

const { admittingGroup, REGISTRANT_ENTRY } = formSchemas;

/**
 * Everybody one registration brings to a door.
 *
 * The registrant is always there, as entry nought. The rest are the entries of the form's
 * admitting group, in the order they were answered — see `docs/adr/0003-repeating-groups.md` for
 * why an ordinal is the whole of a guest's identity and nothing is stored to say so.
 *
 * Three callers need the same answer and must not disagree about it: the door screen listing who
 * is expected, the attendance count, and the bulk job printing the cards. A guest who appeared on
 * a card but not in the count, or the other way round, is the sort of discrepancy somebody only
 * finds at the entrance.
 */
export interface PartyMember {
  /** 0 for the registrant, 1-based for a guest. */
  entryIndex: number;
  /** The guest's own name, where the form names one. Null for the registrant and for an unnamed guest. */
  guestName: string | null;
}

/**
 * The guests on one submission, read against the version its answers were given under.
 *
 * Not the form's current version. A card is a promise made at a moment, and reading it against a
 * form that has since been republished would change who a registration brought after the fact.
 */
export function guestsOf(
  definition: unknown,
  submission: Pick<SubmissionRecord, 'data'>,
): PartyMember[] {
  const parsed = formSchemas.FormDefinition.safeParse(definition);
  if (!parsed.success) return [];

  const group = admittingGroup(parsed.data);
  if (!group) return [];

  const entries = submission.data[group.key];
  if (!Array.isArray(entries)) return [];

  return entries.slice(0, group.max).map((entry, index) => {
    const named =
      group.admitNameKey && entry !== null && typeof entry === 'object' && !Array.isArray(entry)
        ? (entry as Record<string, unknown>)[group.admitNameKey]
        : undefined;
    return {
      entryIndex: index + 1,
      guestName: typeof named === 'string' && named.trim() ? named.trim() : null,
    };
  });
}

/** The registrant and their guests, which is the list of cards a submission produces. */
export function partyOf(
  definition: unknown,
  submission: Pick<SubmissionRecord, 'data'>,
): PartyMember[] {
  return [{ entryIndex: REGISTRANT_ENTRY, guestName: null }, ...guestsOf(definition, submission)];
}

/**
 * Guests for a page of submissions, with definitions fetched **once per form**.
 *
 * An event fed by two forms with four hundred registrations between them is two lookups, not four
 * hundred. Submissions whose form has no admitting group contribute nothing and cost nothing.
 */
export async function guestsForAll(
  repos: Repositories,
  submissions: readonly Pick<SubmissionRecord, 'id' | 'formId' | 'formVersionId' | 'data'>[],
): Promise<Map<string, PartyMember[]>> {
  const definitions = await definitionsByVersion(
    repos,
    submissions.map((submission) => submission.formId),
  );

  const parties = new Map<string, PartyMember[]>();
  for (const submission of submissions) {
    const guests = guestsOf(definitions.get(submission.formVersionId), submission);
    if (guests.length > 0) parties.set(submission.id, guests);
  }
  return parties;
}

/** Every published version of these forms, keyed by version id, in one pass per form. */
export async function definitionsByVersion(
  repos: Repositories,
  formIds: readonly string[],
): Promise<Map<string, unknown>> {
  const definitions = new Map<string, unknown>();
  for (const formId of new Set(formIds)) {
    for (const version of await repos.forms.listVersions(formId)) {
      definitions.set(version.id, version.definition);
    }
  }
  return definitions;
}
