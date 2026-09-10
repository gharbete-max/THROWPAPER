import { describe, expect, it } from 'vitest';
import { buildDemoState } from './dataset.js';

/**
 * What a demonstrable Paloppa contains.
 *
 * `CLAUDE.md` §Demo data makes this a contract rather than a nicety: a broken seed blocks demos,
 * and the way it breaks is never a crash. A feature ships, nothing seeds it, and the screen that
 * proves the feature opens empty in front of whoever is being shown the product. That happened to
 * the ledger — it merged with no demo data at all — so the shape of the demo is asserted here
 * rather than discovered live.
 */
describe('the demo dataset', () => {
  const state = buildDemoState();

  it.each([
    ['an organisation', () => state.organisations],
    ['users to sign in as', () => state.users],
    ['an event', () => state.events],
    ['forms', () => state.forms],
    ['registrations against them', () => state.submissions],
    ['a brand kit', () => state.brandKits],
    ['invoices', () => state.invoices],
    ['a ledger', () => state.ledgerAccounts],
    ['entries in that ledger', () => state.journalEntries],
  ])('has %s', (_what, get) => {
    expect(get().length).toBeGreaterThan(0);
  });

  /**
   * The one thing a ledger has to be.
   *
   * Seeding a book that does not balance would teach whoever is watching the demo that the numbers
   * do not tie — the single promise double-entry exists to make. It balances here because the
   * entries are posted from the invoices rather than written beside them, and this is what proves
   * that stayed true.
   */
  it('keeps the book in balance', () => {
    const debits = state.journalLines.reduce((sum, line) => sum + line.debitMinor, 0n);
    const credits = state.journalLines.reduce((sum, line) => sum + line.creditMinor, 0n);

    expect(debits).toBe(credits);
    expect(debits).toBeGreaterThan(0n);
  });

  /** Every entry on its own, too: a book can balance overall while an entry inside it does not. */
  it('keeps every entry in balance', () => {
    const unbalanced = state.journalEntries
      .filter((entry) => {
        const lines = state.journalLines.filter((line) => line.entryId === entry.id);
        const debits = lines.reduce((sum, line) => sum + line.debitMinor, 0n);
        const credits = lines.reduce((sum, line) => sum + line.creditMinor, 0n);
        return debits !== credits;
      })
      .map((entry) => entry.reference);

    expect(unbalanced).toEqual([]);
  });

  /**
   * The book and the invoices are the same money.
   *
   * What the tenants owe, receivable by receivable, is what the invoices say they owe. If those
   * two ever disagree the demo is showing a bookkeeping error, which is worse than showing nothing.
   */
  it('posts exactly what the invoices bill', () => {
    const receivable = state.ledgerAccounts.find((account) => account.code === '1510');
    expect(receivable).toBeTruthy();

    const posted = state.journalLines
      .filter((line) => line.accountId === receivable!.id)
      .reduce((sum, line) => sum + line.debitMinor - line.creditMinor, 0n);
    const billed = state.invoices.reduce((sum, invoice) => sum + invoice.totalMinor, 0n);

    expect(posted).toBe(billed);
  });

  /** Every journal line points at an account that exists, or the ledger screen renders blanks. */
  it('posts only to accounts it defined', () => {
    const ids = new Set(state.ledgerAccounts.map((account) => account.id));
    const orphans = state.journalLines.filter((line) => !ids.has(line.accountId));

    expect(orphans).toEqual([]);
  });

  /**
   * The invoice links in the demo have to be openable.
   *
   * `/i/:token` refuses anything that is not 32–64 hex characters, so a token the dataset invents
   * loosely gives a 400 on the one link somebody is most likely to click during a demo.
   */
  it('issues invoice tokens the public route will accept', () => {
    const bad = state.invoices
      .filter((invoice) => !/^[a-f0-9]{32,64}$/.test(invoice.publicToken))
      .map((invoice) => invoice.number);

    expect(bad).toEqual([]);
  });
});
