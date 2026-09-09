import { useEffect, useState } from 'react';
import { pickText } from '@tp/i18n';
import { formatMinor } from '@tp/shared/invoicing';
import type { invoicing as invoicingSchemas } from '@tp/shared';
import { client } from '../lib/api.js';
import { useSession } from '../lib/session.js';
import { useT } from '../lib/i18n.js';
import { Loading } from '../components/Loading.js';
import { EmptyState } from '../components/EmptyState.js';
import { Icon } from '../components/Icon.js';

/**
 * The book of invoices, for the people who raised them.
 *
 * The tenant's half of invoicing shipped first and shipped alone: a page at `/i/:token` that only
 * whoever held the link could open. Inside the organisation there was nothing — invoices were
 * numbered, given a reference a bank would match on, and then invisible. This is that missing
 * half, and it is deliberately a **table**: every column here is a fact somebody scans down, and
 * the one operation this screen exists for is finding the invoice a tenant is ringing about.
 *
 * Cards would have been the easier thing to build and the wrong shape for it. You cannot run your
 * eye down a column of money that is laid out as forty little panels.
 */
export function Invoices() {
  const t = useT();
  const { locale, locales } = useSession();
  const [data, setData] = useState<invoicingSchemas.InvoiceListResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    void client.listInvoices().then((response) => {
      if (!cancelled) setData(response);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!data) return <Loading />;

  /*
   * Today, once, rather than inside the row.
   *
   * Forty rows each constructing their own `new Date()` is forty answers to the same question, and
   * on a list open across midnight two of them would disagree about whether a row is overdue.
   */
  const today = new Date().toISOString().slice(0, 10);

  return (
    <section className="stack">
      <header className="row row--between">
        <h1>{t('invoices.heading')}</h1>
        {/*
          The one number somebody opens this screen for, beside the heading rather than inside a
          panel of its own. A total that needs a card around it is a total nobody trusted.
        */}
        {data.outstanding !== '0' && (
          <p className="invoices__outstanding">
            <span className="small muted">{t('invoices.outstanding')}</span>{' '}
            <strong>{formatMinor(BigInt(data.outstanding), data.currency, locale)}</strong>
          </p>
        )}
      </header>

      {data.invoices.length === 0 ? (
        <EmptyState icon="file" title={t('invoices.empty')} hint={t('invoices.emptyHint')} />
      ) : (
        <div className="table-scroll">
          <table className="grid">
            <thead>
              <tr>
                <th>{t('invoices.number')}</th>
                <th>{t('invoices.recipient')}</th>
                <th>{t('invoices.subject')}</th>
                <th>{t('invoices.due')}</th>
                <th className="grid__amount">{t('invoices.total')}</th>
                <th>{/* status and the two links; the header would only repeat the buttons */}</th>
              </tr>
            </thead>
            <tbody>
              {data.invoices.map((invoice) => {
                /*
                 * Overdue is a date question, not a status one.
                 *
                 * Nothing moves an invoice into an "overdue" state — the status machine has no
                 * such value, because being late is not something anybody does to a record. It is
                 * simply the due date having passed while the money has not arrived.
                 */
                const overdue =
                  invoice.dueOn < today &&
                  invoice.status !== 'paid' &&
                  invoice.status !== 'cancelled';

                return (
                  <tr key={invoice.id}>
                    <td className="invoices__number">{invoice.number}</td>
                    <td>{invoice.recipient.name}</td>
                    <td>{pickText(locales, invoice.subject, locale).value}</td>
                    <td className="invoices__due">
                      {invoice.dueOn}
                      {overdue && (
                        <span className="badge badge--overdue">{t('invoices.overdue')}</span>
                      )}
                    </td>
                    <td className="grid__amount">
                      {formatMinor(BigInt(invoice.total), invoice.currency, locale)}
                    </td>
                    <td>
                      <span className="invoices__actions">
                        <span className={`badge badge--${invoice.status}`}>
                          {t(`invoiceStatus.${invoice.status}`)}
                        </span>
                        {/*
                          The tenant's own page and the file, reached the way the tenant reaches
                          them. An operator ringing somebody back needs to see exactly what was
                          sent, and these are those two documents rather than a rendering of them.
                        */}
                        <a
                          className="button button--quiet small"
                          href={`/i/${invoice.publicToken}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <Icon name="external" />
                          {t('invoices.open')}
                        </a>
                        <a
                          className="button button--quiet small"
                          href={`/i/${invoice.publicToken}/pdf`}
                        >
                          <Icon name="file" />
                          {t('invoices.pdf')}
                        </a>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
