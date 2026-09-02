import { describe, expect, it } from 'vitest';
import { FormAccess, accessFor, canDelete, canEdit, canShare } from './access.js';

const alice = 'aaaaaaaa-0000-0000-0000-000000000001';
const bob = 'bbbbbbbb-0000-0000-0000-000000000002';

describe('who may do what with a form', () => {
  it('calls it yours when you made it', () => {
    expect(accessFor({ userId: alice, userRole: 'operator', ownerUserId: alice })).toBe('owner');
  });

  /**
   * Ownership is checked before role on purpose.
   *
   * An administrator's own form should say `owner`, because the app draws `admin` as "you are
   * looking at somebody else's work" — a banner that appeared on your own forms would be noise
   * you learned to ignore, which is how a warning stops working.
   */
  it("says owner, not admin, on an administrator's own form", () => {
    expect(accessFor({ userId: alice, userRole: 'admin', ownerUserId: alice })).toBe('owner');
  });

  it("lets an administrator into somebody else's form, marked as such", () => {
    expect(accessFor({ userId: alice, userRole: 'admin', ownerUserId: bob })).toBe('admin');
  });

  it('shuts an operator out of a form that is neither theirs nor shared', () => {
    expect(accessFor({ userId: alice, userRole: 'operator', ownerUserId: bob })).toBeNull();
  });

  it.each(['viewer', 'editor'] as const)('honours a %s share', (role) => {
    expect(
      accessFor({ userId: alice, userRole: 'operator', ownerUserId: bob, shareRole: role }),
    ).toBe(role);
  });

  /**
   * The compatibility case, and the reason `ownerUserId` is nullable at all.
   *
   * Every form made before ownership existed has no owner. Narrowing those to nobody would have
   * locked people out of their own work the moment this shipped, so an unowned form stays the
   * organisation's — exactly as it behaved before.
   */
  it('leaves an unowned form open to the whole organisation', () => {
    expect(accessFor({ userId: alice, userRole: 'operator', ownerUserId: null })).toBe(
      'organisation',
    );
  });
});

describe('the predicates', () => {
  it('lets everybody but a viewer edit', () => {
    for (const access of FormAccess.options) {
      expect(canEdit(access)).toBe(access !== 'viewer');
    }
  });

  /**
   * Being trusted to fix a typo is not being trusted to throw the form away — and the person who
   * would have to notice is the owner, who by then has no form to notice it on.
   */
  it('keeps deleting and sharing away from anybody holding a share', () => {
    expect(canDelete('editor')).toBe(false);
    expect(canDelete('viewer')).toBe(false);
    expect(canShare('editor')).toBe(false);

    for (const access of ['owner', 'admin', 'organisation'] as const) {
      expect(canDelete(access)).toBe(true);
      expect(canShare(access)).toBe(true);
    }
  });

  /**
   * A guard against the levels and the predicates drifting apart.
   *
   * Adding a level to the enum without deciding what it may do is the failure this catches: every
   * predicate must give a definite answer for every level, and a new one would arrive here as an
   * undefined rather than as a quiet `false`.
   */
  it('answers for every level there is', () => {
    for (const access of FormAccess.options) {
      expect(typeof canEdit(access)).toBe('boolean');
      expect(typeof canDelete(access)).toBe('boolean');
      expect(typeof canShare(access)).toBe('boolean');
    }
  });
});
