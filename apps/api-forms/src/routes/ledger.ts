import { z } from 'zod';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { api, ledger as ledgerSchemas } from '@tp/shared';
import { accountBalance, isPostable, lineProblems, reversalOf, trialBalance } from '@tp/calc';
import type { LedgerLine } from '@tp/calc';
import type { AuthGuardDeps } from '../auth/plugin.js';
import { requireAuth } from '../auth/plugin.js';
import type { JournalEntryWithLines, Repositories } from '../db/repositories/index.js';
import { recordAudit } from '../audit.js';

/**
 * The ledger over HTTP.
 *
 * ## What is not here
 *
 * There is no `PATCH` and no `DELETE` on an entry or a line. Not commented out, not behind a role
 * check — **absent**. A posted entry is corrected by posting a reversing one, and both stay in the
 * book for ever. `ledger-routes.test.ts` asserts that by walking the registered routes, so adding
 * one is a failing test rather than a discovery six months later.
 *
 * An *account* can be archived, which is an update — but an account is a label on a shelf, not a
 * record of something that happened, and it cannot be deleted either once entries reference it.
 *
 * ## Amounts
 *
 * Strings of minor units on the wire, bigint everywhere inside. The conversion happens exactly
 * twice — here on the way in, here on the way out — so nothing in between has to remember.
 */
export function registerLedgerRoutes(
  app: FastifyInstance,
  deps: { repos: Repositories; guard: AuthGuardDeps },
): void {
  const authenticated = requireAuth(deps.guard);
  const adminOnly = requireAuth(deps.guard, ['admin']);

  const errorResponses = {
    401: api.ErrorResponse,
    403: api.ErrorResponse,
    404: api.ErrorResponse,
    409: api.ErrorResponse,
    422: api.ErrorResponse,
  } as const;

  const IdParam = z.object({ id: z.string().uuid() });

  app.get('/v1/ledger/accounts', {
    preHandler: authenticated,
    schema: {
      tags: ['ledger'],
      response: { 200: ledgerSchemas.LedgerAccountListResponse, ...errorResponses },
    },
    handler: async (request, reply) => {
      const auth = request.auth;
      if (!auth) return unauthenticated(reply);

      const [accounts, lines] = await Promise.all([
        deps.repos.ledger.listAccounts(auth.organisation.id),
        deps.repos.ledger.allLines(auth.organisation.id),
      ]);

      // Totalled once over every line rather than once per account: a chart of two hundred
      // accounts would otherwise be two hundred passes over the same rows.
      const totals = new Map<string, { debits: bigint; credits: bigint }>();
      for (const line of lines) {
        const running = totals.get(line.accountId) ?? { debits: 0n, credits: 0n };
        running.debits += line.debitMinor;
        running.credits += line.creditMinor;
        totals.set(line.accountId, running);
      }

      return reply.send({
        accounts: accounts.map((account) => ({
          id: account.id,
          code: account.code,
          name: account.name,
          type: account.type,
          archived: account.archivedAt !== null,
          balanceMinor: accountBalance(
            account.type,
            totals.get(account.id) ?? { debits: 0n, credits: 0n },
          ).toString(),
        })),
      });
    },
  });

  /** Adding an account to the chart is an administrator's job; posting to it is not. */
  app.post('/v1/ledger/accounts', {
    preHandler: adminOnly,
    schema: {
      tags: ['ledger'],
      body: ledgerSchemas.CreateLedgerAccount,
      response: { 201: ledgerSchemas.LedgerAccountResponse, ...errorResponses },
    },
    handler: async (request, reply) => {
      const auth = request.auth;
      if (!auth) return unauthenticated(reply);
      const body = ledgerSchemas.CreateLedgerAccount.parse(request.body);

      const existing = await deps.repos.ledger.listAccounts(auth.organisation.id);
      if (existing.some((account) => account.code === body.code)) {
        return reply.code(409).send({
          error: { code: 'code-taken', message: 'An account already has that code' },
        });
      }

      const account = await deps.repos.ledger.createAccount({
        organisationId: auth.organisation.id,
        code: body.code,
        name: body.name,
        type: body.type,
      });

      await recordAudit(deps.repos, request, {
        action: 'ledger.account_created',
        entityType: 'ledger_account',
        entityId: account.id,
        after: account,
      });

      // A new account has no entries, so its balance is nought. That is arithmetic, not a guess.
      return reply.code(201).send({
        id: account.id,
        code: account.code,
        name: account.name,
        type: account.type,
        archived: false,
        balanceMinor: '0',
      });
    },
  });

  app.get('/v1/ledger/entries', {
    preHandler: authenticated,
    schema: {
      tags: ['ledger'],
      querystring: z.object({ limit: z.coerce.number().int().min(1).max(500).default(100) }),
      response: { 200: ledgerSchemas.JournalEntryListResponse, ...errorResponses },
    },
    handler: async (request, reply) => {
      const auth = request.auth;
      if (!auth) return unauthenticated(reply);
      const { limit } = z
        .object({ limit: z.coerce.number().int().min(1).max(500).default(100) })
        .parse(request.query);

      const [entries, accounts, people, allLines] = await Promise.all([
        deps.repos.ledger.listEntries(auth.organisation.id, limit),
        deps.repos.ledger.listAccounts(auth.organisation.id),
        deps.repos.users.list(auth.organisation.id),
        deps.repos.ledger.allLines(auth.organisation.id),
      ]);

      const totals = trialBalance(
        allLines.map((line) => ({
          accountId: line.accountId,
          debitMinor: line.debitMinor,
          creditMinor: line.creditMinor,
        })),
      );

      return reply.send({
        entries: await Promise.all(
          entries.map((entry) => toEntryResponse(deps.repos, entry, accounts, people)),
        ),
        trialBalance: {
          debitsMinor: totals.debits.toString(),
          creditsMinor: totals.credits.toString(),
          balanced: totals.balanced,
        },
      });
    },
  });

  /**
   * Post an entry. The only way a row enters the book.
   *
   * The balance check is `packages/calc`'s, not this file's — the API, the database constraint and
   * the tests all ask the same function rather than each doing the arithmetic, which is how three
   * copies of a rule come to disagree.
   */
  app.post('/v1/ledger/entries', {
    preHandler: authenticated,
    schema: {
      tags: ['ledger'],
      body: ledgerSchemas.PostJournalEntry,
      response: { 201: ledgerSchemas.JournalEntryResponse, ...errorResponses },
    },
    handler: async (request, reply) => {
      const auth = request.auth;
      if (!auth) return unauthenticated(reply);
      const body = ledgerSchemas.PostJournalEntry.parse(request.body);

      const accounts = await deps.repos.ledger.listAccounts(auth.organisation.id);
      const byId = new Map(accounts.map((account) => [account.id, account]));

      // An account from another organisation, or one that has been retired, is refused before any
      // arithmetic — posting to a shelf that is not there is not an imbalance, it is a mistake.
      for (const line of body.lines) {
        const account = byId.get(line.accountId);
        if (!account) {
          return reply.code(422).send({
            error: { code: 'unknown-account', message: 'That account does not exist' },
          });
        }
        if (account.archivedAt) {
          return reply.code(422).send({
            error: { code: 'account-archived', message: `Account ${account.code} is retired` },
          });
        }
      }

      const lines: LedgerLine[] = body.lines.map((line) => ({
        accountId: line.accountId,
        debitMinor: BigInt(line.debitMinor),
        creditMinor: BigInt(line.creditMinor),
        ...(line.memo === undefined ? {} : { memo: line.memo }),
      }));

      const problems = lineProblems(lines);
      if (problems.length > 0) {
        return reply.code(422).send({
          error: {
            code: 'entry-not-postable',
            message: describe(problems),
            fields: Object.fromEntries(problems.map((problem, at) => [String(at), [problem.code]])),
          },
        });
      }

      const entry = await deps.repos.ledger.post({
        organisationId: auth.organisation.id,
        reference: await deps.repos.ledger.nextReference(auth.organisation.id),
        description: body.description,
        occurredOn: body.occurredOn,
        postedByUserId: auth.user.id,
        currency: body.currency,
        lines: lines.map((line) => ({
          accountId: line.accountId,
          debitMinor: line.debitMinor,
          creditMinor: line.creditMinor,
          memo: line.memo ?? null,
        })),
      });

      await recordAudit(deps.repos, request, {
        action: 'ledger.entry_posted',
        entityType: 'journal_entry',
        entityId: entry.id,
        after: { reference: entry.reference, description: entry.description },
      });

      const people = await deps.repos.users.list(auth.organisation.id);
      return reply.code(201).send(await toEntryResponse(deps.repos, entry, accounts, people));
    },
  });

  /**
   * Reverse an entry: post its mirror image and link the two.
   *
   * This is what "delete" means in a ledger, and the difference matters. The original stays,
   * marked as reversed; the correction stays, marked as a reversal; and a reader in two years can
   * see that a mistake was made and what was done about it. A delete would leave them with a gap
   * and no way to know there had ever been anything in it.
   *
   * The lines are derived from the original, never supplied — see `ReverseJournalEntry`.
   */
  app.post('/v1/ledger/entries/:id/reverse', {
    preHandler: authenticated,
    schema: {
      tags: ['ledger'],
      params: IdParam,
      body: ledgerSchemas.ReverseJournalEntry,
      response: { 201: ledgerSchemas.JournalEntryResponse, ...errorResponses },
    },
    handler: async (request, reply) => {
      const auth = request.auth;
      if (!auth) return unauthenticated(reply);
      const { id } = IdParam.parse(request.params);
      const body = ledgerSchemas.ReverseJournalEntry.parse(request.body);

      const original = await deps.repos.ledger.findEntry(auth.organisation.id, id);
      if (!original) return notFound(reply);

      // Reversing twice would leave two corrections for one mistake and a book that no longer
      // nets to what happened. The existing reversal is the answer to "undo this".
      if (original.reversedByEntryId) {
        return reply.code(409).send({
          error: { code: 'already-reversed', message: 'That entry has already been reversed' },
        });
      }

      const lines = reversalOf(
        original.lines.map((line) => ({
          accountId: line.accountId,
          debitMinor: line.debitMinor,
          creditMinor: line.creditMinor,
          ...(line.memo === null ? {} : { memo: line.memo }),
        })),
      );

      // Derived from something already posted, so it balances by construction. Checked anyway:
      // the assertion costs nothing and the alternative is trusting that it stayed true.
      if (!isPostable(lines)) {
        return reply.code(422).send({
          error: { code: 'entry-not-postable', message: 'The reversal does not balance' },
        });
      }

      const entry = await deps.repos.ledger.post({
        organisationId: auth.organisation.id,
        reference: await deps.repos.ledger.nextReference(auth.organisation.id),
        description: body.reason,
        occurredOn: body.occurredOn ?? new Date().toISOString().slice(0, 10),
        postedByUserId: auth.user.id,
        currency: original.currency,
        reversesEntryId: original.id,
        lines: lines.map((line) => ({
          accountId: line.accountId,
          debitMinor: line.debitMinor,
          creditMinor: line.creditMinor,
          memo: line.memo ?? null,
        })),
      });

      await recordAudit(deps.repos, request, {
        action: 'ledger.entry_reversed',
        entityType: 'journal_entry',
        entityId: original.id,
        after: { reversedBy: entry.reference, reason: body.reason },
      });

      const [accounts, people] = await Promise.all([
        deps.repos.ledger.listAccounts(auth.organisation.id),
        deps.repos.users.list(auth.organisation.id),
      ]);
      return reply.code(201).send(await toEntryResponse(deps.repos, entry, accounts, people));
    },
  });
}

/** The lines' accounts named, and the reversal links resolved to references a person can read. */
async function toEntryResponse(
  repos: Repositories,
  entry: JournalEntryWithLines,
  accounts: Array<{ id: string; code: string; name: Record<string, string> }>,
  people: Array<{ id: string; name: string }>,
): Promise<ledgerSchemas.JournalEntryResponse> {
  const byId = new Map(accounts.map((account) => [account.id, account]));
  const names = new Map(people.map((person) => [person.id, person.name]));

  const related = async (id: string | null) =>
    id ? ((await repos.ledger.findEntry(entry.organisationId, id))?.reference ?? null) : null;

  return {
    id: entry.id,
    reference: entry.reference,
    description: entry.description,
    occurredOn: entry.occurredOn,
    postedAt: entry.postedAt.toISOString(),
    postedByName: entry.postedByUserId ? (names.get(entry.postedByUserId) ?? null) : null,
    currency: entry.currency,
    lines: entry.lines.map((line) => ({
      accountId: line.accountId,
      accountCode: byId.get(line.accountId)?.code ?? '',
      accountName: byId.get(line.accountId)?.name ?? {},
      debitMinor: line.debitMinor.toString(),
      creditMinor: line.creditMinor.toString(),
      memo: line.memo,
    })),
    reversesEntryId: entry.reversesEntryId,
    reversesReference: await related(entry.reversesEntryId),
    reversedByEntryId: entry.reversedByEntryId,
    reversedByReference: await related(entry.reversedByEntryId),
  };
}

/** One sentence naming every fault, so a five-line entry does not take five attempts to fix. */
function describe(problems: ReturnType<typeof lineProblems>): string {
  return problems
    .map((problem) => {
      switch (problem.code) {
        case 'no-lines':
          return 'The entry has no lines';
        case 'unbalanced':
          return `Debits (${problem.debits}) do not equal credits (${problem.credits})`;
        case 'line-negative':
          return `Line ${problem.index + 1} has a negative amount`;
        case 'line-both-sides':
          return `Line ${problem.index + 1} is on both sides at once`;
        case 'line-empty':
          return `Line ${problem.index + 1} has no amount`;
      }
    })
    .join('; ');
}

function notFound(reply: FastifyReply) {
  return reply.code(404).send({ error: { code: 'not-found', message: 'No such entry' } });
}

function unauthenticated(reply: FastifyReply) {
  return reply.code(401).send({ error: { code: 'unauthorised', message: 'Not signed in' } });
}
