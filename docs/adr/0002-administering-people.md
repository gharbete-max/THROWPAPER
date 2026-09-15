# ADR 0002 — Administering people, and what the product refuses to do about them

**Status:** proposed
**Date:** 2026-09-15

## Context

There is no way to add a person to an organisation.

Not "no screen for it" — no endpoint, no repository method, no code path at all.
`UserRepository` (`apps/api-forms/src/db/repositories/types.ts:84`) is exactly three methods:

```ts
findByEmail(organisationId, email)
findById(id)
list(organisationId)
```

`routes/admin.ts` says so in its own header: _"It is read-only by construction — there is no
write endpoint here at all."_ `routes/forms.ts:736` says the other half: form sharing works on
_"only somebody already in the organisation: this endpoint does not invite, create accounts"_.

So today a colleague joins by somebody running `db:seed` or writing SQL. That is the whole
mechanism. It is fine for one organisation run by the person who deployed it, and it is the
first thing that breaks when anybody else has to operate this.

Two pieces of the answer are already built, which is what makes this small:

- **`users.disabledAt` exists**, with the reason recorded in the schema: _"Set rather than
  deleted, so the audit log keeps pointing at a real row."_ The question of how somebody leaves
  has already been decided — they are disabled, never deleted. `auth/service.ts` already refuses
  a magic link for a disabled user. Nothing can set the column.
- **`Users.tsx` already renders a "disabled" badge** — for a state the product cannot produce.
- **The audit log already uses `entityType: 'user'`.** The write path has somewhere to record
  itself the day it exists.

### Passwords are not the missing piece

Authentication is magic-link only. There is no password column, no hashing dependency, no reset
flow, and none of that is an oversight — `requestMagicLink` is already enumeration-safe, resolving
identically for an address that does not exist.

"Users cannot reset their password" is therefore not a defect to fix: **requesting a new link is
the reset.** The two real gaps behind that question are different and both are out of scope here:

- **Recovery when the mailbox itself is lost.** With magic-link-only auth, losing access to the
  inbox loses the account, and there is no path back that does not involve somebody with database
  access. That is a product decision about identity, not an admin screen.
- **A second factor.** Already open in `LAUNCH-CHECKLIST.md` §2.1.

## Decision

Build the smallest surface that lets an organisation be operated without SQL: **add a person,
disable a person, change a person's role.** Nothing else in this phase.

Four questions decide the shape of it. They are answered here rather than left to the code.

### 1. The first administrator comes from the seed, and the product says so

Every "create a user" endpoint needs an administrator to already exist, or it is an open
registration endpoint wearing a different name. The tempting fix is a first-run flow: if the
organisation has no users, let the next caller become the admin.

**Rejected.** A first-run flow is an unauthenticated write endpoint whose guard is a database
state an attacker can observe — deploy, and whoever reaches it first owns the organisation. The
race is narrow and completely fatal, and every mitigation (a setup token, an IP allow-list, a
time window) is more machinery than the thing it replaces.

So: **`db:seed` creates the first administrator, and that stays the documented bootstrap.** It is
one command, run by whoever has the database anyway, at the moment they have it. `docs/DEPLOY.md`
gains it as a numbered step rather than it being folklore.

The consequence to accept deliberately: an organisation that disables its last administrator is
locked out and needs the database. Which is why:

### 2. The last administrator cannot be disabled or demoted

Both writes get the same guard, checked server-side in the same transaction as the write:

> An organisation must retain at least one enabled user with `role = 'admin'`.

This is not a UI affordance. A confirmation dialog does not prevent it — it explains it, to
somebody who has already decided to click. The check belongs where the write happens, and it
must be a condition of the update rather than a read-then-write, or two administrators demoting
each other simultaneously both pass the check and both succeed.

Self-demotion is the common case, not the adversarial one: an admin tidying up, reducing their
own privileges, and finding nobody can grant them back. The error names the actual constraint —
_"promote another administrator first"_ — because "forbidden" sends people to the database.

### 3. No invitations in this phase

An invitation is a second identity mechanism: a token, an expiry, a consumed flag, an acceptance
screen, a resend path, and a set of states a user can be in other than "exists".

The product already has all of that, and it is called a magic link. An administrator creates the
person; the person receives an ordinary sign-in link at their address and follows it. There is no
acceptance step because there is nothing to accept — the account exists, created by somebody with
the authority to create it.

What that costs, stated plainly: the new person gets no "Kim added you to X" message explaining
why they are being emailed. That is a copy problem — one mail template — not a state machine,
and it can be solved without inventing invitations.

Deferred, not refused: a real invitation flow becomes correct the moment people self-register or
join more than one organisation. Neither is true yet.

### 4. Single-tenant, and one more caller of `organisations.first()`

`clientIdentity`, invoices and the public form already resolve the organisation with
`repos.organisations.first()` (audit item 17). These endpoints will do the same, taking the
organisation from the caller's own token rather than a lookup — which is correct today and stays
correct after a host-based tenant lookup lands, because a token already carries
`organisationId`.

**This phase does not fix multi-tenancy and does not make it worse.** The write endpoints are
scoped by `request.auth.organisationId`, which is the value a tenant lookup would produce anyway.
The one honest cost is three more endpoints to re-read when item 17 is done, and they are three
endpoints that already do the right thing.

## Consequences

- An organisation can be operated without database access, which is the point.
- `db:seed` becomes load-bearing for deployment rather than only for demos. `docs/DEPLOY.md` and
  `LAUNCH-CHECKLIST.md` §5 both need the bootstrap step written down; a seed that is only ever
  run for a demo will rot, and now it cannot.
- Disabling stays reversible and leaves the audit log intact, because it was designed that way
  before this ADR existed. Nothing here introduces a hard delete, and nothing should: a deleted
  user orphans every audit row that names them, which defeats the log's only purpose.
- Every write records an audit entry with the acting administrator's own identity. This follows
  `routes/admin.ts`'s existing refusal to implement impersonation, and for the same reason — the
  log has to be able to answer "who did this".
- Rule 7 applies: disabling somebody and changing a role are both confirmed before they happen.
- Three more endpoints to revisit when tenant-by-host lands.

## Out of scope, with reasons

**Editing a person's email.** The address *is* the login identity — a magic link goes to it — so
changing it without verifying the new address first is an account-takeover primitive wearing an
edit form. It needs a confirm-at-the-new-address flow, which is an invitation by another name;
see point 3.

**API keys.** Genuinely absent: there are no key endpoints anywhere, and the API is
user-bearer-token only. It is also a different lifecycle from a session — no refresh rotation,
independently revocable, scoped, displayed exactly once — and therefore its own phase. Worth
building when a customer needs machine access, and not before.

**SEO and marketing settings.** Deliberately not a settings screen. Meta copy is per-locale text
and CLAUDE.md rule 4 puts text in `packages/i18n`; making it runtime-editable fights that and
invites exactly the machine-translated legal wording rule 8 forbids. The canonical host is
already `APP_URL`. What is actually missing on that front is a 1200×630 social card and a Search
Console verification method, both waiting on the domain decision, and neither is a screen.

**An analytics toggle.** Adding one is not a small feature: the product sets no cookies today,
which is precisely why no consent banner is required. An analytics setting drags the consent gate
in with it, and `LAUNCH-CHECKLIST.md` §2.2 and the Phase 4 analytics item have to be decided
together or the product ships a legal problem rather than a feature.
