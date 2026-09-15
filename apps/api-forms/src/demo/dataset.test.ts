import { describe, expect, it } from 'vitest';
import { forms as formSchemas } from '@tp/shared';
import { buildDemoState, DEMO_DEFINITION } from './dataset.js';
import { partySizeOf } from '../checkin/service.js';

/**
 * What a demonstrable Loppa contains.
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

  /**
   * The seed and the schema, held against each other.
   *
   * This is the way a seed actually rots: the definition gains a field type or a rule, the seeded
   * answers keep the old shape, and nothing notices until a demo opens a form whose answers it
   * refuses to show. Parsing the definition and validating every seeded answer against it is the
   * cheapest possible version of the check, and it runs in milliseconds.
   */
  describe('the demo form and the answers seeded against it', () => {
    const definition = formSchemas.FormDefinition.parse(DEMO_DEFINITION);

    it('is a form the product would let you publish', () => {
      expect(formSchemas.definitionProblems(definition)).toEqual([]);
    });

    it('is fully translated into both languages it claims', () => {
      const completeness = formSchemas.definitionCompleteness(definition, ['sv-SE', 'en-GB']);
      expect(completeness.filter((locale) => !locale.complete)).toEqual([]);
    });

    it('seeds answers the validator accepts', () => {
      const rejected = state.submissions
        .map((submission) => ({
          reference: submission.reference,
          result: formSchemas.validateSubmission(
            definition,
            submission.data as formSchemas.SubmissionValues,
          ),
        }))
        .filter((entry) => !entry.result.ok)
        .map((entry) => `${entry.reference}: ${entry.result.issues.map((i) => i.key).join(', ')}`);

      expect(rejected).toEqual([]);
    });
  });

  /**
   * Guests, which is the feature the demo exists to show off and the one most easily seeded flat.
   *
   * `CLAUDE.md` §Demo data does not list guests by name, but it does say the seed must leave the
   * product "fully demonstrable" — and a repeating block that admits people demonstrates nothing
   * if every seeded registration is a party of one.
   */
  describe('the guests it brings', () => {
    const definition = formSchemas.FormDefinition.parse(DEMO_DEFINITION);
    const group = formSchemas.admittingGroup(definition);

    it('has exactly one block that admits its entries', () => {
      expect(group?.key).toBe('guests');
      expect(group?.admitNameKey).toBe('guest_name');
    });

    it('seeds registrations that actually bring somebody', () => {
      const parties = state.submissions.map(
        (submission) => partySizeOf(DEMO_DEFINITION, submission) - 1,
      );

      // Some bring nobody, some bring one, some bring two: all three states are on screen.
      expect(parties.filter((guests) => guests === 0).length).toBeGreaterThan(0);
      expect(parties.filter((guests) => guests === 1).length).toBeGreaterThan(0);
      expect(parties.filter((guests) => guests === 2).length).toBeGreaterThan(0);
    });

    it('expects more people than registrations, which is the whole point', () => {
      const people = state.submissions.reduce(
        (total, submission) => total + partySizeOf(DEMO_DEFINITION, submission),
        0,
      );
      expect(people).toBeGreaterThan(state.submissions.length);
    });

    /** A door screen with two rows called "Alva Öberg" is what per-entry names exist to prevent. */
    it('never names a guest after the person who brought them', () => {
      const clashes = state.submissions.filter((submission) => {
        const entries = submission.data['guests'];
        if (!Array.isArray(entries)) return false;
        return entries.some(
          (entry) =>
            (entry as Record<string, unknown>)['guest_name'] === submission.data['full_name'],
        );
      });

      expect(clashes).toEqual([]);
    });
  });
});
