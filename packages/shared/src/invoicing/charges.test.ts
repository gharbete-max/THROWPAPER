import { describe, expect, it } from 'vitest';
import { ChargeResolutionError, resolveCharges, type ChargeType } from './charges.js';
import { invoiceTotals } from './totals.js';

/**
 * A landlord's own list of costs, and what a tenant is actually on.
 *
 * Nothing here knows what any of these charges are. "Rent" and "Cable television" are rows a
 * landlord typed, not concepts in the code — which is the point, because the next customer bills
 * for moorings, or lessons, or a share of a heating bill.
 */
const CATALOGUE: ChargeType[] = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    name: { 'sv-SE': 'Hyra', 'en-GB': 'Rent' },
    defaultUnitAmount: '0',
    vatRateBasisPoints: 0,
    archived: false,
    position: 0,
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    name: { 'sv-SE': 'Kabel-TV', 'en-GB': 'Cable television' },
    defaultUnitAmount: '24900',
    vatRateBasisPoints: 2500,
    archived: false,
    position: 1,
  },
  {
    id: '33333333-3333-4333-8333-333333333333',
    name: { 'sv-SE': 'Förråd', 'en-GB': 'Storage' },
    defaultUnitAmount: '15000',
    vatRateBasisPoints: 2500,
    archived: true,
    position: 2,
  },
];

const RENT = CATALOGUE[0]!.id;
const CABLE = CATALOGUE[1]!.id;
const RETIRED = CATALOGUE[2]!.id;

describe('a standing arrangement', () => {
  it('takes the recipient’s own figure where they have one', () => {
    const lines = resolveCharges(
      [{ chargeTypeId: RENT, unitAmount: '895000', quantity: '1000', position: 0 }],
      CATALOGUE,
    );

    expect(lines).toHaveLength(1);
    expect(lines[0]!.unitAmount).toBe('895000');
    expect(lines[0]!.description).toEqual({ 'sv-SE': 'Hyra', 'en-GB': 'Rent' });
  });

  /**
   * The reason an amount may be left unset: one edit instead of forty.
   *
   * The tenant is on cable television without a figure, so the catalogue decides. Raising it raises
   * everybody on it, which is the feature and also the risk — and it can never reach an invoice
   * that has already been issued, because invoices copy their lines.
   */
  it('falls back to the catalogue where the recipient has none', () => {
    const lines = resolveCharges(
      [{ chargeTypeId: CABLE, quantity: '1000', position: 0 }],
      CATALOGUE,
    );
    expect(lines[0]!.unitAmount).toBe('24900');
    expect(lines[0]!.vatRateBasisPoints).toBe(2500);
  });

  it('keeps the order the arrangement was written in', () => {
    const lines = resolveCharges(
      [
        { chargeTypeId: CABLE, quantity: '1000', position: 1 },
        { chargeTypeId: RENT, unitAmount: '895000', quantity: '1000', position: 0 },
      ],
      CATALOGUE,
    );
    expect(lines.map((line) => line.description['en-GB'])).toEqual(['Rent', 'Cable television']);
  });

  /**
   * A retired charge still attached to somebody stops the run.
   *
   * Skipping it would produce an invoice that is quietly short: the tenant will not query a bill
   * that is too low and the landlord will not notice until the year is reconciled. Stopping is a
   * problem somebody fixes in a minute.
   */
  it('refuses to issue an invoice that is quietly short', () => {
    expect(() =>
      resolveCharges([{ chargeTypeId: RETIRED, quantity: '1000', position: 0 }], CATALOGUE),
    ).toThrow(ChargeResolutionError);
  });

  it('refuses a charge that does not exist rather than dropping the line', () => {
    expect(() =>
      resolveCharges(
        [{ chargeTypeId: '44444444-4444-4444-8444-444444444444', quantity: '1000', position: 0 }],
        CATALOGUE,
      ),
    ).toThrow(ChargeResolutionError);
  });
});

describe('a one-off charge', () => {
  /**
   * Billed once, without being added to the catalogue first.
   *
   * Making somebody define "Replacement key, 350 kr" as a permanent charge type before they can
   * bill it once is the ceremony that makes people keep a spreadsheet beside the system.
   */
  it('goes on the invoice without becoming a charge type', () => {
    const lines = resolveCharges(
      [{ chargeTypeId: RENT, unitAmount: '895000', quantity: '1000', position: 0 }],
      CATALOGUE,
      [
        {
          description: { 'sv-SE': 'Ny nyckel', 'en-GB': 'Replacement key' },
          unitAmount: '35000',
          quantity: '1000',
          vatRateBasisPoints: 2500,
        },
      ],
    );

    expect(lines).toHaveLength(2);
    expect(lines[1]!.description['en-GB']).toBe('Replacement key');
  });

  it('comes after the standing charges, where a reader expects an extra', () => {
    const lines = resolveCharges(
      [{ chargeTypeId: CABLE, quantity: '1000', position: 5 }],
      CATALOGUE,
      [
        {
          description: { 'en-GB': 'Repair' },
          unitAmount: '50000',
          quantity: '1000',
          vatRateBasisPoints: 2500,
        },
      ],
    );
    expect(lines.at(-1)!.description['en-GB']).toBe('Repair');
  });
});

describe('a month of rent for one tenant', () => {
  /** The whole point, end to end: an arrangement plus one extra, priced. */
  it('adds up', () => {
    const lines = resolveCharges(
      [
        { chargeTypeId: RENT, unitAmount: '895000', quantity: '1000', position: 0 },
        { chargeTypeId: CABLE, quantity: '1000', position: 1 },
      ],
      CATALOGUE,
      [
        {
          description: { 'en-GB': 'Replacement key' },
          unitAmount: '35000',
          quantity: '1000',
          vatRateBasisPoints: 2500,
        },
      ],
    );

    const totals = invoiceTotals(lines);
    // 8 950,00 rent + 249,00 cable + 350,00 key = 9 549,00 net.
    expect(totals.net).toBe(954_900n);
    // VAT on the two taxed lines only: 62,25 + 87,50 = 149,75. Rent stays exempt.
    expect(totals.vat).toBe(14_975n);
    expect(totals.total).toBe(969_875n);
  });
});
