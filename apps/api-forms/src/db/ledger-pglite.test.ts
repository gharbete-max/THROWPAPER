import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openLocalDatabase } from './pglite.js';
import { seedDemo } from './seed-demo.js';
import { AlreadyReversed } from './repositories/index.js';

/**
 * The write paths the Drizzle repositories promise under contention, run on the embedded Postgres
 * so they always run (`database.test.ts` skips without a server). One connection serialises the
 * statements, so these prove the *answers* a lost race gets: the unique index and the row lock
 * are real, and what the code does with them is the claim. Where two are really concurrent, the
 * memory-backed tests in `routes/ledger.test.ts` and `auth/auth.test.ts` interleave them.
 */
const migrationsFolder = join(import.meta.dirname, '..', '..', 'drizzle');

const entry = (
  organisationId: string,
  reference: string,
  accounts: [string, string],
  extra = {},
) => ({
  organisationId,
  reference,
  description: 'Sale',
  occurredOn: '2026-10-21',
  postedByUserId: null,
  currency: 'SEK',
  lines: [
    { accountId: accounts[0], debitMinor: 12500n, creditMinor: 0n, memo: null },
    { accountId: accounts[1], debitMinor: 0n, creditMinor: 12500n, memo: null },
  ],
  ...extra,
});

describe('the ledger on the embedded database', { timeout: 60_000 }, () => {
  async function open() {
    const local = await openLocalDatabase({ migrationsFolder });
    const { organisationId } = await seedDemo(local.db);
    const cash = await local.repos.ledger.createAccount({
      organisationId,
      code: '1910',
      name: { 'en-GB': 'Cash' },
      type: 'asset',
    });
    const sales = await local.repos.ledger.createAccount({
      organisationId,
      code: '3010',
      name: { 'en-GB': 'Sales' },
      type: 'income',
    });
    return { local, organisationId, accounts: [cash.id, sales.id] as [string, string] };
  }

  it('takes the next reference when the one it was given is already in the book', async () => {
    const { local, organisationId, accounts } = await open();
    try {
      const reference = await local.repos.ledger.nextReference(organisationId);
      const first = await local.repos.ledger.post(entry(organisationId, reference, accounts));
      // A second posting that read the same "next" number before the first was written.
      const second = await local.repos.ledger.post(entry(organisationId, reference, accounts));

      expect(first.reference).toBe(reference);
      expect(second.reference).not.toBe(reference);
      expect(second.reference).toMatch(/^V\d{4}-\d{4}$/);
      expect(await local.repos.ledger.listEntries(organisationId, 10)).toHaveLength(2);
    } finally {
      await local.close();
    }
  });

  it('refuses a second reversal of the same entry, from inside the write, and keeps one', async () => {
    const { local, organisationId, accounts } = await open();
    try {
      const original = await local.repos.ledger.post(
        entry(organisationId, await local.repos.ledger.nextReference(organisationId), accounts),
      );
      const mirror = (reference: string) =>
        entry(organisationId, reference, [accounts[1], accounts[0]], {
          reversesEntryId: original.id,
        });

      const reversal = await local.repos.ledger.post(
        mirror(await local.repos.ledger.nextReference(organisationId)),
      );
      await expect(
        local.repos.ledger.post(mirror(await local.repos.ledger.nextReference(organisationId))),
      ).rejects.toBeInstanceOf(AlreadyReversed);

      expect(
        (await local.repos.ledger.findEntry(organisationId, original.id))?.reversedByEntryId,
      ).toBe(reversal.id);
      expect(await local.repos.ledger.listEntries(organisationId, 10)).toHaveLength(2);
    } finally {
      await local.close();
    }
  });

  it('tells the second revocation of a refresh token that it lost', async () => {
    const { local, organisationId } = await open();
    try {
      const [user] = await local.repos.users.list(organisationId);
      const token = await local.repos.tokens.createRefreshToken({
        userId: user!.id,
        familyId: crypto.randomUUID(),
        tokenHash: 'h'.repeat(64),
        rotatedFrom: null,
        userAgent: null,
        expiresAt: new Date(Date.now() + 60_000),
      });
      expect(await local.repos.tokens.revokeRefreshToken(token.id, new Date())).toBe(true);
      expect(await local.repos.tokens.revokeRefreshToken(token.id, new Date())).toBe(false);
    } finally {
      await local.close();
    }
  });
});
