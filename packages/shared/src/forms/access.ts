import { z } from 'zod';

/**
 * Who may do what with a form.
 *
 * ## Why this is one function and not a dozen `if` statements
 *
 * Before this, "may you edit this form" was `role === 'admin'`, written out separately in six
 * route handlers and again in the app to decide whether to draw the Edit button. Six copies of a
 * rule is six chances for the button and the endpoint to disagree — and when they disagree the
 * failure is silent in the safe direction (a button that 403s) and invisible in the dangerous one
 * (a button that should not have been there and works).
 *
 * So: the server derives an {@link FormAccess} once, sends it on the form, and enforces it with
 * the same predicates the app uses to draw the buttons. One rule, two readers.
 *
 * ## The levels
 *
 * - `admin` — an administrator, on any form in the organisation. Support and clean-up work.
 * - `owner` — you made it.
 * - `editor` — it was shared with you to work on.
 * - `viewer` — it was shared with you to read, responses included.
 * - `organisation` — nobody owns it, so everybody in the organisation may work on it. This is
 *   what every form made before ownership existed looks like, and it is deliberately generous:
 *   narrowing those retroactively would have locked people out of their own work overnight.
 */
export const FormAccess = z.enum(['admin', 'owner', 'editor', 'viewer', 'organisation']);
export type FormAccess = z.infer<typeof FormAccess>;

/** What a share grants. Sharing is additive — it never takes away what you already had. */
export const FormShareRole = z.enum(['viewer', 'editor']);
export type FormShareRole = z.infer<typeof FormShareRole>;

/**
 * Which pile of forms to show.
 *
 * `active` is the default and is what "my forms" means in practice: things you own, things shared
 * with you, and the organisation's unowned ones — everything you can actually work on, minus the
 * bin. The bin is never mixed in with the rest; a deleted form appearing in a normal list is how
 * people delete things twice.
 */
export const FormScope = z.enum(['active', 'mine', 'shared', 'trash', 'all']);
export type FormScope = z.infer<typeof FormScope>;

/**
 * The one place that decides access.
 *
 * `null` means no access at all, which for a form in your own organisation can only happen when
 * somebody else owns it and has not shared it with you. That case answers 404 rather than 403:
 * telling a stranger "that form exists but is not yours" is more than they had before they asked.
 */
export function accessFor(input: {
  userId: string;
  userRole: 'admin' | 'operator';
  ownerUserId: string | null;
  /** The share addressed to this user, if there is one. */
  shareRole?: FormShareRole | null;
}): FormAccess | null {
  if (input.ownerUserId === input.userId) return 'owner';
  // Checked after ownership so an administrator's own forms still say "owner" — the distinction
  // matters in the app, where `admin` is drawn as "you are looking at somebody else's work".
  if (input.userRole === 'admin') return 'admin';
  if (input.shareRole) return input.shareRole;
  if (input.ownerUserId === null) return 'organisation';
  return null;
}

/** Change the form itself: fields, settings, publishing, restoring an old version. */
export function canEdit(access: FormAccess): boolean {
  return access !== 'viewer';
}

/**
 * Read the responses.
 *
 * Every level can, including `viewer` — a share that shows the questions but not the answers is
 * not a useful thing to give somebody, and the questions are public anyway once the form is.
 */
export function canViewResponses(): boolean {
  return true;
}

/**
 * Move it to the bin, take it out again, or destroy it.
 *
 * Not `editor`: being trusted to fix a typo is not being trusted to throw the thing away, and the
 * person who would have to notice is the owner, who by then has no form to notice it on.
 */
export function canDelete(access: FormAccess): boolean {
  return access === 'owner' || access === 'admin' || access === 'organisation';
}

/**
 * Share it onward, or stop sharing it.
 *
 * Editors deliberately cannot: a share that can reshare is a permission nobody can reason about
 * after the third hop, and revoking one then means walking a graph rather than deleting a row.
 */
export function canShare(access: FormAccess): boolean {
  return canDelete(access);
}
