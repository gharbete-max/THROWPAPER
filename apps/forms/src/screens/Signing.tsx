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
import { useConfirm } from '../components/Confirm.js';
import { CameraScan, MAX_SCAN_PAGES } from '../components/CameraScan.js';
import { CropPhoto, WHOLE_PICTURE } from './builder/paper/CropPhoto.js';
import { isUsable, straightenFile, type Corners } from './builder/paper/warp.js';
import { detectPage } from './builder/paper/detect.js';
import { SigningDeclarations } from './SigningDeclarations.js';

type Party = { name: string; email: string; locale: string };
type Declaration = formSchemas.SigningDeclarationList['declarations'][number];

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
  const [declarations, setDeclarations] = useState<Declaration[]>([]);
  const [showDeclarations, setShowDeclarations] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void client.listSigningRequests().then((response) => {
      if (!cancelled) setData(response);
    });
    void client.listSigningDeclarations().then(
      (response) => {
        if (!cancelled) setDeclarations(response.declarations);
      },
      // Without the list, Compose offers test mode on the shared placeholder — never worse.
      () => undefined,
    );
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
        <div className="row">
          <button
            type="button"
            className="button button--quiet"
            aria-expanded={showDeclarations}
            onClick={() => setShowDeclarations((open) => !open)}
          >
            {t('signing.declarations')}
          </button>
          {!composing && (
            <button type="button" className="button" onClick={() => setComposing(true)}>
              <Icon name="signature" />
              {t('signing.new')}
            </button>
          )}
        </div>
      </header>

      {showDeclarations && (
        <SigningDeclarations
          declarations={declarations}
          onSaved={(saved) =>
            // An own declaration hides a shared one of the same key, as Sign's list does.
            setDeclarations((current) => [...current.filter((d) => d.key !== saved.key), saved])
          }
        />
      )}

      {composing && (
        <Compose
          paper={paper ? { submissionId: paper, reference } : null}
          declarations={declarations}
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
  const confirm = useConfirm();
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

  /** Email one signer their link again — never without a second, deliberate press (rule 7). */
  async function remind(party: formSchemas.SigningRequestView['parties'][number]) {
    const ok = await confirm(
      t('signing.remindConfirm', { name: party.name, email: party.email ?? '' }),
      {
        danger: false,
        confirmLabel: t('signing.remind'),
      },
    );
    if (!ok) return;
    setBusy(true);
    try {
      onChange(await client.remindSigner(request.id, party.id));
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
                    {party.email && (
                      <button
                        type="button"
                        className="button button--quiet small"
                        disabled={busy}
                        onClick={() => void remind(party)}
                      >
                        {t('signing.remind')}
                      </button>
                    )}
                  </>
                )}
              {party.invitedByEmailAt && (
                <span className="small muted" data-testid="signing-emailed">
                  {t('signing.emailed')}
                </span>
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
  declarations,
  onCancel,
  onSent,
}: {
  /** A paper form's submission, sent as its filled-in PDF instead of an uploaded file. */
  paper: { submissionId: string; reference: string } | null;
  declarations: Declaration[];
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

  /** Pages from a camera, a phone or a scanner, each starting on the page's own corners if found. */
  async function addPages(pages: File[]) {
    const found = await Promise.all(
      pages.map(async (page) => ({
        file: page,
        corners: (await detectPage(page)) ?? WHOLE_PICTURE,
      })),
    );
    // More pages are added to the end: a second scan continues the document.
    setScanned((current) => [...current, ...found].slice(0, MAX_SCAN_PAGES));
  }
  const [parties, setParties] = useState<Party[]>([{ name: '', email: '', locale }]);
  const [routing, setRouting] = useState<'sequential' | 'parallel'>('sequential');
  // An organisation's own words first; the shared placeholder only when it has none yet.
  const [declarationKey, setDeclarationKey] = useState(
    () => declarations.find((d) => d.authored)?.key ?? 'demo',
  );
  const [environment, setEnvironment] = useState<'test' | 'production'>('test');
  const [confirmedReal, setConfirmedReal] = useState(false);
  const [inviteByEmail, setInviteByEmail] = useState(false);
  const confirm = useConfirm();
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);

  const hasDocument =
    via === 'file'
      ? file !== null
      : scanned.length > 0 && scanned.every((p) => isUsable(p.corners));
  const declaration = declarations.find((d) => d.key === declarationKey) ?? null;
  // Sign refuses a signer whose language the declaration has no words in; say so before sending.
  const missing = declaration
    ? parties.filter((party) => !declaration.texts[party.locale]).map((party) => party.locale)
    : [];
  // Real signatures only on words a person in this organisation wrote (ADR 0012, rule 8).
  const canBeReal = declaration?.authored === true;
  const real = environment === 'production' && canBeReal;
  const ready =
    (paper !== null || (hasDocument && documentName.trim() !== '')) &&
    declarationKey.trim() !== '' &&
    missing.length === 0 &&
    (!real || confirmedReal) &&
    parties.every((party) => party.name.trim() !== '');

  function update(index: number, patch: Partial<Party>) {
    setParties((current) => current.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready) return;
    const emailed = parties.filter((party) => party.email.trim() !== '').length;
    // Email leaves this product for real people: asked once more, in words (rule 7).
    if (inviteByEmail && emailed > 0) {
      const ok = await confirm(t('signing.inviteConfirm', { count: emailed }), {
        danger: false,
        confirmLabel: t('signing.inviteConfirmYes'),
      });
      if (!ok) return;
    }
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
        // Test mode unless the declaration is the organisation's own and the sender confirmed.
        environment: real ? ('production' as const) : ('test' as const),
        inviteByEmail: inviteByEmail && parties.some((party) => party.email.trim() !== ''),
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
                accept="application/pdf,.pdf,image/jpeg,image/png"
                multiple
                onChange={(event) => {
                  const chosen = Array.from(event.target.files ?? []);
                  const images = chosen.filter(
                    (f) => f.type === 'image/jpeg' || f.type === 'image/png',
                  );
                  const first = chosen[0];
                  if (first && !documentName) {
                    setDocumentName(first.name.replace(/\.(pdf|jpe?g|png)$/i, ''));
                  }
                  // Pages from a flatbed scanner's own software: the same path as a camera's.
                  if (images.length > 0) {
                    setFile(null);
                    setVia('camera');
                    void addPages(images);
                    return;
                  }
                  setFile(first ?? null);
                }}
              />
              <span className="small muted">{t('signing.fileHint')}</span>
            </label>
          ) : scanning ? (
            <CameraScan
              onCancel={() => setScanning(false)}
              onDone={(pages) => {
                setScanning(false);
                void addPages(pages);
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
          {declarations.length > 0 ? (
            <select
              className="input"
              value={declarationKey}
              onChange={(event) => {
                setDeclarationKey(event.target.value);
                setEnvironment('test');
                setConfirmedReal(false);
              }}
            >
              {declarations.map((d) => (
                <option key={d.key} value={d.key}>
                  {d.shared ? `${d.key} (${t('signing.declarationTestOnly')})` : d.key}
                </option>
              ))}
            </select>
          ) : (
            <input
              className="input"
              value={declarationKey}
              maxLength={128}
              onChange={(event) => setDeclarationKey(event.target.value)}
            />
          )}
        </label>
        <label className="stack stack--tight">
          <span>{t('signing.environment')}</span>
          <select
            className="input"
            value={real ? 'production' : 'test'}
            onChange={(event) => {
              setEnvironment(event.target.value as 'test' | 'production');
              setConfirmedReal(false);
            }}
          >
            <option value="test">{t('signing.testMode')}</option>
            <option value="production" disabled={!canBeReal}>
              {t('signing.realMode')}
            </option>
          </select>
        </label>
      </div>
      <p className="small muted">{t('signing.declarationHint')}</p>
      {missing.length > 0 && (
        <p className="error" role="alert">
          {t('signing.declarationMissingLanguage', {
            languages: [...new Set(missing)].map((code) => localeLabel(code)).join(', '),
          })}
        </p>
      )}
      <label className="choice__option">
        <input
          type="checkbox"
          checked={inviteByEmail}
          onChange={(event) => setInviteByEmail(event.target.checked)}
        />
        <span>{t('signing.inviteByEmail')}</span>
      </label>
      {real ? (
        <label className="choice__option">
          <input
            type="checkbox"
            checked={confirmedReal}
            onChange={(event) => setConfirmedReal(event.target.checked)}
          />
          <span>{t('signing.realConfirm')}</span>
        </label>
      ) : (
        <p className="small muted">
          <span className="badge">{t('signing.testMode')}</span>{' '}
          {canBeReal ? t('signing.testModeHint') : t('signing.realNeedsOwnDeclaration')}
        </p>
      )}

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
