import { describe, expect, it } from 'vitest';
import { buildInvoice, ocrForInvoice } from './build.js';
import { isValidOcr } from './ocr.js';
import { CreateInvoice } from './api.js';

/**
 * A month's rent, built end to end.
 *
 * This is the case the whole subsystem exists for: a landlord, forty tenants, rent plus the extras
 * each tenant actually has. It is written as one worked example with the arithmetic done by hand in
 * the comments, because an invoice test that only checks the code agrees with itself would not have
 * caught a VAT rate applied to the rent line.
 */
const RENT: CreateInvoice = CreateInvoice.parse({
  currency: 'SEK',
  recipient: {
    name: 'Anna Lindqvist',
    email: 'anna@example.com',
    address: 'Storgatan 14, lgh 1201\n123 45 Stockholm',
    externalReference: '1201',
  },
  subject: { 'sv-SE': 'Hyra, oktober 2026', 'en-GB': 'Rent, October 2026' },
  periodStart: '2026-10-01',
  periodEnd: '2026-10-31',
  issuedOn: '2026-09-20',
  dueOn: '2026-09-30',
  payment: { method: 'bankgiro', account: '123-4567', ocrLengthControl: true },
  lines: [
    {
      description: { 'sv-SE': 'Hyra', 'en-GB': 'Rent' },
      quantity: '1000',
      unitAmount: '895000',
      vatRateBasisPoints: 0,
    },
    {
      description: { 'sv-SE': 'Kabel-TV', 'en-GB': 'Cable television' },
      quantity: '1000',
      unitAmount: '24900',
      vatRateBasisPoints: 2500,
    },
    {
      description: { 'sv-SE': 'Parkeringsplats', 'en-GB': 'Parking space' },
      quantity: '1000',
      unitAmount: '65000',
      vatRateBasisPoints: 2500,
    },
  ],
});

describe('building an invoice', () => {
  const invoice = buildInvoice({ number: 1042, publicToken: 'a'.repeat(32), request: RENT });

  it('totals the lines the way the tenant will', () => {
    // 8 950,00 + 249,00 + 650,00 = 9 849,00 net.
    expect(invoice.net).toBe('984900');
    // VAT on the two taxed lines only: 62,25 + 162,50 = 224,75.
    expect(invoice.vat).toBe('22475');
    expect(invoice.total).toBe('1007375');
  });

  it('leaves rent exempt rather than taxing it at the invoice level', () => {
    const rentLine = invoice.lines[0]!;
    expect(rentLine.vatAmount).toBe('0');
    expect(rentLine.amount).toBe('895000');
  });

  it('keeps each line total on the line, so the column adds up on the page', () => {
    const summed = invoice.lines.reduce((total, line) => total + BigInt(line.amount), 0n);
    expect(summed.toString()).toBe(invoice.net);

    const vat = invoice.lines.reduce((total, line) => total + BigInt(line.vatAmount), 0n);
    expect(vat.toString()).toBe(invoice.vat);
  });

  it('gives it a reference a bank will accept', () => {
    /*
     * Invoice 1042, padded to six digits, is base "001042". That is eight digits with the two
     * control digits, so the length digit is 8 and Luhn over "0010428" gives 1.
     *
     * Derived by hand and checked against a separate implementation, because the first version of
     * this expectation was simply wrong and the code was right — which is the failure mode a test
     * written from the implementation would never catch.
     */
    expect(invoice.ocr).toBe('00104281');
    expect(isValidOcr(invoice.ocr)).toBe(true);
  });

  it('keeps the lines in the order they were written', () => {
    expect(invoice.lines.map((line) => line.position)).toEqual([0, 1, 2]);
  });

  /**
   * The reference must not be the public link's token.
   *
   * An OCR is printed on the invoice, quoted on bank statements, and visible to everyone who
   * handles the payment. If it also opened the web page, every one of them could read the invoice.
   */
  it('does not use the payment reference as the link token', () => {
    expect(invoice.publicToken).not.toBe(invoice.ocr);
    expect(invoice.publicToken.length).toBeGreaterThanOrEqual(24);
  });
});

describe('the reference', () => {
  it('comes from the invoice number, so its uniqueness is the index’s', () => {
    const payment = { method: 'bankgiro' as const, account: '123-4567', ocrLengthControl: true };
    expect(ocrForInvoice(1042, payment)).toBe('00104281');
    // A different number is a different reference, which is the only property that has to hold.
    expect(ocrForInvoice(1043, payment)).not.toBe(ocrForInvoice(1042, payment));
  });

  it('follows the giro agreement rather than a preference', () => {
    const withLength = ocrForInvoice(1042, {
      method: 'bankgiro',
      account: '1',
      ocrLengthControl: true,
    });
    const without = ocrForInvoice(1042, {
      method: 'bankgiro',
      account: '1',
      ocrLengthControl: false,
    });

    expect(withLength).toHaveLength(8);
    expect(without).toHaveLength(7);
    expect(isValidOcr(without, { lengthControl: false })).toBe(true);
  });

  /**
   * Every reference an organisation can issue has to be well formed, not just the ones in the demo.
   *
   * Invoice numbers run from 1 upward for years, and the reference has to stay valid across that
   * whole range rather than only where somebody happened to test it.
   */
  it('is valid for every invoice number up to a very long-lived organisation', () => {
    const payment = { method: 'bankgiro' as const, account: '1', ocrLengthControl: true };
    for (const number of [1, 9, 10, 99, 100, 4321, 99_999, 1_000_000, 999_999_999]) {
      const reference = ocrForInvoice(number, payment);
      expect(isValidOcr(reference), `${number} produced ${reference}`).toBe(true);
    }
  });

  /**
   * The bug this padding fixed: an organisation's first invoice.
   *
   * Unpadded, number 1 is a one-digit base and a three-digit reference, which `buildOcr` refuses as
   * too short to be worth a check digit. The very first invoice anybody issued would have failed,
   * and only the first few — so it would have passed any test that started counting at a hundred.
   */
  it('issues a reference for invoice number one', () => {
    const payment = { method: 'bankgiro' as const, account: '1', ocrLengthControl: true };
    expect(ocrForInvoice(1, payment)).toBe('00000182');
    expect(isValidOcr(ocrForInvoice(1, payment))).toBe(true);
  });

  it('refuses a number that is not one an invoice could have', () => {
    const payment = { method: 'bankgiro' as const, account: '1', ocrLengthControl: true };
    expect(() => ocrForInvoice(0, payment)).toThrow(RangeError);
    expect(() => ocrForInvoice(-1, payment)).toThrow(RangeError);
  });
});

describe('the schema', () => {
  it('refuses an invoice with no lines', () => {
    expect(() => CreateInvoice.parse({ ...RENT, lines: [] })).toThrow();
  });

  it('refuses an amount that is not whole minor units', () => {
    expect(() =>
      CreateInvoice.parse({
        ...RENT,
        lines: [{ ...RENT.lines[0]!, unitAmount: '8950.00' }],
      }),
    ).toThrow();
  });
});
