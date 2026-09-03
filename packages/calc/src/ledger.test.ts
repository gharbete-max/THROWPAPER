import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_TYPES,
  accountBalance,
  balanceOf,
  debitIncreases,
  isPostable,
  lineProblems,
  reversalOf,
  trialBalance,
  type LedgerLine,
} from './ledger.js';

const line = (accountId: string, debit: bigint, credit: bigint): LedgerLine => ({
  accountId,
  debitMinor: debit,
  creditMinor: credit,
});

/** A cash sale: money in, income recognised. The smallest honest entry there is. */
const sale: LedgerLine[] = [line('cash', 12500n, 0n), line('sales', 0n, 12500n)];

describe('what makes an entry postable', () => {
  it('accepts a balanced entry', () => {
    expect(lineProblems(sale)).toEqual([]);
    expect(isPostable(sale)).toBe(true);
  });

  it('refuses an entry with nothing in it', () => {
    expect(lineProblems([])).toEqual([{ code: 'no-lines' }]);
  });

  /** The rule the whole thing rests on. Out by one öre is still out. */
  it('refuses an entry that does not balance', () => {
    const problems = lineProblems([line('cash', 12500n, 0n), line('sales', 0n, 12499n)]);
    expect(problems).toContainEqual({ code: 'unbalanced', debits: 12500n, credits: 12499n });
  });

  /**
   * A line carries one side. Both would make "credit 50" and "debit −50" two spellings of the
   * same fact, and a book where one fact has two spellings cannot be summed with confidence.
   */
  it('refuses a line that is on both sides at once', () => {
    const problems = lineProblems([line('cash', 100n, 100n), line('sales', 0n, 0n)]);
    expect(problems).toContainEqual({ code: 'line-both-sides', index: 0 });
  });

  it('refuses a line that is on neither side', () => {
    expect(lineProblems([line('cash', 100n, 0n), line('sales', 0n, 0n)])).toContainEqual({
      code: 'line-empty',
      index: 1,
    });
  });

  it('refuses a negative amount', () => {
    expect(lineProblems([line('cash', -100n, 0n), line('sales', 0n, -100n)])).toContainEqual({
      code: 'line-negative',
      index: 0,
    });
  });

  /**
   * All the faults, not the first one. An entry is corrected by a person at a screen, and being
   * told one fault at a time is how a five-line entry takes five attempts.
   */
  it('reports every problem at once', () => {
    const problems = lineProblems([line('a', -1n, 0n), line('b', 5n, 5n), line('c', 0n, 0n)]);
    // The imbalance is reported alongside the per-line faults rather than instead of them: a
    // person fixing this needs to see all four, and three of them are what caused the fourth.
    expect(problems.map((problem) => problem.code).sort()).toEqual([
      'line-both-sides',
      'line-empty',
      'line-negative',
      'unbalanced',
    ]);
  });

  it('is exact far past the safe integer range', () => {
    const huge = 9007199254740993n;
    expect(isPostable([line('a', huge, 0n), line('b', 0n, huge)])).toBe(true);
    expect(isPostable([line('a', huge, 0n), line('b', 0n, huge - 1n)])).toBe(false);
  });
});

describe('the sign convention', () => {
  /**
   * A debit increases an asset and decreases a liability. Not a house style — it falls out of
   * assets = liabilities + equity, so it is data here rather than an `if` somebody gets backwards.
   */
  it('has debits increase assets and expenses, and credits the rest', () => {
    expect(debitIncreases('asset')).toBe(true);
    expect(debitIncreases('expense')).toBe(true);
    expect(debitIncreases('liability')).toBe(false);
    expect(debitIncreases('equity')).toBe(false);
    expect(debitIncreases('income')).toBe(false);
  });

  it('answers for every account type there is', () => {
    for (const type of ACCOUNT_TYPES) expect(typeof debitIncreases(type)).toBe('boolean');
  });

  /**
   * Reported in the direction the account naturally grows. A liability shown as negative because
   * the raw arithmetic came out that way is a number every reader has to correct in their head.
   */
  it('reports a balance in the direction the account grows', () => {
    expect(accountBalance('asset', { debits: 500n, credits: 200n })).toBe(300n);
    expect(accountBalance('liability', { debits: 200n, credits: 500n })).toBe(300n);
    expect(accountBalance('income', { debits: 0n, credits: 12500n })).toBe(12500n);
  });
});

describe('reversing', () => {
  /**
   * Swapped, not negated. A negative debit is not a thing, and any report summing the debit
   * column would quietly under-count it.
   */
  it('swaps the sides rather than negating the amounts', () => {
    const reversal = reversalOf(sale);
    expect(reversal).toEqual([
      { accountId: 'cash', debitMinor: 0n, creditMinor: 12500n },
      { accountId: 'sales', debitMinor: 12500n, creditMinor: 0n },
    ]);
    expect(reversal.every((l) => l.debitMinor >= 0n && l.creditMinor >= 0n)).toBe(true);
  });

  it('produces something that is itself postable', () => {
    expect(isPostable(reversalOf(sale))).toBe(true);
  });

  /** The original and its reversal together leave the book exactly where it started. */
  it('leaves no net effect once both are posted', () => {
    const both = [...sale, ...reversalOf(sale)];
    const cash = both.filter((l) => l.accountId === 'cash');
    expect(accountBalance('asset', balanceOf(cash))).toBe(0n);
  });

  it('reversing twice returns the original', () => {
    expect(reversalOf(reversalOf(sale))).toEqual(sale);
  });

  it('carries a line memo through', () => {
    const withMemo: LedgerLine[] = [
      { accountId: 'cash', debitMinor: 100n, creditMinor: 0n, memo: 'till float' },
      { accountId: 'sales', debitMinor: 0n, creditMinor: 100n },
    ];
    expect(reversalOf(withMemo)[0]?.memo).toBe('till float');
    expect(reversalOf(withMemo)[1]).not.toHaveProperty('memo');
  });
});

describe('the trial balance', () => {
  /**
   * Every entry balances alone, so the whole book must too. That makes this a check of the
   * *storage* rather than the arithmetic: it is how a half-written entry or a dropped row is found.
   */
  it('balances when every entry did', () => {
    expect(trialBalance([...sale, ...reversalOf(sale)]).balanced).toBe(true);
  });

  it('does not balance when a row has gone missing', () => {
    const missingOne = sale.slice(0, 1);
    expect(trialBalance(missingOne).balanced).toBe(false);
  });

  it('balances an empty book', () => {
    expect(trialBalance([])).toEqual({ debits: 0n, credits: 0n, balanced: true });
  });
});

/**
 * The property that makes this a ledger rather than a spreadsheet that looks like one.
 *
 * There is no `update` and no `delete` — not guarded, not admin-only, **absent**. A capability
 * that does not exist cannot be reached by a bug, a migration, or somebody in a hurry. This test
 * reads the module's own exports so that adding one is a failure here rather than a discovery
 * later.
 */
describe('the shape of the module', () => {
  it('offers no way to change or remove a posted entry', async () => {
    const module = await import('./ledger.js');
    const forbidden = Object.keys(module).filter((name) =>
      /^(update|edit|delete|remove|amend|patch|set)/i.test(name),
    );
    expect(forbidden, `a ledger must only ever be appended to, found: ${forbidden}`).toEqual([]);
  });
});
