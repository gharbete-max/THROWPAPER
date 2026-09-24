import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import { localeLabel } from '@tp/i18n';
import type { forms as formSchemas } from '@tp/shared';
import { client } from '../lib/api.js';
import { useSession } from '../lib/session.js';
import { useT } from '../lib/i18n.js';
import { Loading } from '../components/Loading.js';
import { EmptyState } from '../components/EmptyState.js';
import { CopyLink } from '../components/CopyLink.js';
import { Icon } from '../components/Icon.js';
import { CameraScan, MAX_SCAN_PAGES } from '../components/CameraScan.js';
import { CropPhoto, WHOLE_PICTURE } from './builder/paper/CropPhoto.js';
import { isUsable, straightenFile, type Corners } from './builder/paper/warp.js';

type Party = { name: string; email: string; locale: string };

/**
 * Documents sent for signing (P1c-3). Forms is the sender; Loppa Sign holds the evidence, the
 * trail and the sealed file, and is reached only through CONTRACT §5 (ADR 0009).
 *
 * Each signer gets a link of their own. Invitations by email arrive with P1c-4b; until then the
 * links are here to copy — or to open on this machine, which is how the desktop edition signs at
 * a counter or a kitchen table.
 */
export function Signing() {
  const t = useT();
  const [data, setData] = useState<formSchemas.SigningRequestList | null>(null);
  // Arriving from a submission's "Send for signing": its filled-in paper is the document.
  const [params] = useSearchParams();
  const paper = params.get('paper');
  const reference = params.get('reference') ?? '';
  const [composing, setComposing] = useState(paper !== null);

  useEffect(() => {
    let cancelled = false;
    void client.listSigningRequests().then((response) => {
      if (!cancelled) setData(response);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!data) return <Loading />;

  function replace(updated: formSchemas.SigningRequestView) {
    setData(
      (current) =>
        current && {
          ...current,
          requests: current.requests.some((r) => r.id === updated.id)
            ? current.requests.map((r) => (r.id === updated.id ? updated : r))
            : [updated, ...current.requests],
        },
    );
  }

  if (!data.enabled) {
    return (
      <section className="stack">
        <h1>{t('signing.heading')}</h1>
        <EmptyState
          icon="signature"
          title={t('signing.notConfigured')}
          hint={t('signing.notConfiguredHint')}
        />
      </section>
    );
  }

  return (
    <section className="stack">
      <header className="row row--between">
        <h1>{t('signing.heading')}</h1>
        {!composing && (
          <button type="button" className="button" onClick={() => setComposing(true)}>
            <Icon name="signature" />
            {t('signing.new')}
          </button>
        )}
      </header>

      {composing && (
        <Compose
          paper={paper ? { submissionId: paper, reference } : null}
          onCancel={() => setComposing(false)}
          onSent={(created) => {
            replace(created);
            setComposing(false);
          }}
        />
      )}

      {data.requests.length === 0 ? (
        !composing && (
          <EmptyState icon="signature" title={t('signing.empty')} hint={t('signing.emptyHint')} />
        )
      ) : (
        <div className="table-scroll">
          <table className="grid">
            <thead>
              <tr>
                <th>{t('signing.document')}</th>
                <th>{t('signing.parties')}</th>
                <th>{t('signing.status')}</th>
                <th>{/* actions */}</th>
              </tr>
            </thead>
            <tbody>
              {data.requests.map((request) => (
                <Row key={request.id} request={request} onChange={replace} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Row({
  request,
  onChange,
}: {
  request: formSchemas.SigningRequestView;
  onChange: (updated: formSchemas.SigningRequestView) => void;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const known = ['draft', 'sent', 'completed', 'declined', 'expired', 'cancelled'];
  const statusKey = known.includes(request.status) ? request.status : 'sent';

  async function refresh() {
    setBusy(true);
    try {
      onChange(await client.refreshSigningRequest(request.id));
    } finally {
      setBusy(false);
    }
  }

  async function download() {
    setBusy(true);
    try {
      const url = URL.createObjectURL(await client.signedPdf(request.id));
      const link = document.createElement('a');
      link.href = url;
      link.download = `${request.documentName}.pdf`;
      link.click();
      URL.revokeObjectURL(url);
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr data-testid="signing-row">
      <td>
        <span className="row">
          {request.documentName}
          {request.environment === 'test' && <span className="badge">{t('signing.testMode')}</span>}
        </span>
      </td>
      <td>
        <ul className="stack stack--tight signing__parties">
          {request.parties.map((party) => (
            <li key={party.id} className="row">
              <span>{party.name}</span>
              <span className={`badge badge--${party.status}`}>
                {t(`signing.party.${party.status}`)}
              </span>
              {(party.status === 'invited' || party.status === 'viewed') &&
                request.status === 'sent' && (
                  <>
                    <a
                      className="button button--quiet small"
                      href={party.signUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      <Icon name="external" />
                      {t('signing.openLink')}
                    </a>
                    <CopyLink path={party.signUrl} />
                  </>
                )}
            </li>
          ))}
        </ul>
      </td>
      <td>
        <span className={`badge badge--${statusKey}`} data-testid="signing-status">
          {t(`signing.status.${statusKey}`)}
        </span>
      </td>
      <td>
        <span className="row">
          <button
            type="button"
            className="button button--quiet small"
            disabled={busy}
            onClick={refresh}
          >
            {t('signing.refresh')}
          </button>
          {request.status === 'completed' && (
            <button type="button" className="button small" disabled={busy} onClick={download}>
              <Icon name="file" />
              {t('signing.downloadSigned')}
            </button>
          )}
        </span>
      </td>
    </tr>
  );
}

/** A file as base64, in chunks: spreading a whole PDF into one call overflows the stack. */
async function base64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let at = 0; at < bytes.length; at += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  }
  return btoa(binary);
}

function Compose({
  paper,
  onCancel,
  onSent,
}: {
  /** A paper form's submission, sent as its filled-in PDF instead of an uploaded file. */
  paper: { submissionId: string; reference: string } | null;
  onCancel: () => void;
  onSent: (created: formSchemas.SigningRequestView) => void;
}) {
  const t = useT();
  const { locale, locales } = useSession();
  const languages = locales.supported.length ? locales.supported : [locale];
  const [file, setFile] = useState<File | null>(null);
  // A document can also be paper, scanned here with the camera: one photo per page, each
  // straightened on the corners the person places (the same handles as a form from paper).
  const [via, setVia] = useState<'file' | 'camera'>('file');
  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState<{ file: File; corners: Corners }[]>([]);
  const [documentName, setDocumentName] = useState('');
  const [parties, setParties] = useState<Party[]>([{ name: '', email: '', locale }]);
  const [routing, setRouting] = useState<'sequential' | 'parallel'>('sequential');
  const [declarationKey, setDeclarationKey] = useState('demo');
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);

  const hasDocument =
    via === 'file'
      ? file !== null
      : scanned.length > 0 && scanned.every((p) => isUsable(p.corners));
  const ready =
    (paper !== null || (hasDocument && documentName.trim() !== '')) &&
    declarationKey.trim() !== '' &&
    parties.every((party) => party.name.trim() !== '');

  function update(index: number, patch: Partial<Party>) {
    setParties((current) => current.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready) return;
    setSending(true);
    setFailed(false);
    try {
      const common = {
        parties: parties.map((party) => ({
          name: party.name.trim(),
          ...(party.email.trim() ? { email: party.email.trim() } : {}),
          locale: party.locale,
        })),
        routing,
        declarationKey: declarationKey.trim(),
        // Test mode until a person has written the declaration (ADR 0012, rule 7).
        environment: 'test' as const,
      };
      let body: formSchemas.CreateSigningRequest;
      if (paper) {
        body = { source: 'paper', submissionId: paper.submissionId, ...common };
      } else if (via === 'camera') {
        const pages = [];
        for (const page of scanned) {
          const straight = await straightenFile(page.file, page.corners);
          pages.push({
            contentType:
              straight.type === 'image/png' ? ('image/png' as const) : ('image/jpeg' as const),
            base64: await base64(straight),
          });
        }
        body = { source: 'scan', documentName: documentName.trim(), pages, ...common };
      } else {
        body = {
          source: 'upload',
          documentName: documentName.trim(),
          pdfBase64: await base64(file!),
          ...common,
        };
      }
      onSent(await client.createSigningRequest(body));
    } catch {
      setFailed(true);
    } finally {
      setSending(false);
    }
  }

  return (
    <form className="card stack" onSubmit={submit} aria-label={t('signing.new')}>
      <h2>{t('signing.new')}</h2>
      {paper ? (
        <p>
          <strong>{t('signing.document')}:</strong>{' '}
          {t('signing.fromSubmission', { reference: paper.reference })}
        </p>
      ) : (
        <>
          <div className="row" role="radiogroup" aria-label={t('signing.document')}>
            {(['file', 'camera'] as const).map((choice) => (
              <button
                key={choice}
                type="button"
                role="radio"
                aria-checked={via === choice}
                className={via === choice ? 'button' : 'button button--quiet'}
                onClick={() => {
                  setVia(choice);
                  if (choice === 'camera' && scanned.length === 0) setScanning(true);
                }}
              >
                <Icon name={choice === 'file' ? 'file' : 'image'} />
                {t(`signing.source.${choice}`)}
              </button>
            ))}
          </div>
          {via === 'file' ? (
            <label className="stack stack--tight">
              <span>{t('signing.file')}</span>
              <input
                type="file"
                accept="application/pdf,.pdf"
                onChange={(event) => {
                  const chosen = event.target.files?.[0] ?? null;
                  setFile(chosen);
                  if (chosen && !documentName) setDocumentName(chosen.name.replace(/\.pdf$/i, ''));
                }}
              />
            </label>
          ) : scanning ? (
            <CameraScan
              onCancel={() => setScanning(false)}
              onDone={(pages) => {
                setScanning(false);
                // More pages are added to the end: a second scan continues the document.
                setScanned((current) =>
                  [
                    ...current,
                    ...pages.map((page) => ({ file: page, corners: WHOLE_PICTURE })),
                  ].slice(0, MAX_SCAN_PAGES),
                );
              }}
            />
          ) : (
            <div className="stack">
              {scanned.map((page, index) => (
                <CropPhoto
                  key={index}
                  file={page.file}
                  corners={page.corners}
                  onChange={(corners) =>
                    setScanned((current) =>
                      current.map((p, i) => (i === index ? { ...p, corners } : p)),
                    )
                  }
                />
              ))}
              <div>
                <button
                  type="button"
                  className="button button--quiet small"
                  onClick={() => setScanning(true)}
                >
                  <Icon name="image" />
                  {t('camera.scanDocument')}
                </button>
              </div>
            </div>
          )}
          <label className="stack stack--tight">
            <span>{t('signing.documentName')}</span>
            <input
              className="input"
              value={documentName}
              maxLength={200}
              onChange={(event) => setDocumentName(event.target.value)}
            />
          </label>
        </>
      )}

      <fieldset className="stack stack--tight">
        <legend>{t('signing.parties')}</legend>
        {parties.map((party, index) => (
          <div key={index} className="row signing__party">
            <label className="stack stack--tight">
              <span className="small">{t('signing.partyName')}</span>
              <input
                className="input"
                value={party.name}
                maxLength={200}
                onChange={(event) => update(index, { name: event.target.value })}
              />
            </label>
            <label className="stack stack--tight">
              <span className="small">{t('signing.partyEmail')}</span>
              <input
                className="input"
                type="email"
                value={party.email}
                onChange={(event) => update(index, { email: event.target.value })}
              />
            </label>
            <label className="stack stack--tight">
              <span className="small">{t('signing.partyLocale')}</span>
              <select
                className="input"
                value={party.locale}
                onChange={(event) => update(index, { locale: event.target.value })}
              >
                {languages.map((code) => (
                  <option key={code} value={code}>
                    {localeLabel(code)}
                  </option>
                ))}
              </select>
            </label>
            {parties.length > 1 && (
              <button
                type="button"
                className="button button--quiet small"
                onClick={() => setParties((current) => current.filter((_, i) => i !== index))}
              >
                {t('signing.removeParty')}
              </button>
            )}
          </div>
        ))}
        <div>
          <button
            type="button"
            className="button button--quiet small"
            disabled={parties.length >= 20}
            onClick={() => setParties((current) => [...current, { name: '', email: '', locale }])}
          >
            {t('signing.addParty')}
          </button>
        </div>
      </fieldset>

      <div className="row">
        <label className="stack stack--tight">
          <span>{t('signing.routing')}</span>
          <select
            className="input"
            value={routing}
            onChange={(event) => setRouting(event.target.value as 'sequential' | 'parallel')}
          >
            <option value="sequential">{t('signing.routing.sequential')}</option>
            <option value="parallel">{t('signing.routing.parallel')}</option>
          </select>
        </label>
        <label className="stack stack--tight">
          <span>{t('signing.declarationKey')}</span>
          <input
            className="input"
            value={declarationKey}
            maxLength={128}
            onChange={(event) => setDeclarationKey(event.target.value)}
          />
        </label>
      </div>
      <p className="small muted">{t('signing.declarationHint')}</p>
      <p className="small muted">
        <span className="badge">{t('signing.testMode')}</span> {t('signing.testModeHint')}
      </p>

      {failed && (
        <p className="error" role="alert">
          {t('signing.failed')}
        </p>
      )}
      <div className="row">
        <button type="submit" className="button" disabled={!ready || sending}>
          {sending ? t('signing.sending') : t('signing.send')}
        </button>
        <button type="button" className="button button--quiet" onClick={onCancel}>
          {t('signing.cancel')}
        </button>
      </div>
    </form>
  );
}
