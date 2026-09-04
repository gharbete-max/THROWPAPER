import { defaultTokens, type TokenSet } from '@tp/tokens';
// The print compiler is its own entry point, the way the admission card imports it.
import { toPrintCss } from '@tp/tokens/pdf';
import { formatMinor, formatOcr } from '@tp/shared/invoicing';
import { pickText, type LocaleConfig } from '@tp/i18n';
import type { InvoiceRecord } from '../db/repositories/types.js';

/**
 * The invoice a tenant reads, and the PDF they are sent.
 *
 * ## One template for both
 *
 * The same function produces the web page and the document the renderer prints. That is the point
 * rather than a convenience: an invoice whose web page disagrees with its attachment about an
 * amount is a support call at best, and a tenant refusing to pay the larger of two numbers at
 * worst. There is one document; `media` decides how it is dressed.
 *
 * ## Why it is server-rendered HTML and not an app screen
 *
 * The reader is a tenant on a phone, following a link from an email, possibly on a bad connection,
 * probably once. They have no account and nothing to interact with. A page that arrives finished,
 * prints correctly from the browser, and needs no JavaScript is simply the right shape for that —
 * and it is the same shape the admission card already uses.
 *
 * ## What is on it
 *
 * What somebody needs in order to pay: who is asking, what for, the period, every line with its own
 * amount, the total, and the payment reference set out so it can be typed into a bank without
 * losing your place. The OCR is the most important thing on the page and is treated that way.
 */

export type InvoiceMedia = 'web' | 'print';

export interface InvoiceStrings {
  readonly invoice: string;
  readonly issuedOn: string;
  readonly dueOn: string;
  readonly period: string;
  readonly reference: string;
  readonly payTo: string;
  readonly description: string;
  readonly quantity: string;
  readonly unitPrice: string;
  readonly amount: string;
  readonly net: string;
  readonly vat: string;
  readonly total: string;
  readonly toPay: string;
  readonly settled: string;
}

export interface InvoiceDocumentInput {
  readonly invoice: InvoiceRecord;
  readonly organisationName: string;
  readonly locale: string;
  readonly locales: LocaleConfig;
  readonly strings: InvoiceStrings;
  readonly tokens?: TokenSet;
  readonly media?: InvoiceMedia;
}

/** Thousandths back to something a person reads: `67500` is `67,5`. */
function formatQuantity(thousandths: bigint, locale: string): string {
  const whole = thousandths / 1000n;
  const fraction = thousandths % 1000n;
  if (fraction === 0n) return new Intl.NumberFormat(locale).format(Number(whole));

  const decimal = `${whole}.${fraction.toString().padStart(3, '0').replace(/0+$/, '')}`;
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 3 }).format(Number(decimal));
}

function formatDate(value: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(
    new Date(`${value}T00:00:00Z`),
  );
}

export function renderInvoiceDocument(input: InvoiceDocumentInput): string {
  const { invoice, organisationName, locale, locales, strings } = input;
  const tokens = input.tokens ?? defaultTokens;
  const media = input.media ?? 'web';

  const money = (amount: bigint) => formatMinor(amount, invoice.currency, locale);
  const subject = pickText(locales, invoice.subject, locale).value;

  const lines = invoice.lines
    .map(
      (line) => `
      <tr>
        <td>${escapeHtml(pickText(locales, line.description, locale).value)}</td>
        <td class="num">${escapeHtml(formatQuantity(line.quantityThousandths, locale))}</td>
        <td class="num">${escapeHtml(money(line.unitAmountMinor))}</td>
        <td class="num">${escapeHtml(money(line.amountMinor + line.vatMinor))}</td>
      </tr>`,
    )
    .join('');

  const period =
    invoice.periodStart && invoice.periodEnd
      ? `<div><dt>${escapeHtml(strings.period)}</dt><dd>${escapeHtml(
          `${formatDate(invoice.periodStart, locale)} – ${formatDate(invoice.periodEnd, locale)}`,
        )}</dd></div>`
      : '';

  /*
   * VAT is shown only when there is any.
   *
   * Residential rent is exempt in Sweden, so a row reading "VAT 0,00 kr" on every rent invoice is a
   * line that says nothing and invites the question of why it is there.
   */
  const vatRow =
    invoice.vatMinor > 0n
      ? `<div class="totals__row"><span>${escapeHtml(strings.vat)}</span><span>${escapeHtml(
          money(invoice.vatMinor),
        )}</span></div>`
      : '';

  return `<!doctype html>
<html lang="${escapeHtml(locale)}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(subject)} — ${escapeHtml(organisationName)}</title>
<style>
${toPrintCss(tokens, { header: '', footer: '' })}

${media === 'web' ? WEB_CSS(tokens) : ''}

.invoice__head { display: flex; justify-content: space-between; gap: 24px; flex-wrap: wrap; }
.invoice__who { max-width: 24rem; }
.invoice__meta dl { display: grid; gap: 10px; margin: 0; }
.invoice__meta dt {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: ${tokens.colour.muted};
  margin: 0;
}
.invoice__meta dd { margin: 2px 0 0 0; font-size: 15px; }

table { width: 100%; border-collapse: collapse; margin-top: 28px; }
th {
  text-align: left;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: ${tokens.colour.muted};
  border-bottom: 1px solid ${tokens.colour.border};
  padding: 0 0 8px;
}
td { padding: 10px 0; border-bottom: 1px solid ${tokens.colour.border}; font-size: 15px; }
/* Amounts line up on their last digit, which is the only way a column of money can be scanned. */
.num { text-align: right; font-variant-numeric: tabular-nums; }

.totals { margin-top: 20px; margin-left: auto; max-width: 20rem; }
.totals__row { display: flex; justify-content: space-between; padding: 6px 0; font-size: 15px; }
.totals__row--total {
  border-top: 2px solid ${tokens.colour.text};
  margin-top: 6px;
  padding-top: 10px;
  font-size: 20px;
  font-weight: ${tokens.typography.weightBold};
}

/*
 * The payment block is the reason the page exists.
 *
 * Everything above it explains the number; this is what somebody copies into their bank. It gets a
 * ground of its own and the reference gets the largest type on the page after the total.
 */
.pay {
  margin-top: 32px;
  padding: 20px;
  border: 2px solid ${tokens.colour.text};
  border-radius: 4px;
}
.pay__grid { display: flex; gap: 32px; flex-wrap: wrap; }
.pay__label {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: ${tokens.colour.muted};
}
.pay__value {
  font-size: 22px;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.04em;
  margin-top: 2px;
}
.settled {
  margin-top: 16px;
  padding: 10px 14px;
  border-radius: 4px;
  background: ${tokens.colour.success};
  color: ${tokens.colour.background};
  font-weight: ${tokens.typography.weightBold};
}
</style>
</head>
<body>
<main class="invoice">
  <header class="invoice__head">
    <div class="invoice__who">
      <p class="tp-muted">${escapeHtml(strings.invoice)}</p>
      <h1>${escapeHtml(subject)}</h1>
      <p>${escapeHtml(organisationName)}</p>
      <p class="tp-muted">${escapeHtml(invoice.recipientName)}${
        invoice.recipientAddress ? `<br />${escapeHtml(invoice.recipientAddress)}` : ''
      }</p>
    </div>

    <div class="invoice__meta">
      <dl>
        <div><dt>${escapeHtml(strings.invoice)}</dt><dd>${invoice.number}</dd></div>
        <div><dt>${escapeHtml(strings.issuedOn)}</dt><dd>${escapeHtml(
          formatDate(invoice.issuedOn, locale),
        )}</dd></div>
        <div><dt>${escapeHtml(strings.dueOn)}</dt><dd>${escapeHtml(
          formatDate(invoice.dueOn, locale),
        )}</dd></div>
        ${period}
      </dl>
    </div>
  </header>

  <table>
    <thead>
      <tr>
        <th>${escapeHtml(strings.description)}</th>
        <th class="num">${escapeHtml(strings.quantity)}</th>
        <th class="num">${escapeHtml(strings.unitPrice)}</th>
        <th class="num">${escapeHtml(strings.amount)}</th>
      </tr>
    </thead>
    <tbody>${lines}</tbody>
  </table>

  <div class="totals">
    <div class="totals__row"><span>${escapeHtml(strings.net)}</span><span>${escapeHtml(
      money(invoice.netMinor),
    )}</span></div>
    ${vatRow}
    <div class="totals__row totals__row--total"><span>${escapeHtml(
      strings.total,
    )}</span><span>${escapeHtml(money(invoice.totalMinor))}</span></div>
  </div>

  <section class="pay">
    <div class="pay__grid">
      <div>
        <div class="pay__label">${escapeHtml(strings.payTo)}</div>
        <div class="pay__value">${escapeHtml(invoice.paymentAccount)}</div>
      </div>
      <div>
        <div class="pay__label">${escapeHtml(strings.reference)}</div>
        <div class="pay__value">${escapeHtml(formatOcr(invoice.ocr))}</div>
      </div>
      <div>
        <div class="pay__label">${escapeHtml(strings.toPay)}</div>
        <div class="pay__value">${escapeHtml(money(invoice.totalMinor))}</div>
      </div>
    </div>
    ${invoice.paidAt ? `<p class="settled">${escapeHtml(strings.settled)}</p>` : ''}
  </section>
</main>
</body>
</html>`;
}

/**
 * What the web page adds over the printed one.
 *
 * The print CSS already carries the brand, the type and the page geometry. On screen it needs a
 * ground behind the sheet and room to breathe on a phone, and nothing else — which is why this is
 * twenty lines rather than a second stylesheet.
 */
const WEB_CSS = (tokens: TokenSet) => `
body {
  background: ${tokens.colour.surface};
  margin: 0;
  padding: 24px 16px 64px;
}
.invoice {
  background: ${tokens.colour.background};
  max-width: 46rem;
  margin: 0 auto;
  padding: 40px;
  border-radius: 8px;
}
@media (max-width: 30rem) {
  .invoice { padding: 24px 20px; }
  /* A four-column table on a 360px screen is a horizontal scrollbar nobody finds. */
  table { font-size: 14px; }
}
@media print {
  body { background: none; padding: 0; }
  .invoice { padding: 0; max-width: none; border-radius: 0; }
}
`;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
