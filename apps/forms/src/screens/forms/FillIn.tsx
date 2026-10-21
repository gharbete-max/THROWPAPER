import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { fillPdfFromState } from '../../lib/documents-handoff.js';
import { pickText } from '@tp/i18n';
import type { FormResponse } from '@tp/shared/forms';
import { ApiError, client, type PdfField } from '../../lib/api.js';
import { saveBlob } from '../../lib/email-handoff.js';
import { sendWith } from '../../lib/send-handoff.js';
import { useSession } from '../../lib/session.js';
import { useT } from '../../lib/i18n.js';
import { useToast } from '../../lib/toast.js';
import { useConfirm } from '../../components/Confirm.js';
import { Icon } from '../../components/Icon.js';
import { Loading } from '../../components/Loading.js';
import { LoadFailed } from '../../components/LoadFailed.js';
import { FormPreview } from './builder/FormPreview.js';
import '../../styles/builder.css';

/**
 * Filling in, for a person who collects nothing: the answers end up in a PDF they keep. Nothing is
 * sent, no submission is made and nothing is published (`docs/plan/DOCUMENTS.md`, "Forms").
 * Two screens, one for a Loppa form and one for a PDF's own fields.
 */

/** One sentence per server code. */
function errorKey(error: unknown) {
  switch (error instanceof ApiError ? error.code : '') {
    case 'encrypted':
      return 'scan.error.encrypted' as const;
    case 'unreadable':
    case 'too-costly':
      return 'scan.error.unreadable' as const;
    case 'too-large':
      return 'scan.error.tooLarge' as const;
    case 'unencodable':
      return 'fill.unencodable' as const;
    default:
      return 'draft.failed' as const;
  }
}

/** `/forms/:id/fill` — a Loppa form, filled in here and kept as a PDF. */
export function FillForm() {
  const t = useT();
  const toast = useToast();
  const { id } = useParams();
  const { contentLocale: locale, locales } = useSession();
  const [form, setForm] = useState<FormResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (!id) return;
    client
      .getForm(id)
      .then(setForm)
      .catch(() => setFailed(true));
  }, [id]);

  if (failed) return <LoadFailed onRetry={() => location.reload()} />;
  if (!form || !id) return <Loading />;
  const title = pickText(locales, form.title, locale).value || form.slug;

  async function keep(then: 'save' | 'send' = 'save') {
    setBusy(true);
    try {
      const blob = await client.draftPdf(id!, locale, values);
      if (then === 'send') {
        navigate(...sendWith(new File([blob], `${title}.pdf`, { type: 'application/pdf' })));
      } else saveBlob(blob, `${title}.pdf`);
    } catch (error) {
      toast.show(t(errorKey(error)), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="stack">
      <header className="stack stack--tight">
        <h1>{title}</h1>
        <p className="muted small">{t('fill.formIntro')}</p>
        <Link className="small" to={`/forms/${id}`}>
          {t('fill.back')}
        </Link>
      </header>
      <FormPreview
        definition={form.draftDefinition}
        locale={locale}
        locales={locales}
        selectedId={null}
        note={false}
        onValues={setValues}
      />
      <div className="row">
        <button type="button" className="button" disabled={busy} onClick={() => void keep()}>
          <Icon name="download" /> {busy ? t('draft.working') : t('fill.keep')}
        </button>
        <button
          type="button"
          className="button button--quiet"
          disabled={busy}
          onClick={() => void keep('send')}
        >
          <Icon name="email" /> {t('scan.send')}
        </button>
      </div>
    </section>
  );
}

/** `/forms/pdf` — a PDF's own fields, filled in here and the PDF kept. */
export function FillPdf() {
  const t = useT();
  const toast = useToast();
  const confirm = useConfirm();
  const picker = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [fields, setFields] = useState<PdfField[] | null>(null);
  const [values, setValues] = useState<Record<string, string | boolean>>({});
  /** Once the person has agreed to lose a signature, for this file. */
  const [signatureLoss, setSignatureLoss] = useState(false);
  const [empty, setEmpty] = useState(false);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const handed = fillPdfFromState(useLocation().state);

  // A PDF handed over by Scan opens straight away, as if it had been chosen here.
  useEffect(() => {
    if (handed) void open(handed);
    // Once, for the file this screen was opened with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function open(chosen: File, accept = false): Promise<void> {
    setEmpty(false);
    try {
      const { fields: found } = await client.pdfFields(chosen, accept);
      setFile(chosen);
      setFields(found);
      setValues(Object.fromEntries(found.map((field) => [field.name, field.value])));
      setSignatureLoss(accept);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'signed') {
        // Asked before anything is changed: filling a signed PDF removes its signature.
        const agreed = await confirm(t('fill.signed'), {
          confirmLabel: t('fill.signedConfirm'),
          danger: true,
        });
        if (agreed) return open(chosen, true);
      } else if (error instanceof ApiError && error.code === 'no-fields') {
        setFile(null);
        setFields(null);
        setEmpty(true);
      } else {
        toast.show(t(errorKey(error)), 'error');
      }
    }
  }

  async function keep(then: 'save' | 'send' = 'save') {
    if (!file || !fields) return;
    // Only what the person changed: a list box's several choices are not sent back as one string.
    const changed = Object.fromEntries(
      fields
        .filter((field) => values[field.name] !== field.value)
        .map((f) => [f.name, values[f.name]!]),
    );
    setBusy(true);
    try {
      const blob = await client.fillPdf(file, changed, signatureLoss);
      if (then === 'send')
        navigate(...sendWith(new File([blob], file.name, { type: 'application/pdf' })));
      else saveBlob(blob, file.name);
    } catch (error) {
      toast.show(t(errorKey(error)), 'error');
    } finally {
      setBusy(false);
    }
  }

  const set = (name: string, value: string | boolean) =>
    setValues((current) => ({ ...current, [name]: value }));

  return (
    <section className="stack">
      <header className="stack stack--tight">
        <h1>{t('fill.pdfHeading')}</h1>
        <p className="muted small">{t('fill.pdfIntro')}</p>
      </header>
      <div className="row">
        <input
          ref={picker}
          type="file"
          accept="application/pdf,.pdf"
          hidden
          data-testid="fill-pdf-file"
          onChange={(event) => {
            const chosen = event.target.files?.[0];
            event.target.value = '';
            if (chosen) void open(chosen);
          }}
        />
        <button type="button" className="button" onClick={() => picker.current?.click()}>
          <Icon name="upload" /> {t('fill.choose')}
        </button>
      </div>

      {empty && (
        <p className="small">
          {t('fill.noFields')} <Link to="/forms?new=paper">{t('scan.toForm')}</Link>
        </p>
      )}

      {fields && (
        <form
          className="stack"
          onSubmit={(event) => {
            event.preventDefault();
            void keep();
          }}
        >
          {fields.map((field) => (
            <label key={field.name} className="field">
              <span>{field.name}</span>
              {field.kind === 'checkbox' ? (
                <input
                  type="checkbox"
                  checked={values[field.name] === true}
                  onChange={(event) => set(field.name, event.target.checked)}
                />
              ) : field.kind === 'choice' ? (
                <select
                  value={String(values[field.name] ?? '')}
                  onChange={(event) => set(field.name, event.target.value)}
                >
                  <option value="">{t('public.choose')}</option>
                  {field.options?.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  value={String(values[field.name] ?? '')}
                  onChange={(event) => set(field.name, event.target.value)}
                />
              )}
            </label>
          ))}
          <div className="row">
            <button type="submit" className="button" disabled={busy}>
              <Icon name="download" /> {busy ? t('draft.working') : t('fill.keep')}
            </button>
            <button
              type="button"
              className="button button--quiet"
              disabled={busy}
              onClick={() => void keep('send')}
            >
              <Icon name="email" /> {t('scan.send')}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
