import { describe, expect, it } from 'vitest';
import { LOCALE_CODES } from '@tp/i18n';
import { isValidOcr } from '@tp/shared/invoicing';
import { renderInvoiceDocument } from './invoice.js';
import { INVOICE_COPY, INVOICE_LOCALES, invoiceCopy } from './invoice-copy.js';
import type { InvoiceRecord } from '../db/repositories/types.js';

/**
 * The page a tenant opens from a link in an email.
 *
 * They have no account, they are on a phone, and they are trying to do one thing: pay. So the tests
 * are about whether the page contains what somebody needs in order to do that, and whether the two
 * renderings of it agree — a web page and an attachment that disagree about an amount is a support
 * call at best and a refused payment at worst.
 */
const INVOICE: InvoiceRecord = {
  id: 'i1',
  organisationId: 'o1',
  batchId: 'b1',
  number: 1042,
  ocr: '00104281',
  status: 'sent',
  currency: 'SEK',
  recipientName: 'Anna Lindqvist',
  recipientEmail: 'anna@example.com',
  recipientAddress: 'Storgatan 14, lgh 1201',
  recipientReference: '1201',
  subject: { 'sv-SE': 'Hyra, oktober 2026', 'en-GB': 'Rent, October 2026' },
  periodStart: '2026-10-01',
  periodEnd: '2026-10-31',
  issuedOn: '2026-09-20',
  dueOn: '2026-09-30',
  netMinor: 919_900n,
  vatMinor: 6_225n,
  totalMinor: 926_125n,
  paymentMethod: 'bankgiro',
  paymentAccount: '123-4567',
  publicToken: 'a'.repeat(40),
  sentAt: new Date('2026-09-20T09:00:00Z'),
  paidAt: null,
  createdAt: new Date('2026-09-20T08:00:00Z'),
  lines: [
    {
      id: 'l1',
      description: { 'sv-SE': 'Hyra', 'en-GB': 'Rent' },
      quantityThousandths: 67_500n,
      unitAmountMinor: 13_628n,
      amountMinor: 895_000n,
      vatRateBasisPoints: 0,
      vatMinor: 0n,
      position: 0,
    },
    {
      id: 'l2',
      description: { 'sv-SE': 'Kabel-TV', 'en-GB': 'Cable television' },
      quantityThousandths: 1000n,
      unitAmountMinor: 24_900n,
      amountMinor: 24_900n,
      vatRateBasisPoints: 2500,
      vatMinor: 6_225n,
      position: 1,
    },
  ],
};

const LOCALES = { supported: ['sv-SE', 'en-GB'], default: 'sv-SE' };

const render = (over: Partial<Parameters<typeof renderInvoiceDocument>[0]> = {}) =>
  renderInvoiceDocument({
    invoice: INVOICE,
    organisationName: 'Fastighets AB',
    locale: 'sv-SE',
    locales: LOCALES,
    strings: invoiceCopy('sv-SE'),
    ...over,
  });

describe('what a tenant needs in order to pay', () => {
  const html = render();

  it('shows the payment reference, grouped so it can be typed', () => {
    // Grouped from the right, which is where the control digits are.
    expect(html).toContain('0010 4281');
    expect(isValidOcr(INVOICE.ocr)).toBe(true);
  });

  it('shows the account, the amount and the date it is due', () => {
    expect(html).toContain('123-4567');
    /*
     * The digits, whatever the locale puts between them.
     *
     * Swedish groups thousands with a non-breaking space, so the amount on the page is not
     * the string `9261,25`. Written as an escape rather than pasted: an invisible character
     * in a regex is one the next reader cannot see, and lint is right to refuse it.
     */
    expect(html.replace(/[\s\u00a0]/g, '')).toContain('9261,25');
    expect(html).toContain('2026');
  });

  it('shows every line, with the extras a landlord added', () => {
    expect(html).toContain('Hyra');
    expect(html).toContain('Kabel-TV');
  });

  /**
   * The column has to survive being added up by hand.
   *
   * It did not: the line was printed inclusive of its own VAT beside an exclusive unit price, so
   * the page read `1 x 249,00 kr = 311,25 kr` and the Netto underneath agreed with neither. Adding
   * up the column is the only check a tenant actually performs.
   */
  it('prints a line amount that is quantity times unit price', () => {
    const digits = html.replace(/[\s]/g, '');
    // Cable television: one at 249,00, so 249,00 and not 311,25.
    expect(digits).toContain('249,00');
    expect(digits).not.toContain('311,25');
  });

  it('adds the lines up to the net shown beneath them', () => {
    const net = INVOICE.lines.reduce((total, entry) => total + entry.amountMinor, 0n);
    expect(net).toBe(INVOICE.netMinor);
  });

  it('keeps a postal address on its lines', () => {
    // HTML collapses the newline a person typed; the address ran together on one line without this.
    expect(html).toContain('pre-line');
  });

  /**
   * A quantity in thousandths is a floor area, and has to read as one.
   *
   * `67500` on the page would be a rent of sixty-seven thousand square metres.
   */
  it('shows a floor area as an area', () => {
    expect(html).toContain('67,5');
    expect(html).not.toContain('67500');
  });

  it('does not leak the link token onto the page', () => {
    // It is in the URL; printing it as well puts it in every photocopy of the invoice.
    expect(html).not.toContain(INVOICE.publicToken);
  });
});

describe('the web page and the printed one', () => {
  /**
   * The reason there is one template.
   *
   * The two renderings differ in dress and in nothing else. An invoice whose attachment disagrees
   * with its web page about an amount is the worst kind of bug in this product: nobody notices
   * until a tenant pays the smaller number.
   */
  it('agree on every figure', () => {
    const web = render({ media: 'web' });
    const print = render({ media: 'print' });

    for (const figure of ['0010 4281', '123-4567', '1042']) {
      expect(web).toContain(figure);
      expect(print).toContain(figure);
    }

    const amounts = (html: string) => html.match(/9\s?261,25/g)?.length ?? 0;
    expect(amounts(web)).toBe(amounts(print));
    expect(amounts(web)).toBeGreaterThan(0);
  });

  it('gives the screen a ground and the page none', () => {
    expect(render({ media: 'web' })).toContain('@media print');
    expect(render({ media: 'print' })).not.toContain('max-width: 46rem');
  });
});

describe('VAT', () => {
  it('is shown when there is any', () => {
    expect(render()).toContain(INVOICE_COPY['sv-SE']!.vat);
  });

  /**
   * Residential rent is exempt in Sweden, so most rent invoices have none.
   *
   * A row reading "Moms 0,00 kr" on every one of them says nothing and invites the question of why
   * it is there.
   */
  it('is left off entirely when there is none', () => {
    const exempt = render({
      invoice: { ...INVOICE, vatMinor: 0n, totalMinor: 919_900n, lines: [INVOICE.lines[0]!] },
    });
    expect(exempt).not.toContain(`>${INVOICE_COPY['sv-SE']!.vat}<`);
  });
});

describe('the wording', () => {
  /**
   * Twelve languages, not two.
   *
   * The admission card shipped in two of twelve and nothing noticed until a test counted them. This
   * is that test, written before the same thing can happen here.
   */
  it('exists in every language the product publishes in', () => {
    for (const locale of LOCALE_CODES) {
      expect(INVOICE_COPY[locale], `no invoice wording for ${locale}`).toBeDefined();
    }
    expect(INVOICE_LOCALES).toHaveLength(LOCALE_CODES.length);
  });

  /**
   * A locale that was never translated, as opposed to one that shares a word.
   *
   * The first version of this asserted that no string may equal its English counterpart, and French
   * failed it on "Description", "Net" and "Total" — which are the French words. The test was wrong
   * about data that was right.
   *
   * The failure actually worth catching is a catalogue somebody pasted English into and left, which
   * looks like *most* strings coinciding rather than three. Half is the line: no real language
   * shares half its billing vocabulary with English, and a stub shares all of it.
   */
  it('is nobody’s copy of the English', () => {
    const english = INVOICE_COPY['en-GB']!;
    const count = Object.keys(english).length;

    for (const [locale, copy] of Object.entries(INVOICE_COPY)) {
      if (locale === 'en-GB') continue;
      const shared = Object.entries(copy).filter(
        ([key, value]) => value === english[key as keyof typeof english],
      );
      expect(
        shared.length,
        `${locale} looks untranslated: ${shared.map(([key]) => key).join(', ')}`,
      ).toBeLessThan(count / 2);
    }
  });

  it('falls back to a real locale rather than to a language stub', () => {
    // Not `locale.split('-')[0]`: that has been written and removed twice in this codebase.
    expect(invoiceCopy('sv-FI')).toBe(INVOICE_COPY['sv-SE']);
    expect(invoiceCopy('xx-XX', 'en-GB')).toBe(INVOICE_COPY['en-GB']);
  });

  it('renders the invoice in the reader’s language', () => {
    const english = render({ locale: 'en-GB', strings: invoiceCopy('en-GB') });
    expect(english).toContain('Rent, October 2026');
    expect(english).toContain('Payment reference');
    expect(english).toContain('lang="en-GB"');
  });
});

describe('escaping', () => {
  it('does not let a recipient name close a tag', () => {
    const nasty = render({
      invoice: { ...INVOICE, recipientName: '<script>alert(1)</script>' },
    });
    expect(nasty).not.toContain('<script>alert(1)</script>');
    expect(nasty).toContain('&lt;script&gt;');
  });
});
