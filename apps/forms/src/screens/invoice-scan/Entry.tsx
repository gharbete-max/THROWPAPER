import { lazy, Suspense, useState } from 'react';
import { Icon } from '../../components/Icon.js';
import { useT } from '../../lib/i18n.js';

// Loaded when somebody asks for it: the rules, the review and the optical reading stay out of Scan.
const InvoiceScan = lazy(() =>
  import('./InvoiceScan.js').then((module) => ({ default: module.InvoiceScan })),
);

/** The way into reading a supplier invoice from the Scan screen: a button, then the lazy part. */
export function InvoiceScanEntry() {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <div className="stack stack--tight" data-testid="scan-invoice">
      {open ? null : (
        <div className="scan__bar">
          <button
            type="button"
            className="button button--quiet"
            data-testid="scan-invoice-open"
            onClick={() => setOpen(true)}
          >
            <Icon name="inbox" /> {t('invoiceScan.heading')}
          </button>
        </div>
      )}
      {open ? (
        <Suspense fallback={null}>
          <InvoiceScan onClose={() => setOpen(false)} />
        </Suspense>
      ) : null}
    </div>
  );
}
