/**
 * Synthetic supplier invoices, written for this repository: invented companies, invented numbers,
 * no copyrighted layout and no real person or account. Each is a list of text items placed on an
 * A4 page (fractions of its width and height, y down) with the values a correct reading must find.
 *
 * The same item list is drawn three ways, so each reader is tested on the thing it reads:
 * - {@link layoutWords}: the words with boxes, for the pure rules (`packages/shared/src/payable`);
 * - {@link invoicePdf}: a PDF with a text layer, for the PDF path (`apps/forms/.../payable`);
 * - {@link invoiceHtml}: a page to screenshot into an image, for optical reading (`e2e/invoice-scan.spec.ts`).
 *
 * Account numbers are valid by their own check digits (the references and bankgiro were made with
 * Luhn and ISO 11649; the IBANs are the registry's published examples) unless the fixture's name
 * says it is wrong on purpose. No dependencies, so any test can import it.
 */

export interface Item {
  text: string;
  x: number;
  y: number;
  /** Height of the text as a fraction of the page's height. */
  size?: number;
  bold?: boolean;
}

export interface Expected {
  /** Minor units (öre, cent) as a decimal string. */
  total: string;
  currency: string;
  dueDate: string;
  bank: { method: 'bankgiro' | 'plusgiro' | 'iban'; account: string };
  reference: { kind: 'ocr' | 'rf'; value: string; check: 'passed' | 'failed' };
  vat?: string;
}

export interface InvoiceFixture {
  name: string;
  locale: 'sv-SE' | 'da-DK' | 'de-DE' | 'en-GB';
  items: Item[];
  expected: Expected;
}

const BODY = 0.0145;
const t = (text: string, x: number, y: number, size = BODY, bold = false): Item => ({
  text,
  x,
  y,
  size,
  bold,
});

/** A row of a table: label at the left, the figure at the right edge of its column. */
const row = (label: string, figure: string, y: number, x = 0.5): Item[] => [
  t(label, x, y),
  t(figure, 0.8, y),
];

export const svStandard: InvoiceFixture = {
  name: 'sv-standard',
  locale: 'sv-SE',
  items: [
    t('Nordisk Testbolag AB', 0.08, 0.06, 0.022, true),
    t('Faktura', 0.08, 0.1, 0.03, true),
    t('Fakturadatum', 0.08, 0.15),
    t('2026-10-31', 0.28, 0.15),
    t('Förfallodatum', 0.55, 0.15),
    t('2026-11-30', 0.75, 0.15),
    t('Fakturanummer 114', 0.08, 0.18),
    t('Beskrivning', 0.08, 0.24, BODY, true),
    t('Antal', 0.5, 0.24, BODY, true),
    t('Belopp', 0.8, 0.24, BODY, true),
    t('Konsulttjänst oktober', 0.08, 0.27),
    t('10', 0.5, 0.27),
    t('10 000,00', 0.8, 0.27),
    t('Material', 0.08, 0.3),
    t('1', 0.5, 0.3),
    t('2 000,00', 0.8, 0.3),
    ...row('Summa exkl. moms', '12 000,00', 0.58),
    ...row('Moms 25 %', '3 000,00', 0.61),
    ...row('Totalt', '15 000,00', 0.64),
    t('Att betala SEK', 0.5, 0.69, 0.018, true),
    t('15 000,00', 0.8, 0.69, 0.018, true),
    t('Bankgiro 123-4566', 0.08, 0.8),
    t('OCR-nummer 202611497', 0.08, 0.83),
  ],
  expected: {
    total: '1500000',
    currency: 'SEK',
    dueDate: '2026-11-30',
    bank: { method: 'bankgiro', account: '123-4566' },
    reference: { kind: 'ocr', value: '202611497', check: 'passed' },
    vat: '300000',
  },
};

/** The same invoice with the last digit of its reference changed: its check digit must fail. */
export const svWrongReference: InvoiceFixture = {
  ...svStandard,
  name: 'sv-wrong-reference',
  items: svStandard.items.map((item) =>
    item.text === 'OCR-nummer 202611497' ? { ...item, text: 'OCR-nummer 202611498' } : item,
  ),
  expected: {
    ...svStandard.expected,
    reference: { kind: 'ocr', value: '202611498', check: 'failed' },
  },
};

/** Headings over their figures, a plusgiro, "kr" for the currency, the date spelt out. */
export const svStacked: InvoiceFixture = {
  name: 'sv-stacked',
  locale: 'sv-SE',
  items: [
    t('Lindgrens Provbyrå', 0.08, 0.06, 0.022, true),
    t('Faktura', 0.08, 0.1, 0.03, true),
    t('Förfallodatum', 0.08, 0.2),
    t('30 november 2026', 0.08, 0.225, 0.018),
    t('Att betala', 0.5, 0.2),
    t('1 250,00 kr', 0.5, 0.225, 0.018, true),
    t('varav moms 250,00', 0.5, 0.26),
    t('Plusgiro 12 34 56-6', 0.08, 0.4),
    t('Betalningsreferens 4417 66', 0.08, 0.43),
    t('Er referens: Anna Test', 0.08, 0.46),
  ],
  expected: {
    total: '125000',
    currency: 'SEK',
    dueDate: '2026-11-30',
    bank: { method: 'plusgiro', account: '123456-6' },
    reference: { kind: 'ocr', value: '441766', check: 'passed' },
    vat: '25000',
  },
};

export const daStandard: InvoiceFixture = {
  name: 'da-standard',
  locale: 'da-DK',
  items: [
    t('Nordlys Prøve ApS', 0.08, 0.06, 0.022, true),
    t('Faktura', 0.08, 0.1, 0.03, true),
    t('Fakturadato 31. oktober 2026', 0.08, 0.15),
    t('Forfaldsdato 30. november 2026', 0.08, 0.18),
    t('Jeres reference: Maria Test', 0.08, 0.21),
    ...row('Nettobeløb', '6.730,20', 0.58),
    ...row('Moms 25 %', '1.682,55', 0.61),
    t('Beløb at betale DKK', 0.4, 0.66, 0.018, true),
    t('8.412,75', 0.8, 0.66, 0.018, true),
    t('IBAN DK50 0040 0440 1162 43', 0.08, 0.78),
    t('SWIFT DABADKKK', 0.08, 0.81),
    t('Betalingsreference RF70 2026 1142', 0.08, 0.84),
  ],
  expected: {
    total: '841275',
    currency: 'DKK',
    dueDate: '2026-11-30',
    bank: { method: 'iban', account: 'DK50 0040 0440 1162 43' },
    reference: { kind: 'rf', value: 'RF70 2026 1142', check: 'passed' },
    vat: '168255',
  },
};

export const deStandard: InvoiceFixture = {
  name: 'de-standard',
  locale: 'de-DE',
  items: [
    t('Beispiel Handels GmbH', 0.08, 0.06, 0.022, true),
    t('Rechnung', 0.08, 0.1, 0.03, true),
    t('Rechnungsdatum 31.10.2026', 0.08, 0.15),
    t('Zahlungsziel 30 Tage', 0.08, 0.18),
    t('Fällig am 30.11.2026', 0.08, 0.21),
    ...row('Zwischensumme', '19.705,88', 0.58),
    ...row('MwSt 19 %', '3.744,12', 0.61),
    t('Rechnungsbetrag EUR', 0.4, 0.66, 0.018, true),
    t('23.450,00', 0.8, 0.66, 0.018, true),
    t('IBAN DE89 3704 0044 0532 0130 00', 0.08, 0.78),
    t('BIC COBADEFFXXX', 0.08, 0.81),
    t('Verwendungszweck RF56 5390 0754 70', 0.08, 0.84),
  ],
  expected: {
    total: '2345000',
    currency: 'EUR',
    dueDate: '2026-11-30',
    bank: { method: 'iban', account: 'DE89 3704 0044 0532 0130 00' },
    reference: { kind: 'rf', value: 'RF56 5390 0754 70', check: 'passed' },
    vat: '374412',
  },
};

export const enStandard: InvoiceFixture = {
  name: 'en-standard',
  locale: 'en-GB',
  items: [
    t('Example Supplies Ltd', 0.08, 0.06, 0.022, true),
    t('Invoice', 0.08, 0.1, 0.03, true),
    t('Invoice date: 31 October 2026', 0.08, 0.15),
    t('Due date: November 30, 2026', 0.08, 0.18),
    ...row('Subtotal', '1,029.80', 0.58),
    ...row('VAT (20%)', '205.96', 0.61),
    ...row('Total', '1,235.76', 0.64),
    t('Amount due GBP', 0.4, 0.69, 0.018, true),
    t('1,235.76', 0.8, 0.69, 0.018, true),
    t('Pay by bank transfer', 0.08, 0.78),
    t('IBAN GB82 WEST 1234 5698 7654 32', 0.08, 0.81),
    t('Payment reference: RF09 INV2 0260 19', 0.08, 0.84),
  ],
  expected: {
    total: '123576',
    currency: 'GBP',
    dueDate: '2026-11-30',
    bank: { method: 'iban', account: 'GB82 WEST 1234 5698 7654 32' },
    reference: { kind: 'rf', value: 'RF09 INV2 0260 19', check: 'passed' },
    vat: '20596',
  },
};

export const fixtures: InvoiceFixture[] = [svStandard, svStacked, daStandard, deStandard, enStandard];

// -- the three drawings ------------------------------------------------------------------------

/** Width and height of the drawn page, in pixels: A4 at 150 dpi. */
export const PAGE_PX = { width: 1240, height: 1754 } as const;

/** The items as words with boxes — what optical reading or a text layer hands the rules. */
export function layoutWords(fixture: InvoiceFixture, confidence = 95) {
  const aspect = PAGE_PX.height / PAGE_PX.width;
  return fixture.items.flatMap((item) => {
    const size = item.size ?? BODY;
    const char = size * 0.5 * aspect; // an average character, as a fraction of the width
    let x = item.x;
    return item.text.split(' ').map((text) => {
      const word = {
        page: 1,
        text,
        x0: x,
        y0: item.y,
        x1: x + text.length * char,
        y1: item.y + size,
        confidence,
      };
      x += (text.length + 1) * char;
      return word;
    });
  });
}

/** A page of absolutely placed text, to screenshot at {@link PAGE_PX}. */
export function invoiceHtml(fixture: InvoiceFixture): string {
  const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const spans = fixture.items
    .map((item) => {
      const px = Math.round((item.size ?? BODY) * PAGE_PX.height * 1.15);
      return `<span style="position:absolute;left:${item.x * 100}%;top:${item.y * 100}%;font-size:${px}px;white-space:pre;${item.bold ? 'font-weight:bold' : ''}">${escape(item.text)}</span>`;
    })
    .join('');
  return `<!doctype html><html lang="${fixture.locale}"><body style="margin:0;background:#fff;color:#000;font-family:Arial,Helvetica,sans-serif"><div style="position:relative;width:${PAGE_PX.width}px;height:${PAGE_PX.height}px">${spans}</div></body></html>`;
}

/**
 * A one-page A4 PDF with a text layer, written by hand (no PDF library), as a latin-1 string:
 * `Buffer.from(invoicePdf(f), 'latin1')`. Helvetica in WinAnsi covers å ä ö ø æ ü ß; nothing here
 * needs a character outside it.
 */
export function invoicePdf(fixture: InvoiceFixture): string {
  const escape = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`);
  const content = fixture.items
    .map((item) => {
      const size = (item.size ?? BODY) * 842;
      const y = 842 - item.y * 842 - size * 0.8;
      const font = item.bold ? '/F2' : '/F1';
      return `BT ${font} ${size.toFixed(2)} Tf 1 0 0 1 ${(item.x * 595).toFixed(2)} ${y.toFixed(2)} Tm (${escape(item.text)}) Tj ET`;
    })
    .join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
  ];
  let body = '%PDF-1.7\n';
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) body += `${String(offset).padStart(10, '0')} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return body;
}
