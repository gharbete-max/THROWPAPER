import { useEffect, useMemo, useRef, useState } from 'react';
import { LOCALE_CODES, localeLabel } from '@tp/i18n';
import {
  BATCH_LAYOUTS,
  MERGE_FIELDS,
  SEND_CURRENCIES,
  SEND_LIMITS,
  checkBatch,
  type BatchLayout,
  type BatchRow,
  type BatchTemplate,
  type RowProblem,
} from '@tp/shared/api';
import { client } from '../lib/api.js';
import { useT } from '../lib/i18n.js';
import { useSession } from '../lib/session.js';
import { useToast } from '../lib/toast.js';
import { sortedRows, type SortColumn } from '../lib/send-rows.js';
import { Icon } from '../components/Icon.js';
import { openPdf, type PaperPdf } from './builder/paper/extract.js';
import { Delivery, ModeNote, useSendMode } from './send-parts.js';
import { ListStep, useList } from './send-list.js';

type Step = 'list' | 'layout' | 'preview' | 'confirm' | 'done';
const STEPS: readonly Step[] = ['list', 'layout', 'preview', 'confirm'];

/**
 * One personalised PDF per row of a list — a month's invoices, say. Steps: the list (pasted, or a
 * CSV file chosen here and read in this browser, with the columns mapped), the layout and the
 * words, a preview of any recipient's PDF, and the confirmation that says how many. Every problem
 * in the list is named by row before the next step; the hard cap is `SEND_LIMITS.batch`. The
 * server checks all of it again and queues nothing without the confirmation.
 */
export function SendBatch() {
  const t = useT();
  const toast = useToast();
  const { locale, user } = useSession();
  const mode = useSendMode();

  const [step, setStep] = useState<Step>('list');
  const list = useList();
  const { rows } = list;
  const [template, setTemplate] = useState<BatchTemplate>({
    layout: 'invoice',
    locale: LOCALE_CODES.includes(locale) ? locale : 'en-GB',
    currency: 'SEK',
    title: '',
    body: '',
  });
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [key, setKey] = useState('');
  const [testToMe, setTestToMe] = useState(false);
  const [busy, setBusy] = useState(false);
  const [queued, setQueued] = useState<{ id: string; to: string }[]>([]);

  const problems = useMemo(
    () => checkBatch(template, subject, message, rows),
    [template, subject, message, rows],
  );
  const tooMany = rows.length > SEND_LIMITS.batch;

  function setLayout(layout: BatchLayout) {
    setTemplate((current) => {
      const { vatRate: _v, payTo: _p, dueOn: _d, ...rest } = current;
      return layout === 'invoice' ? { ...rest, layout, vatRate: '' } : { ...rest, layout };
    });
  }
  const edit = (patch: Partial<BatchTemplate>) =>
    setTemplate((current) => ({ ...current, ...patch }));

  function problemText(problem: RowProblem): string {
    if (problem.row < 0) {
      return problem.code === 'vat-rate'
        ? t('batch.problem.vat')
        : t('batch.problem.unknownField', {
            fields: MERGE_FIELDS.map((f) => `{{${f}}}`).join(' '),
          });
    }
    return t('batch.problem.row', {
      row: problem.row + 1,
      field: t(`batch.col.${problem.field as BatchColumn}`),
      problem: t(`batch.problem.${problem.code as 'missing'}`),
    });
  }

  async function press() {
    setBusy(true);
    try {
      const result = await client.sendBatch({
        key,
        confirmed: true,
        template,
        subject: subject.trim(),
        message,
        rows,
        ...(testToMe && user ? { testTo: user.email } : {}),
      });
      setQueued(result.items.map((item) => ({ id: item.id, to: item.to })));
      setStep('done');
    } catch {
      toast.show(t('send.failed'), 'error');
    } finally {
      setBusy(false);
    }
  }

  const nav = (back: Step | null, next: Step | null, nextLabel: string, ready: boolean) => (
    <div className="row">
      {back && (
        <button type="button" className="button button--quiet" onClick={() => setStep(back)}>
          {t('send.confirm.back')}
        </button>
      )}
      {next && (
        <button
          type="button"
          className="button"
          disabled={!ready}
          onClick={() => {
            if (next === 'confirm') setKey(crypto.randomUUID());
            setStep(next);
          }}
        >
          {nextLabel}
        </button>
      )}
    </div>
  );

  const stepper = step !== 'done' && (
    <ol className="row small muted" aria-label={t('send.tab.batch')}>
      {STEPS.map((name) => (
        <li key={name} aria-current={name === step ? 'step' : undefined}>
          {name === step ? <strong>{t(`batch.step.${name}`)}</strong> : t(`batch.step.${name}`)}
        </li>
      ))}
    </ol>
  );

  if (step === 'done') {
    return (
      <div className="stack" data-testid="batch-done">
        <h2>{t('send.done')}</h2>
        <Delivery recipients={queued} />
      </div>
    );
  }

  return (
    <div className="stack" data-testid="batch">
      {stepper}

      {step === 'list' && (
        <div className="stack">
          <ListStep
            list={list}
            intro={t('batch.list.intro', { count: SEND_LIMITS.batch })}
            cap={SEND_LIMITS.batch}
            capText={t('batch.cap', { count: SEND_LIMITS.batch })}
          />
          {nav(null, 'layout', t('batch.next'), rows.length > 0 && !tooMany)}
        </div>
      )}

      {step === 'layout' && (
        <form
          className="stack"
          onSubmit={(event) => {
            event.preventDefault();
          }}
        >
          <div className="row" role="radiogroup" aria-label={t('batch.layout')}>
            {BATCH_LAYOUTS.map((layout) => (
              <button
                key={layout}
                type="button"
                role="radio"
                aria-checked={template.layout === layout}
                className={template.layout === layout ? 'button' : 'button button--quiet'}
                onClick={() => setLayout(layout)}
              >
                {t(`batch.layout.${layout}`)}
              </button>
            ))}
          </div>
          <div className="row">
            <label className="field">
              <span>{t('batch.language')}</span>
              <select value={template.locale} onChange={(e) => edit({ locale: e.target.value })}>
                {LOCALE_CODES.map((code) => (
                  <option key={code} value={code}>
                    {localeLabel(code, locale)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{t('batch.currency')}</span>
              <select
                value={template.currency}
                onChange={(e) => edit({ currency: e.target.value as BatchTemplate['currency'] })}
              >
                {SEND_CURRENCIES.map((code) => (
                  <option key={code}>{code}</option>
                ))}
              </select>
            </label>
          </div>
          <label className="field">
            <span>{t('batch.title')}</span>
            <input value={template.title} onChange={(e) => edit({ title: e.target.value })} />
          </label>
          <label className="field">
            <span>{template.layout === 'invoice' ? t('batch.description') : t('batch.text')}</span>
            <textarea
              rows={4}
              value={template.body}
              onChange={(e) => edit({ body: e.target.value })}
            />
          </label>
          {template.layout === 'invoice' && (
            <div className="row">
              <label className="field">
                <span>{t('batch.vat')}</span>
                <input
                  inputMode="decimal"
                  value={template.vatRate ?? ''}
                  onChange={(e) => edit({ vatRate: e.target.value })}
                />
                <span className="small muted">{t('batch.vatHint')}</span>
              </label>
              <label className="field">
                <span>{t('batch.payTo')}</span>
                <input
                  value={template.payTo ?? ''}
                  onChange={(e) => edit({ payTo: e.target.value })}
                />
              </label>
              <label className="field">
                <span>{t('batch.dueOn')}</span>
                <input
                  type="date"
                  value={template.dueOn ?? ''}
                  onChange={(e) => edit(e.target.value ? { dueOn: e.target.value } : {})}
                />
              </label>
            </div>
          )}
          <label className="field">
            <span>{t('send.subject')}</span>
            <input value={subject} onChange={(e) => setSubject(e.target.value)} />
          </label>
          <label className="field">
            <span>{t('send.message')}</span>
            <textarea rows={4} value={message} onChange={(e) => setMessage(e.target.value)} />
          </label>
          <p className="small muted">
            {t('batch.fieldsHint', { fields: MERGE_FIELDS.map((f) => `{{${f}}}`).join(' ') })}
          </p>
          {problems.length > 0 && (
            <div role="alert" className="status-down small" data-testid="batch-problems">
              <p>{t('batch.problems')}</p>
              <ul>
                {problems.slice(0, 10).map((problem, index) => (
                  <li key={index}>{problemText(problem)}</li>
                ))}
              </ul>
            </div>
          )}
          {nav(
            'list',
            'preview',
            t('batch.next'),
            problems.length === 0 && template.title.trim() !== '' && subject.trim() !== '',
          )}
        </form>
      )}

      {step === 'preview' && (
        <Preview
          rows={rows}
          template={template}
          locale={locale}
          footer={nav('layout', 'confirm', t('batch.toConfirm'), true)}
        />
      )}

      {step === 'confirm' && (
        <div className="stack" data-testid="batch-confirm">
          <h2>{t('batch.confirm.heading', { count: rows.length })}</h2>
          <dl className="stack stack--tight">
            <div>
              <dt className="muted small">{t('send.subject')}</dt>
              <dd>{subject.trim()}</dd>
            </div>
            <div>
              <dt className="muted small">{t('batch.layout')}</dt>
              <dd>{t(`batch.layout.${template.layout}`)}</dd>
            </div>
            <div>
              <dt className="muted small">{t('send.to')}</dt>
              <dd className="outgoing__text" data-testid="batch-confirm-to">
                {rows.map((row) => row.email.trim()).join(', ')}
              </dd>
            </div>
          </dl>
          <ModeNote mode={mode?.mode ?? null} />
          {user && (
            <label className="row">
              <input
                type="checkbox"
                checked={testToMe}
                onChange={(event) => setTestToMe(event.target.checked)}
              />
              <span>{t('send.testToMe', { email: user.email })}</span>
            </label>
          )}
          <div className="row">
            <button type="button" className="button" disabled={busy} onClick={() => void press()}>
              <Icon name="email" className="icon--lead" />
              {t('send.confirm.go')}
            </button>
            <button
              type="button"
              className="button button--quiet"
              disabled={busy}
              onClick={() => setStep('preview')}
            >
              {t('send.confirm.back')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

type BatchColumn = 'name' | 'email' | 'amount' | 'reference';

/** The recipients, sortable, with any one's PDF to look at. Nothing here is queued. */
function Preview({
  rows,
  template,
  locale,
  footer,
}: {
  rows: readonly BatchRow[];
  template: BatchTemplate;
  locale: string;
  footer: React.ReactNode;
}) {
  const t = useT();
  const toast = useToast();
  const [sort, setSort] = useState<{ column: SortColumn; direction: 'asc' | 'desc' } | null>(null);
  const [open, setOpen] = useState<{ index: number; blob: Blob } | null>(null);
  const [seen, setSeen] = useState<ReadonlySet<number>>(new Set());
  const [working, setWorking] = useState<number | null>(null);

  const order = useMemo(() => {
    const indexed = rows.map((row, index) => ({ ...row, index }));
    return sort ? sortedRows(indexed, sort.column, sort.direction, locale) : indexed;
  }, [rows, sort, locale]);

  async function show(index: number) {
    setWorking(index);
    try {
      const blob = await client.previewBatch({ template, row: rows[index]! });
      setOpen({ index, blob });
      setSeen((current) => new Set(current).add(index));
    } catch {
      toast.show(t('batch.previewFailed'), 'error');
    } finally {
      setWorking(null);
    }
  }

  const header = (column: SortColumn) => {
    const active = sort?.column === column ? sort.direction : null;
    return (
      <th aria-sort={active === 'asc' ? 'ascending' : active === 'desc' ? 'descending' : 'none'}>
        <button
          type="button"
          className="button button--quiet small"
          title={t('batch.sortBy', { column: t(`batch.col.${column}`) })}
          onClick={() =>
            setSort({
              column,
              direction: active === 'asc' ? 'desc' : 'asc',
            })
          }
        >
          {t(`batch.col.${column}`)}
          {active && <span aria-hidden="true">{active === 'asc' ? ' ↑' : ' ↓'}</span>}
        </button>
      </th>
    );
  };

  return (
    <div className="stack" data-testid="batch-preview">
      <p className="small" aria-live="polite" data-testid="batch-seen">
        {t('batch.seen', { done: seen.size, total: rows.length })}
      </p>
      <div className="table-scroll">
        <table className="grid">
          <thead>
            <tr>
              {header('name')}
              {header('email')}
              {header('amount')}
              {header('reference')}
              <th>{/* the preview button; the header would only repeat it */}</th>
            </tr>
          </thead>
          <tbody>
            {order.map((row) => (
              <tr key={row.index} data-seen={seen.has(row.index)}>
                <td>{row.name}</td>
                <td>{row.email}</td>
                <td className="grid__amount">{row.amount}</td>
                <td>{row.reference}</td>
                <td>
                  <button
                    type="button"
                    className="button button--quiet small"
                    disabled={working !== null}
                    onClick={() => void show(row.index)}
                  >
                    {working === row.index ? t('batch.previewing') : t('batch.preview')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {open && (
        <PdfPages
          key={open.index}
          blob={open.blob}
          title={t('batch.previewTitle', { name: rows[open.index]!.name })}
        />
      )}
      {footer}
    </div>
  );
}

/** The first pages of a PDF drawn here, with pdf.js: a frame of the PDF would be blocked by the page's policy. */
function PdfPages({ blob, title }: { blob: Blob; title: string }) {
  const [pdf, setPdf] = useState<PaperPdf | null>(null);
  useEffect(() => {
    let opened: PaperPdf | null = null;
    let cancelled = false;
    void blob
      .arrayBuffer()
      .then(openPdf)
      .then((made) => {
        if (cancelled) void made.close();
        else {
          opened = made;
          setPdf(made);
        }
      });
    return () => {
      cancelled = true;
      if (opened) void opened.close();
    };
  }, [blob]);
  return (
    <div className="send__pages" role="group" aria-label={title} data-testid="batch-frame">
      {pdf &&
        Array.from({ length: Math.min(pdf.pageCount, 3) }, (_, page) => (
          <PdfPage key={page} pdf={pdf} page={page} />
        ))}
    </div>
  );
}

function PdfPage({ pdf, page }: { pdf: PaperPdf; page: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const drawing = new AbortController();
    pdf.render(page, 560, element, drawing.signal).catch(() => {});
    return () => drawing.abort();
  }, [pdf, page]);
  return <canvas ref={canvas} className="send__page" />;
}
