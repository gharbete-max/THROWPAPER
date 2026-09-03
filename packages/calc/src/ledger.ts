import { sumMinor } from './money.js';

/**
 * Double-entry bookkeeping, as rules rather than as a table.
 *
 * ## The one rule everything else follows from
 *
 * **A posted entry is never edited and never deleted.** If it is wrong, it is corrected by
 * posting another entry that reverses it, and both stay in the book for ever. That is what a
 * ledger *is* — the paper version is a bound book written in ink, and a mistake is struck through
 * with the correction written beside it, precisely so that anyone reading later can see that a
 * mistake was made and what was done about it.
 *
 * Software that lets you edit a posted entry is not keeping a ledger; it is keeping a spreadsheet
 * that looks like one. The difference only shows up when somebody needs to answer "what did this
 * say in March" — by which point the answer is gone.
 *
 * So there is no `update` and no `delete` anywhere in this module or in the repository behind it.
 * Not "guarded", not "admin only" — absent. A capability that does not exist cannot be reached by
 * a bug, a migration script, or somebody in a hurry.
 *
 * ## The other rule
 *
 * **Debits equal credits, exactly, in every entry.** Not "should"; an entry that does not balance
 * is not an entry and cannot be constructed. {@link balanceOf} is the only judge, and the API,
 * the database write and the tests all ask it rather than each doing the arithmetic themselves.
 */

/**
 * What kind of account this is, which is what decides the sign of "more".
 *
 * A debit increases an asset and decreases a liability. That is not a convention anybody is free
 * to change — it falls out of the accounting equation (assets = liabilities + equity) — so it
 * lives here as data rather than as an `if` somebody might get backwards.
 */
export const ACCOUNT_TYPES = ['asset', 'liability', 'equity', 'income', 'expense'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

/** Whether a debit increases this kind of account. The whole of the sign convention, in one map. */
const DEBIT_INCREASES: Record<AccountType, boolean> = {
  asset: true,
  expense: true,
  liability: false,
  equity: false,
  income: false,
};

export function debitIncreases(type: AccountType): boolean {
  return DEBIT_INCREASES[type];
}

/**
 * One side of one entry.
 *
 * A line carries **either** a debit or a credit, never both and never neither. Storing a single
 * signed amount instead would be smaller and is what a spreadsheet does; it also makes "credit
 * 50" and "debit −50" two spellings of the same row, and a book where the same fact has two
 * spellings is a book that cannot be summed with confidence.
 */
export interface LedgerLine {
  accountId: string;
  /** Minor units, non-negative. Exactly one of these is greater than zero. */
  debitMinor: bigint;
  creditMinor: bigint;
  /** Optional per-line note. The entry's own description usually says enough. */
  memo?: string;
}

export type LineProblem =
  | { code: 'no-lines' }
  | { code: 'line-negative'; index: number }
  | { code: 'line-both-sides'; index: number }
  | { code: 'line-empty'; index: number }
  | { code: 'unbalanced'; debits: bigint; credits: bigint };

/**
 * Everything wrong with a set of lines, or an empty array.
 *
 * Returns all the problems rather than the first, because an entry is corrected by a person
 * looking at a screen, and being told about one fault at a time is how a five-line entry takes
 * five attempts.
 */
export function lineProblems(lines: readonly LedgerLine[]): LineProblem[] {
  const problems: LineProblem[] = [];

  // A one-sided entry is not an entry; nor is an empty one. Both are worth their own message,
  // because "add a line" and "the two sides do not match" are different things to be told.
  if (lines.length === 0) return [{ code: 'no-lines' }];

  lines.forEach((line, index) => {
    if (line.debitMinor < 0n || line.creditMinor < 0n) {
      problems.push({ code: 'line-negative', index });
      return;
    }
    const hasDebit = line.debitMinor > 0n;
    const hasCredit = line.creditMinor > 0n;
    if (hasDebit && hasCredit) problems.push({ code: 'line-both-sides', index });
    else if (!hasDebit && !hasCredit) problems.push({ code: 'line-empty', index });
  });

  const debits = sumMinor(lines.map((line) => line.debitMinor));
  const credits = sumMinor(lines.map((line) => line.creditMinor));
  if (debits !== credits) problems.push({ code: 'unbalanced', debits, credits });

  return problems;
}

export function balanceOf(lines: readonly LedgerLine[]): { debits: bigint; credits: bigint } {
  return {
    debits: sumMinor(lines.map((line) => line.debitMinor)),
    credits: sumMinor(lines.map((line) => line.creditMinor)),
  };
}

/** Nothing wrong with it. The only gate an entry passes through before it is written. */
export function isPostable(lines: readonly LedgerLine[]): boolean {
  return lineProblems(lines).length === 0;
}

/**
 * The lines that undo an entry: the same accounts and amounts, with the sides swapped.
 *
 * Swapped rather than negated. A reversal made of negative debits would balance arithmetically and
 * would be wrong as bookkeeping — a negative debit is not a thing, and any report that sums the
 * debit column would quietly under-count. Swapping keeps every amount non-negative, which is the
 * invariant the rest of this module relies on.
 *
 * The result is a *proposal*: the caller posts it as a new entry pointing back at the original.
 * Nothing here mutates anything, because nothing in a ledger does.
 */
export function reversalOf(lines: readonly LedgerLine[]): LedgerLine[] {
  return lines.map((line) => ({
    accountId: line.accountId,
    debitMinor: line.creditMinor,
    creditMinor: line.debitMinor,
    ...(line.memo === undefined ? {} : { memo: line.memo }),
  }));
}

/**
 * What an account is worth, given its type.
 *
 * Returned as a **signed** amount in the direction that account naturally grows: an asset with
 * more debits than credits is positive, and so is a liability with more credits than debits. A
 * report that showed liabilities as negative because the raw arithmetic came out that way is a
 * report every reader has to mentally correct, every time.
 */
export function accountBalance(
  type: AccountType,
  totals: { debits: bigint; credits: bigint },
): bigint {
  return debitIncreases(type) ? totals.debits - totals.credits : totals.credits - totals.debits;
}

/**
 * Does the whole book balance?
 *
 * Every entry balances on its own, so the sum of them all must too — which makes this a check of
 * the *storage*, not of the arithmetic: it is how you find a half-written entry, a lost row, or a
 * migration that dropped something. Cheap, and worth running wherever the whole book is loaded.
 */
export function trialBalance(lines: readonly LedgerLine[]): {
  debits: bigint;
  credits: bigint;
  balanced: boolean;
} {
  const { debits, credits } = balanceOf(lines);
  return { debits, credits, balanced: debits === credits };
}
