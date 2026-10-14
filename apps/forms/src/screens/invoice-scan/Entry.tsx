import { lazy, Suspense, useEffect, useState } from 'react';
import { Icon } from '../../components/Icon.js';
import { useT } from '../../lib/i18n.js';

// Loaded when somebody asks for it: the rules, the review and the optical reading stay out of Scan.
const InvoiceScan = lazy(() =>
  import('./InvoiceScan.js').then((module) => ({ default: module.InvoiceScan })),
);

/** The way into reading a supplier invoice from the Scan screen: a button, then the lazy part. */
export function InvoiceScanEntry({ file = null }: { file?: File | null }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  // A file the person chose to read as an invoice opens the reader on it.
  useEffect(() => {
    if (file) setOpen(true);
  }, [file]);
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
          <InvoiceScan file={file} onClose={() => setOpen(false)} />
        </Suspense>
      ) : null}
    </div>
  );
}
