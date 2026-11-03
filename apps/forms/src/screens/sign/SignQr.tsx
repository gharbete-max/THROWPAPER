import { useEffect, useState } from 'react';
import { ApiError, client } from '../../lib/api.js';
import { useT } from '../../lib/i18n.js';

/**
 * A signer's QR code: the phone scans it, opens the signer's page and signs there. Shown on the
 * desktop only, where the phone reaches this computer through a relay that passes the signer's
 * page and nothing else (`api-forms/src/desktop/phone-relay.ts`).
 */
export function SignQr({
  requestId,
  partyId,
  name,
}: {
  requestId: string;
  partyId: string;
  name: string;
}) {
  const t = useT();
  const [svg, setSvg] = useState<string | null>(null);
  const [noWifi, setNoWifi] = useState(false);

  useEffect(() => {
    let cancelled = false;
    client.signerQr(requestId, partyId).then(
      (code) => {
        if (!cancelled) setSvg(code.qrSvg);
      },
      (error) => {
        // 503: this computer is on no network a phone could reach. Anything else shows nothing.
        if (!cancelled && error instanceof ApiError && error.status === 503) setNoWifi(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [requestId, partyId]);

  if (noWifi) return <p className="small muted">{t('signing.noWifi')}</p>;
  if (!svg) return null;
  return (
    <figure className="signing__qr">
      <img
        src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`}
        alt=""
        width={192}
        height={192}
      />
      <figcaption>{t('signing.scanToSign', { name })}</figcaption>
    </figure>
  );
}
