import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  adminUser,
  bearer,
  createTestHarness,
  operatorUser,
  signIn,
  type TestHarness,
} from '../test-support.js';

let harness: TestHarness;
let adminToken: string;
let operatorToken: string;

beforeEach(async () => {
  harness = await createTestHarness();
  adminToken = (await signIn(harness, adminUser.email)).accessToken;
  operatorToken = (await signIn(harness, operatorUser.email)).accessToken;
});

afterEach(async () => {
  await harness.close();
});

async function account(code: string, type: string, name = code) {
  const response = await harness.app.inject({
    method: 'POST',
    url: '/v1/ledger/accounts',
    headers: bearer(adminToken),
    payload: { code, type, name: { 'en-GB': name, 'sv-SE': name } },
  });
  return response.json().id as string;
}

/**
 * `async` with the await inside, rather than returning the chain.
 *
 * `app.inject()` returns an intersection of a promise and Fastify's chainable builder, and
 * awaiting *that* does not narrow to the response — so every caller that then reached for
 * `.json()` failed to typecheck while looking perfectly correct.
 */
async function post(payload: Record<string, unknown>, token = adminToken) {
  return await harness.app.inject({
    method: 'POST',
    url: '/v1/ledger/entries',
    headers: bearer(token),
    payload,
  });
}

/** A cash sale: money in, income recognised. The smallest honest entry there is. */
async function cashSale(amount = '12500') {
  const cash = await account('1910', 'asset', 'Cash');
  const sales = await account('3001', 'income', 'Sales');
  const posted = await post({
    description: 'Cash sale',
    occurredOn: '2026-03-31',
    currency: 'SEK',
    lines: [
      { accountId: cash, debitMinor: amount },
      { accountId: sales, creditMinor: amount },
    ],
  });
  return { cash, sales, posted };
}

describe('the chart of accounts', () => {
  it('creates an account and starts it at nought', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/ledger/accounts',
      headers: bearer(adminToken),
      payload: { code: '1910', type: 'asset', name: { 'en-GB': 'Cash' } },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().balanceMinor).toBe('0');
  });

  /** A duplicated code is a chart nobody can reconcile. */
  it('refuses a code that is already in use', async () => {
    await account('1910', 'asset');
    const clash = await harness.app.inject({
      method: 'POST',
      url: '/v1/ledger/accounts',
      headers: bearer(adminToken),
      payload: { code: '1910', type: 'asset', name: { 'en-GB': 'Cash again' } },
    });
    expect(clash.statusCode).toBe(409);
  });

  it('is an administrator’s job to add one', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/ledger/accounts',
      headers: bearer(operatorToken),
      payload: { code: '1910', type: 'asset', name: { 'en-GB': 'Cash' } },
    });
    expect(response.statusCode).toBe(403);
  });

  /**
   * Reported in the direction the account grows. A liability shown as negative because the raw
   * arithmetic came out that way is a number every reader has to correct in their head.
   */
  it('reports balances in the direction each account grows', async () => {
    await cashSale('12500');
    const accounts = (
      await harness.app.inject({
        method: 'GET',
        url: '/v1/ledger/accounts',
        headers: bearer(adminToken),
      })
    ).json().accounts;

    expect(accounts.find((a: { code: string }) => a.code === '1910').balanceMinor).toBe('12500');
    expect(accounts.find((a: { code: string }) => a.code === '3001').balanceMinor).toBe('12500');
  });
});

describe('posting an entry', () => {
  it('accepts a balanced entry and gives it a reference', async () => {
    const { posted } = await cashSale();
    expect(posted.statusCode).toBe(201);
    expect(posted.json().reference).toMatch(/^V\d{4}-0001$/);
    expect(posted.json().lines).toHaveLength(2);
  });

  it('numbers entries in sequence', async () => {
    const { cash, sales } = await cashSale();
    const second = await post({
      description: 'Another sale',
      occurredOn: '2026-04-01',
      currency: 'SEK',
      lines: [
        { accountId: cash, debitMinor: '500' },
        { accountId: sales, creditMinor: '500' },
      ],
    });
    expect(second.json().reference).toMatch(/-0002$/);
  });

  /** The rule the whole thing rests on. Out by one öre is still out. */
  it('refuses an entry that does not balance', async () => {
    const cash = await account('1910', 'asset');
    const sales = await account('3001', 'income');
    const response = await post({
      description: 'Wrong',
      occurredOn: '2026-03-31',
      currency: 'SEK',
      lines: [
        { accountId: cash, debitMinor: '12500' },
        { accountId: sales, creditMinor: '12499' },
      ],
    });
    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('entry-not-postable');
    expect(response.json().error.message).toMatch(/12500.*12499/);
  });

  it('refuses a line that is on both sides at once', async () => {
    const cash = await account('1910', 'asset');
    const sales = await account('3001', 'income');
    const response = await post({
      description: 'Both sides',
      occurredOn: '2026-03-31',
      currency: 'SEK',
      lines: [
        { accountId: cash, debitMinor: '100', creditMinor: '100' },
        { accountId: sales, creditMinor: '100' },
      ],
    });
    expect(response.statusCode).toBe(400);
  });

  it('refuses an entry with only one line', async () => {
    const cash = await account('1910', 'asset');
    const response = await post({
      description: 'One-sided',
      occurredOn: '2026-03-31',
      currency: 'SEK',
      lines: [{ accountId: cash, debitMinor: '100' }],
    });
    expect(response.statusCode).toBe(400);
  });

  it('refuses posting to an account that does not exist', async () => {
    const cash = await account('1910', 'asset');
    const response = await post({
      description: 'Ghost account',
      occurredOn: '2026-03-31',
      currency: 'SEK',
      lines: [
        { accountId: cash, debitMinor: '100' },
        { accountId: '44444444-4444-4444-8444-444444444444', creditMinor: '100' },
      ],
    });
    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('unknown-account');
  });

  /**
   * The reason amounts cross the wire as strings: this is larger than `Number.MAX_SAFE_INTEGER`,
   * and a JSON number would have arrived as something else.
   */
  it('is exact past the safe integer range', async () => {
    const huge = '9007199254740993';
    const { posted } = await cashSale(huge);
    expect(posted.statusCode).toBe(201);
    expect(posted.json().lines[0].debitMinor).toBe(huge);
  });

  it('keeps the whole book in trial balance', async () => {
    await cashSale();
    const listed = await harness.app.inject({
      method: 'GET',
      url: '/v1/ledger/entries',
      headers: bearer(adminToken),
    });
    expect(listed.json().trialBalance).toEqual({
      debitsMinor: '12500',
      creditsMinor: '12500',
      balanced: true,
    });
  });
});

describe('correcting a mistake', () => {
  /**
   * What "delete" means in a ledger. The original stays, marked as reversed; the correction
   * stays, marked as a reversal; and a reader in two years can see that a mistake was made and
   * what was done about it.
   */
  it('reverses by posting the mirror image and links the two', async () => {
    const { posted } = await cashSale();
    const original = posted.json();

    const reversal = await harness.app.inject({
      method: 'POST',
      url: `/v1/ledger/entries/${original.id}/reverse`,
      headers: bearer(adminToken),
      payload: { reason: 'Posted to the wrong account', occurredOn: '2026-04-02' },
    });
    expect(reversal.statusCode).toBe(201);

    // Sides swapped, amounts unchanged and still non-negative.
    const lines = reversal.json().lines;
    expect(lines[0].debitMinor).toBe('0');
    expect(lines[0].creditMinor).toBe('12500');
    expect(lines[1].debitMinor).toBe('12500');

    expect(reversal.json().reversesReference).toBe(original.reference);
  });

  it('marks the original as reversed, in both directions', async () => {
    const { posted } = await cashSale();
    const original = posted.json();
    const reversal = await harness.app.inject({
      method: 'POST',
      url: `/v1/ledger/entries/${original.id}/reverse`,
      headers: bearer(adminToken),
      payload: { reason: 'Wrong' },
    });

    const entries = (
      await harness.app.inject({
        method: 'GET',
        url: '/v1/ledger/entries',
        headers: bearer(adminToken),
      })
    ).json().entries;

    const stamped = entries.find((e: { id: string }) => e.id === original.id);
    expect(stamped.reversedByReference).toBe(reversal.json().reference);
  });

  /** Both entries stay. The book nets to nothing; it does not become empty. */
  it('leaves both entries in the book, netting to nothing', async () => {
    const { posted } = await cashSale();
    await harness.app.inject({
      method: 'POST',
      url: `/v1/ledger/entries/${posted.json().id}/reverse`,
      headers: bearer(adminToken),
      payload: { reason: 'Wrong' },
    });

    const listed = await harness.app.inject({
      method: 'GET',
      url: '/v1/ledger/entries',
      headers: bearer(adminToken),
    });
    expect(listed.json().entries).toHaveLength(2);

    const accounts = (
      await harness.app.inject({
        method: 'GET',
        url: '/v1/ledger/accounts',
        headers: bearer(adminToken),
      })
    ).json().accounts;
    expect(accounts.find((a: { code: string }) => a.code === '1910').balanceMinor).toBe('0');
  });

  /** Two corrections for one mistake is a book that no longer nets to what happened. */
  it('refuses to reverse the same entry twice', async () => {
    const { posted } = await cashSale();
    const id = posted.json().id;
    await harness.app.inject({
      method: 'POST',
      url: `/v1/ledger/entries/${id}/reverse`,
      headers: bearer(adminToken),
      payload: { reason: 'Wrong' },
    });
    const again = await harness.app.inject({
      method: 'POST',
      url: `/v1/ledger/entries/${id}/reverse`,
      headers: bearer(adminToken),
      payload: { reason: 'Wrong again' },
    });
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe('already-reversed');
  });
});

/**
 * The property that makes this a ledger rather than a spreadsheet that looks like one.
 *
 * Asserted against the **registered routes**, not against the source, so a route added anywhere —
 * a plugin, a later file, a merge that reintroduced one — fails here. A ledger you can edit is not
 * a ledger, and the failure mode is silent: everything keeps working and the audit trail is
 * quietly worthless.
 */
describe('what the ledger deliberately cannot do', () => {
  it('registers no route that changes or removes a posted entry', () => {
    const routes = harness.app
      .printRoutes({ commonPrefix: false })
      .split('\n')
      .filter((line) => line.includes('/v1/ledger'));

    const mutating = routes.filter((line) => /\b(PATCH|PUT|DELETE)\b/.test(line));
    expect(mutating, `a ledger is only ever appended to; found: ${mutating.join(' | ')}`).toEqual(
      [],
    );
  });

  /** And the interface behind it offers none either, so nothing internal can reach for one. */
  it('exposes no update or delete on the repository', () => {
    const source = readFileSync(new URL('../db/repositories/types.ts', import.meta.url), 'utf8');
    const block = /export interface LedgerRepository \{([\s\S]*?)\n\}/.exec(source)?.[1] ?? '';
    expect(block.length).toBeGreaterThan(100);
    expect(
      /\b(updateEntry|deleteEntry|removeEntry|editEntry|updateLine|deleteLine)\b/.test(block),
    ).toBe(false);
  });
});
