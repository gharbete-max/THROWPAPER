import { useEffect, useMemo, useRef, useState } from 'react';
import { LOCALE_CODES, localeLabel } from '@tp/i18n';
import { readInvoice, type InvoiceReading, type ReviewedPayable } from '@tp/shared/payable';
import { CameraScan } from '../../../components/CameraScan.js';
import { Icon } from '../../../components/Icon.js';
import { saveBlob } from '../../../lib/email-handoff.js';
import { useT } from '../../../lib/i18n.js';
import { useSession } from '../../../lib/session.js';
import { useToast } from '../../../lib/toast.js';
import { amountText, dateText, paymentNote, recordFiles } from './format.js';
import { readInvoicePages, TooManyInvoicePages, type InvoicePages } from './read-page.js';
import {
  buildRecord,
  canKeep,
  changed,
  CURRENCIES,
  initialStates,
  KEYS,
  ready,
  REQUIRED,
  resolve,
  type FieldState,
  type Key,
  type States,
  type Value,
} from './review.js';

/**
 * Read a supplier invoice (`docs/HANDOVER.md` decision 5): a photo, a scan or a PDF is read in this
 * browser, the rules in `@tp/shared/payable` pick out the amount, currency, due date, bank number
 * and payment reference, and this screen puts each in front of the person beside the place on the
 * page it came from. Nothing is used until it has been confirmed; a value whose check digit fails
 * needs a second, separate decision. No part of this file talks to a server.
 */
export function InvoiceScan({
  onClose,
  file = null,
}: {
  onClose: () => void;
  /** A file already chosen elsewhere (dropped on Scan), read as soon as this opens. */
  file?: File | null;
}) {
  const t = useT();
  const toast = useToast();
  const { locale } = useSession();
  const picker = useRef<HTMLInputElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const [camera, setCamera] = useState(false);
  const [language, setLanguage] = useState(() =>
    LOCALE_CODES.includes(locale as never) ? locale : 'en-GB',
  );
  const [progress, setProgress] = useState<{ page: number; count: number } | null>(null);
  const [loaded, setLoaded] = useState<{ pages: InvoicePages; reading: InvoiceReading } | null>(
    null,
  );
  const [states, setStates] = useState<States | null>(null);
  const [focus, setFocus] = useState<Key>('total');
  const [shown, setShown] = useState(0);
  const [record, setRecord] = useState<ReviewedPayable | null>(null);

  // The page drawings are released when the screen goes or another file is read.
  const open = useRef<InvoicePages | null>(null);
  open.current = loaded?.pages ?? null;
  useEffect(() => () => open.current?.close(), []);

  async function read(file: File) {
    loaded?.pages.close();
    setLoaded(null);
    setStates(null);
    setRecord(null);
    setProgress({ page: 1, count: 1 });
    try {
      const pages = await readInvoicePages(file, language, (page, count) =>
        setProgress({ page, count }),
      );
      if (pages.words.length === 0) {
        pages.close();
        toast.show(t('invoiceScan.error.noWords'), 'error');
        return;
      }
      const reading = readInvoice(pages.words);
      setLoaded({ pages, reading });
      setStates(initialStates(reading));
      setFocus('total');
      setShown((reading.total.candidates[0]?.where.page ?? 1) - 1);
      queueMicrotask(() => heading.current?.focus());
    } catch (error) {
      toast.show(
        error instanceof TooManyInvoicePages
          ? t('invoiceScan.error.tooMany', { count: 8 })
          : t('invoiceScan.error.unreadable'),
        'error',
      );
    } finally {
      setProgress(null);
    }
  }

  useEffect(() => {
    if (file) void read(file);
    // Read once per file handed over.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  const reading = loaded?.reading ?? null;
  const unsettled = useMemo(
    () => (reading && states ? KEYS.filter((key) => !ready(key, reading, states[key])).length : 0),
    [reading, states],
  );

  function update(key: Key, patch: Partial<FieldState> | ((state: FieldState) => FieldState)) {
    setStates((current) => {
      if (!current) return current;
      const state = current[key];
      return {
        ...current,
        [key]: typeof patch === 'function' ? patch(state) : changed(state, patch),
      };
    });
    setFocus(key);
  }

  function show(key: Key) {
    setFocus(key);
    const where = reading && states ? resolve(key, reading, states[key]).where : null;
    if (where) setShown(where.page - 1);
  }

  return (
    <section className="stack invoice-scan" data-testid="invoice-scan" aria-labelledby="inv-h">
      <header className="stack stack--tight">
        <h2 id="inv-h" ref={heading} tabIndex={-1}>
          {t('invoiceScan.heading')}
        </h2>
        <p className="muted small">{t('invoiceScan.intro')}</p>
      </header>

      <div className="scan__bar">
        <input
          ref={picker}
          type="file"
          accept="application/pdf,.pdf,image/jpeg,image/png,image/webp,image/heic,image/heif"
          hidden
          data-testid="invoice-scan-file"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void read(file);
          }}
        />
        <label className="invoice-scan__language small">
          {t('invoiceScan.language')}{' '}
          <select value={language} onChange={(event) => setLanguage(event.target.value)}>
            {LOCALE_CODES.map((code) => (
              <option key={code} value={code}>
                {localeLabel(code)}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="button"
          disabled={progress !== null}
          onClick={() => picker.current?.click()}
        >
          <Icon name="upload" /> {t('invoiceScan.choose')}
        </button>
        <button
          type="button"
          className="button"
          disabled={progress !== null}
          onClick={() => setCamera(true)}
        >
          <Icon name="image" /> {t('invoiceScan.camera')}
        </button>
        <button type="button" className="button button--quiet" onClick={onClose}>
          {t('invoiceScan.close')}
        </button>
      </div>
      {camera ? (
        <CameraScan
          multiple={false}
          onCancel={() => setCamera(false)}
          onDone={(taken) => {
            setCamera(false);
            if (taken[0]) void read(taken[0]);
          }}
        />
      ) : null}
      {progress ? (
        <p role="status" aria-live="polite" data-testid="invoice-scan-progress">
          {t('invoiceScan.reading', progress)}
        </p>
      ) : null}

      {loaded && reading && states ? (
        record ? (
          <Kept record={record} onAgain={() => setRecord(null)} />
        ) : (
          <div className="invoice-scan__panes">
            <PagePane
              pages={loaded.pages}
              shown={shown}
              setShown={setShown}
              mark={resolve(focus, reading, states[focus]).where}
              markKey={focus}
            />
            <div className="stack invoice-scan__fields">
              {KEYS.map((key) => (
                <FieldCard
                  key={key}
                  field={key}
                  reading={reading}
                  state={states[key]}
                  locale={locale}
                  active={focus === key}
                  update={(patch) => update(key, patch)}
                  show={() => show(key)}
                />
              ))}
              <p className="muted small" role="status" data-testid="invoice-scan-blocked">
                {unsettled > 0 ? t('invoiceScan.blocked', { count: unsettled }) : ''}
              </p>
              <button
                type="button"
                className="button"
                disabled={!canKeep(reading, states)}
                data-testid="invoice-scan-keep"
                onClick={() => setRecord(buildRecord(reading, states, new Date()))}
              >
                <Icon name="check" /> {t('invoiceScan.keepAction')}
              </button>
            </div>
          </div>
        )
      ) : null}
    </section>
  );
}

// -- the page, with the place a value was found outlined ------------------------------------------

function PagePane({
  pages,
  shown,
  setShown,
  mark,
  markKey,
}: {
  pages: InvoicePages;
  shown: number;
  setShown: (page: number) => void;
  mark: { page: number; x0: number; y0: number; x1: number; y1: number } | null;
  markKey: Key;
}) {
  const t = useT();
  const canvas = useRef<HTMLCanvasElement>(null);
  const source = pages.pages[shown];
  const pdf = source && 'pdf' in source ? source : null;
  useEffect(() => {
    const element = canvas.current;
    if (!element || !pdf) return;
    const drawing = new AbortController();
    pdf.pdf.render(pdf.index, 720, element, drawing.signal).catch(() => {});
    return () => drawing.abort();
  }, [pdf]);
  const pad = 0.004;
  return (
    <div className="stack stack--tight invoice-scan__page">
      {pages.pages.length > 1 ? (
        <div className="scan__bar">
          <button
            type="button"
            className="button button--quiet button--icon"
            aria-label={t('scan.earlier')}
            disabled={shown === 0}
            onClick={() => setShown(shown - 1)}
          >
            <Icon name="arrow-left" />
          </button>
          <span className="small" aria-live="polite">
            {t('invoiceScan.page', { n: shown + 1, count: pages.pages.length })}
          </span>
          <button
            type="button"
            className="button button--quiet button--icon"
            aria-label={t('scan.later')}
            disabled={shown === pages.pages.length - 1}
            onClick={() => setShown(shown + 1)}
          >
            <Icon name="arrow-right" />
          </button>
        </div>
      ) : null}
      <div className="invoice-scan__sheet" data-testid="invoice-scan-sheet">
        {source && 'url' in source ? (
          <img src={source.url} alt={t('invoiceScan.pageAlt')} />
        ) : (
          <canvas ref={canvas} role="img" aria-label={t('invoiceScan.pageAlt')} />
        )}
        {mark && mark.page - 1 === shown ? (
          <span
            className="invoice-scan__mark"
            data-testid="invoice-scan-mark"
            data-field={markKey}
            aria-hidden="true"
            style={{
              left: `${Math.max(0, mark.x0 - pad) * 100}%`,
              top: `${Math.max(0, mark.y0 - pad) * 100}%`,
              width: `${(mark.x1 - mark.x0 + 2 * pad) * 100}%`,
              height: `${(mark.y1 - mark.y0 + 2 * pad) * 100}%`,
            }}
          />
        ) : null}
      </div>
    </div>
  );
}

// -- one field -------------------------------------------------------------------------------------

function valueText(value: Value | null, locale: string, t: ReturnType<typeof useT>): string {
  if (!value) return '';
  switch (value.key) {
    case 'total':
    case 'vat':
      return amountText(value.minor, locale);
    case 'currency':
      return value.code;
    case 'dueDate':
      return dateText(value.iso, locale);
    case 'bank':
      return `${t(`invoiceScan.method.${value.bank.method}`)} ${value.bank.account}`;
    case 'reference':
      return value.reference.value;
  }
}

function canonical(value: Value | null): string {
  if (!value) return '';
  switch (value.key) {
    case 'total':
    case 'vat':
      return value.minor.toString();
    case 'currency':
      return value.code;
    case 'dueDate':
      return value.iso;
    case 'bank':
      return `${value.bank.method}:${value.bank.account}`;
    case 'reference':
      return `${value.reference.kind}:${value.reference.value}`;
  }
}

function FieldCard({
  field,
  reading,
  state,
  locale,
  active,
  update,
  show,
}: {
  field: Key;
  reading: InvoiceReading;
  state: FieldState;
  locale: string;
  active: boolean;
  update: (patch: Partial<FieldState> | ((state: FieldState) => FieldState)) => void;
  show: () => void;
}) {
  const t = useT();
  const found = reading[field];
  const candidates = found.candidates;
  const resolved = resolve(field, reading, state);
  const candidate = candidates[state.choice] ?? null;
  const required = REQUIRED.includes(field);
  const isReady = ready(field, reading, state);
  const failed = resolved.check === 'failed';

  let status: { tone: 'good' | 'warn'; text: string };
  if (state.omitted) status = { tone: 'good', text: t('invoiceScan.leftOut') };
  else if (resolved.problem) {
    status = { tone: 'warn', text: t(`invoiceScan.problem.${resolved.problem}`) };
  } else if (resolved.value === null) {
    status = { tone: 'warn', text: t('invoiceScan.status.missing') };
  } else if (resolved.check === 'passed') {
    status = {
      tone: 'good',
      text: t(
        resolved.detail === 'luhn' ? 'invoiceScan.status.passedLuhn' : 'invoiceScan.status.passed',
      ),
    };
  } else if (failed) status = { tone: 'warn', text: t('invoiceScan.status.failed') };
  else status = { tone: 'warn', text: t('invoiceScan.status.none') };

  const flagKeys = resolved.flags.map((flag) => `invoiceScan.flag.${flag}`);
  const typedValue = state.typed ?? candidate?.text ?? '';
  const id = `inv-${field}`;

  return (
    <fieldset
      className={`invoice-scan__field${active ? ' invoice-scan__field--active' : ''}`}
      data-field={field}
      data-value={canonical(resolved.value)}
      data-check={resolved.check}
      data-ready={isReady ? 'yes' : 'no'}
      onFocus={show}
    >
      <legend>
        {t(`invoiceScan.field.${field}`)}
        {required ? null : <span className="muted small"> · {t('invoiceScan.optional')}</span>}
      </legend>

      <p
        className="invoice-scan__status small"
        data-tone={status.tone}
        data-testid={`${id}-status`}
      >
        <Icon name={status.tone === 'good' ? 'check' : 'warning'} /> {status.text}
      </p>

      {state.omitted ? (
        <button
          type="button"
          className="button button--quiet"
          onClick={() => update({ omitted: false })}
        >
          {t('invoiceScan.putBack')}
        </button>
      ) : (
        <>
          {candidates.length > 1 ? (
            <div
              role="radiogroup"
              aria-label={t(`invoiceScan.field.${field}`)}
              className="stack stack--tight"
            >
              <p className="small muted">{t('invoiceScan.status.ask')}</p>
              {candidates.map((one, index) => (
                <label key={`${one.text}-${index}`} className="invoice-scan__choice">
                  <input
                    type="radio"
                    name={id}
                    checked={state.typed === null && state.choice === index}
                    onChange={() => update({ choice: index, typed: null })}
                  />{' '}
                  {one.value === null
                    ? one.text
                    : valueText(
                        resolve(field, reading, { ...state, choice: index, typed: null }).value,
                        locale,
                        t,
                      )}{' '}
                  <span className="muted small">
                    {t('invoiceScan.printed', { text: one.text })}
                  </span>
                </label>
              ))}
            </div>
          ) : null}

          {resolved.value ? (
            <p className="invoice-scan__read" data-testid={`${id}-read`}>
              {t('invoiceScan.reads', { value: valueText(resolved.value, locale, t) })}
            </p>
          ) : null}
          {candidate && state.typed === null ? (
            <p className="muted small">
              {t('invoiceScan.printed', { text: candidate.text })} ·{' '}
              {t('invoiceScan.foundOn', { page: candidate.where.page })}
            </p>
          ) : null}
          {flagKeys.map((key) => (
            <p key={key} className="small invoice-scan__flag">
              {t(key)}
            </p>
          ))}

          <div className="invoice-scan__edit">
            {field === 'bank' ? (
              <select
                aria-label={t('invoiceScan.method')}
                value={state.method}
                onChange={(event) =>
                  update({
                    method: event.target.value as FieldState['method'],
                    typed: state.typed ?? typedValue,
                  })
                }
              >
                {(['bankgiro', 'plusgiro', 'iban'] as const).map((method) => (
                  <option key={method} value={method}>
                    {t(`invoiceScan.method.${method}`)}
                  </option>
                ))}
              </select>
            ) : null}
            {field === 'currency' ? (
              <select
                id={id}
                aria-label={t('invoiceScan.field.currency')}
                value={resolved.value?.key === 'currency' ? resolved.value.code : ''}
                onChange={(event) => update({ typed: event.target.value })}
              >
                <option value="" disabled>
                  {t('invoiceScan.status.missing')}
                </option>
                {[
                  ...new Set([
                    ...CURRENCIES,
                    ...(resolved.value?.key === 'currency' ? [resolved.value.code] : []),
                  ]),
                ].map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id={id}
                type="text"
                aria-label={t('invoiceScan.correct')}
                value={typedValue}
                inputMode={field === 'total' || field === 'vat' ? 'decimal' : 'text'}
                onChange={(event) => update({ typed: event.target.value })}
              />
            )}
            {candidate ? (
              <button type="button" className="button button--quiet" onClick={show}>
                {t('invoiceScan.show')}
              </button>
            ) : null}
          </div>

          <label className="invoice-scan__confirm">
            <input
              type="checkbox"
              checked={state.confirmed}
              disabled={resolved.value === null || Boolean(resolved.problem)}
              onChange={(event) => update((s) => ({ ...s, confirmed: event.target.checked }))}
            />{' '}
            {t('invoiceScan.confirm')}
          </label>
          {failed ? (
            <label className="invoice-scan__confirm">
              <input
                type="checkbox"
                checked={state.keep}
                onChange={(event) => update((s) => ({ ...s, keep: event.target.checked }))}
              />{' '}
              {t('invoiceScan.keep')}
            </label>
          ) : null}
          {required ? null : (
            <button
              type="button"
              className="button button--quiet"
              onClick={() => update({ omitted: true })}
            >
              {t('invoiceScan.leaveOut')}
            </button>
          )}
        </>
      )}
    </fieldset>
  );
}

// -- what was kept -----------------------------------------------------------------------------------

function Kept({ record, onAgain }: { record: ReviewedPayable; onAgain: () => void }) {
  const t = useT();
  const toast = useToast();
  const { locale } = useSession();
  const note = paymentNote(record, t, locale);
  return (
    <div className="stack" data-testid="invoice-scan-kept">
      <h3>{t('invoiceScan.kept')}</h3>
      {record.keptDespiteFailedCheck.length > 0 ? (
        <p className="invoice-scan__flag">
          <Icon name="warning" />{' '}
          {t('invoiceScan.keptFailed', {
            fields: record.keptDespiteFailedCheck
              .map((key) => t(`invoiceScan.field.${key}`))
              .join(', '),
          })}
        </p>
      ) : null}
      <pre className="invoice-scan__note" data-testid="invoice-scan-note">
        {note}
      </pre>
      <div className="scan__bar">
        <button
          type="button"
          className="button"
          onClick={() => saveBlob(recordFiles(record).json, 'loppa-invoice.json')}
        >
          <Icon name="download" /> {t('invoiceScan.json')}
        </button>
        <button
          type="button"
          className="button"
          onClick={() => saveBlob(recordFiles(record).csv, 'loppa-invoice.csv')}
        >
          <Icon name="download" /> {t('invoiceScan.csv')}
        </button>
        <button
          type="button"
          className="button"
          onClick={() =>
            void navigator.clipboard
              .writeText(note)
              .then(() => toast.show(t('invoiceScan.copied'), 'success'))
              .catch(() => toast.show(t('invoiceScan.copyFailed'), 'error'))
          }
        >
          <Icon name="copy" /> {t('invoiceScan.copyNote')}
        </button>
        <button type="button" className="button button--quiet" onClick={onAgain}>
          {t('invoiceScan.back')}
        </button>
      </div>
    </div>
  );
}
