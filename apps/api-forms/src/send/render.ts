import { defaultTokens } from '@tp/tokens';
import { toPrintCss } from '@tp/tokens/pdf';
import { api } from '@tp/shared';
import { formatMinor, lineTotals } from '@tp/shared/invoicing';
import type { PdfRenderer } from '../documents/render.js';
import { invoiceCopy } from '../documents/invoice-copy.js';

/**
 * One personalised document of a batch: merge a row into the shared layout, then print it.
 *
 * Two layouts and nothing more. A letter is the person's own words; the invoice layout adds a
 * description, an amount, a VAT rate **the person typed**, a total and where to pay. The labels the
 * invoice layout prints are the product's functional ones (`invoice-copy.ts`: "Total", "Due"); no
 * contractual, legal or tax sentence is written here (CLAUDE.md rule 8). Totals are bigint
 * arithmetic (`lineTotals`), so a column of them adds up.
 */
const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** What a row says in each merge field, with the amount written the way the locale writes it. */
export function valuesOf(
  template: api.BatchTemplate,
  row: api.BatchRow,
): Record<api.MergeField, string> {
  const minor = api.parseMinor(row.amount);
  return {
    name: row.name.trim(),
    email: row.email.trim(),
    amount:
      minor === null ? row.amount.trim() : formatMinor(minor, template.currency, template.locale),
    reference: row.reference.trim(),
  };
}

const paragraphs = (text: string): string =>
  text
    .split(/\n{2,}/)
    .filter((part) => part.trim() !== '')
    .map((part) => `<p>${escapeHtml(part).replace(/\n/g, '<br />')}</p>`)
    .join('');

export function renderBatchHtml(
  template: api.BatchTemplate,
  row: api.BatchRow,
  organisationName: string,
): string {
  const values = valuesOf(template, row);
  const title = api.mergeText(template.title, values);
  const body = api.mergeText(template.body, values);
  const tokens = defaultTokens;

  let middle = paragraphs(body);
  if (template.layout === 'invoice') {
    const strings = invoiceCopy(template.locale);
    const money = (minor: bigint) => formatMinor(minor, template.currency, template.locale);
    const net = api.parseMinor(row.amount) ?? 0n;
    // Only ever a rate a person typed; `checkBatch` has refused a template without one.
    const rate = api.parseBasisPoints(template.vatRate ?? '') ?? 0;
    const totals = lineTotals({
      quantity: '1000',
      unitAmount: net.toString(),
      vatRateBasisPoints: rate,
    });
    const due = template.dueOn
      ? new Intl.DateTimeFormat(template.locale, { dateStyle: 'long' }).format(
          new Date(`${template.dueOn}T00:00:00Z`),
        )
      : '';
    const percent = new Intl.NumberFormat(template.locale, { maximumFractionDigits: 2 }).format(
      rate / 100,
    );
    const line = (label: string, value: string, strong = false) =>
      `<div class="row${strong ? ' row--total' : ''}"><span>${escapeHtml(label)}</span><span>${escapeHtml(value)}</span></div>`;
    const fact = (label: string, value: string) =>
      value ? `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>` : '';
    middle = `
      ${paragraphs(body)}
      <section class="sums">
        ${line(strings.net, money(totals.amount))}
        ${rate > 0 ? line(`${strings.vat} ${percent} %`, money(totals.vat)) : ''}
        ${line(strings.total, money(totals.amount + totals.vat), true)}
      </section>
      <dl class="facts">
        ${fact(strings.reference, values.reference)}
        ${fact(strings.dueOn, due)}
        ${fact(strings.payTo, template.payTo ?? '')}
      </dl>`;
  }

  return `<!doctype html>
<html lang="${escapeHtml(template.locale)}">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>
${toPrintCss(tokens, { header: '', footer: '' })}
.sender { color: ${tokens.colour.muted}; margin: 0; }
.to { margin: 24px 0 32px; }
.sums { margin: 24px 0; max-width: 20rem; }
.row { display: flex; justify-content: space-between; padding: 6px 0; font-variant-numeric: tabular-nums; }
.row--total { border-top: 2px solid ${tokens.colour.text}; font-weight: ${tokens.typography.weightBold}; margin-top: 6px; }
.facts { display: grid; gap: 10px; margin: 0; }
.facts dt { font-size: 12px; text-transform: uppercase; color: ${tokens.colour.muted}; }
.facts dd { margin: 2px 0 0; }
</style>
</head>
<body>
<main>
  <p class="sender">${escapeHtml(organisationName)}</p>
  <p class="to">${escapeHtml(values.name)}</p>
  <h1>${escapeHtml(title)}</h1>
  ${middle}
</main>
</body>
</html>`;
}

export async function renderBatchPdf(
  renderer: PdfRenderer,
  template: api.BatchTemplate,
  row: api.BatchRow,
  organisationName: string,
): Promise<Buffer> {
  return renderer.render(renderBatchHtml(template, row, organisationName));
}
