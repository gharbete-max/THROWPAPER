import { forms as formSchemas } from '@tp/shared';
import type {
  FormRecord,
  OrganisationRecord,
  Repositories,
  UserRecord,
} from '../db/repositories/index.js';

export type Auth = { user: UserRecord; organisation: OrganisationRecord };

export interface FormAccess {
  form: FormRecord;
  access: formSchemas.FormAccess;
  shareCount: number;
  sharedRole: formSchemas.FormShareRole | null;
}

/**
 * A form, plus what this person may do with it. **The one place a route learns about permission.**
 *
 * It used to live inside `routes/forms.ts` as a module-private helper, and that was the whole
 * problem: the routes in that file all asked it, and the routes in other files could not. So
 * `documents.ts` and `checkin.ts` each grew their own weaker check — an organisation lookup, which
 * answers "is this in your company" rather than "is this yours" — and a colleague's registrants
 * were readable by anyone with a session.
 *
 * Being module-private did not make it a boundary. Being reachable is what makes it one.
 *
 * `null` covers both "no such form" and "not yours", deliberately: a 403 on somebody else's
 * private form confirms it exists, which is a fact the asker did not have. Both answer 404.
 */
export async function resolveFormAccess(
  repos: Repositories,
  auth: Auth,
  id: string,
): Promise<FormAccess | null> {
  const form = await repos.forms.findById(auth.organisation.id, id);
  if (!form) return null;

  const shares = await repos.forms.listShares(auth.organisation.id, id);
  const mine = shares.find((share) => share.userId === auth.user.id)?.role ?? null;

  const access = formSchemas.accessFor({
    userId: auth.user.id,
    userRole: auth.user.role,
    ownerUserId: form.ownerUserId,
    shareRole: mine,
  });
  if (!access) return null;

  return { form, access, shareCount: shares.length, sharedRole: mine };
}

/**
 * Which of these forms this person may read, answered once for a set.
 *
 * An event's attendee list spans every form pointed at it, so the alternative is `resolveFormAccess`
 * inside a loop over submissions — two queries per row, and the same form resolved forty times for
 * a forty-person event. This asks once per distinct form.
 */
export async function readableFormIds(
  repos: Repositories,
  auth: Auth,
  formIds: Iterable<string>,
): Promise<Set<string>> {
  const distinct = [...new Set(formIds)];
  const resolved = await Promise.all(
    distinct.map(async (id) => ((await resolveFormAccess(repos, auth, id)) ? id : null)),
  );
  return new Set(resolved.filter((id): id is string => id !== null));
}
