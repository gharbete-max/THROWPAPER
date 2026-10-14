import { lazy, Suspense, useMemo, useState } from 'react';
import {
  CAMPAIGN_FIELDS,
  SEND_LIMITS,
  UNSUBSCRIBE_PLACEHOLDER,
  checkCampaign,
  normaliseAddress,
  renderCampaign,
  uniqueRecipients,
  type BatchRow,
  type CampaignProblem,
} from '@tp/shared/api';
import { client } from '../lib/api.js';
import { useT } from '../lib/i18n.js';
import { useSession } from '../lib/session.js';
import { useToast } from '../lib/toast.js';
import { sortedRows, type SortColumn } from '../lib/send-rows.js';
import { blocks } from '../lib/address-hygiene.js';
import { PlainTextView } from './PlainTextView.js';
import { Icon } from '../components/Icon.js';
import { Loading } from '../components/Loading.js';
import { Delivery, ModeNote, useSendMode } from './send-parts.js';
import { ListStep, useList } from './send-list.js';
import { ReplyHelp } from './send/ReplyHelp.js';

const Suppressions = lazy(() =>
  import('./Suppressions.js').then((m) => ({ default: m.Suppressions })),
);

type Step = 'list' | 'write' | 'preview' | 'confirm' | 'done';
const STEPS: readonly Step[] = ['list', 'write', 'preview', 'confirm'];

/**
 * One plain email to each person on a list (Documents, "Campaigns"): the list, the words, a
 * preview of any recipient's own message, a test to yourself, and the confirmation that says how
 * many. The footer — who is sending, why this person got it, how to stop — is a field you type;
 * nothing here writes it, and the way on is closed until it is there and holds the unsubscribe
 * link. Addresses on the organisation's suppression list are left out and counted. The server
 * checks all of it again and queues nothing without the confirmation.
 */
export function SendCampaign() {
  const t = useT();
  const toast = useToast();
  const { locale, user } = useSession();
  const mode = useSendMode();
  const list = useList({ duplicates: true });

  const [step, setStep] = useState<Step>('list');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [footer, setFooter] = useState('');
  const [key, setKey] = useState('');
  const [testToMe, setTestToMe] = useState(false);
  const [busy, setBusy] = useState(false);
  const [managing, setManaging] = useState(false);
  const [suppressed, setSuppressed] = useState<ReadonlySet<string>>(new Set());
  const [queued, setQueued] = useState<{ id: string; to: string }[]>([]);
  const [leftOut, setLeftOut] = useState<string[]>([]);

  const audience = useMemo(() => uniqueRecipients(list.rows), [list.rows]);
  const problems = useMemo(
    () => checkCampaign(subject, body, footer, list.rows),
    [subject, body, footer, list.rows],
  );
  const link = UNSUBSCRIBE_PLACEHOLDER;
  const fields = CAMPAIGN_FIELDS.map((f) => `{{${f}}}`).join(' ');
  const receiving = audience.filter((row) => !suppressed.has(normaliseAddress(row.email)));

  function problemText(problem: CampaignProblem): string {
    if (problem.row >= 0) {
      return t('batch.problem.row', {
        row: problem.row + 1,
        field: t(`batch.col.${problem.field as 'name'}`),
        problem: t(
          problem.code === 'bad-email' ? 'batch.problem.bad-email' : 'batch.problem.missing',
        ),
      });
    }
    switch (problem.code) {
      case 'footer-missing':
        return t('campaign.problem.footerMissing');
      case 'footer-no-link':
        return t('campaign.problem.footerNoLink', { link });
      case 'too-many':
        return t('campaign.cap', { count: SEND_LIMITS.campaign });
      default:
        return t('campaign.problem.unknownField', { fields: `${fields} ${link}` });
    }
  }

  async function toConfirm() {
    // One key per confirmation: pressing twice is the same press.
    setKey(crypto.randomUUID());
    try {
      const answer = await client.campaignAudience(audience.map((row) => row.email));
      setSuppressed(new Set(answer.suppressed));
    } catch {
      setSuppressed(new Set());
    }
    setStep('confirm');
  }

  /** The first recipient's own message, to the sender alone, marked as a test. */
  async function testFirst() {
    if (!user || !audience[0]) return;
    setBusy(true);
    try {
      await client.sendCampaign({
        key: crypto.randomUUID(),
        confirmed: true,
        testTo: user.email,
        subject: subject.trim(),
        body,
        footer,
        rows: [audience[0]],
      });
      toast.show(t('campaign.testQueued', { email: user.email }));
    } catch {
      toast.show(t('send.failed'), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function press() {
    setBusy(true);
    try {
      const result = await client.sendCampaign({
        key,
        confirmed: true,
        subject: subject.trim(),
        body,
        footer,
        rows: list.rows,
        ...(testToMe && user ? { testTo: user.email } : {}),
      });
      setQueued(result.items.map((item) => ({ id: item.id, to: item.to })));
      setLeftOut(result.skipped);
      setStep('done');
    } catch {
      toast.show(t('send.failed'), 'error');
    } finally {
      setBusy(false);
    }
  }

  const nav = (back: Step | null, next: Step | null, label: string, ready: boolean) => (
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
          onClick={() => (next === 'confirm' ? void toConfirm() : setStep(next))}
        >
          {label}
        </button>
      )}
    </div>
  );

  if (managing) {
    return (
      <Suspense fallback={<Loading />}>
        <Suppressions onClose={() => setManaging(false)} />
      </Suspense>
    );
  }

  if (step === 'done') {
    return (
      <div className="stack" data-testid="campaign-done">
        <h2>{t('send.done')}</h2>
        {leftOut.length > 0 && (
          <p className="small" data-testid="campaign-left-out">
            {t('campaign.leftOut.done', { list: leftOut.join(', ') })}
          </p>
        )}
        <Delivery recipients={queued} />
      </div>
    );
  }

  return (
    <div className="stack" data-testid="campaign">
      <ol className="row small muted" aria-label={t('send.tab.campaign')}>
        {STEPS.map((name) => (
          <li key={name} aria-current={name === step ? 'step' : undefined}>
            {name === step ? (
              <strong>{t(`campaign.step.${name}`)}</strong>
            ) : (
              t(`campaign.step.${name}`)
            )}
          </li>
        ))}
      </ol>
      <div className="row">
        <button
          type="button"
          className="button button--quiet small"
          onClick={() => setManaging(true)}
        >
          {t('suppress.open')}
        </button>
      </div>

      {step === 'list' && (
        <div className="stack">
          <ListStep
            list={list}
            intro={t('campaign.list.intro', { count: SEND_LIMITS.campaign })}
            cap={SEND_LIMITS.campaign}
            capText={t('campaign.cap', { count: SEND_LIMITS.campaign })}
          />
          <p className="small" aria-live="polite" data-testid="campaign-audience">
            {t('campaign.audience', { count: audience.length })}
          </p>
          {nav(
            null,
            'write',
            t('batch.next'),
            audience.length > 0 &&
              list.rows.length <= SEND_LIMITS.campaign &&
              !list.issues.some(blocks),
          )}
        </div>
      )}

      {step === 'write' && (
        <form className="stack" onSubmit={(event) => event.preventDefault()}>
          <label className="field">
            <span>{t('send.subject')}</span>
            <input value={subject} onChange={(e) => setSubject(e.target.value)} />
          </label>
          <label className="field">
            <span>{t('campaign.body')}</span>
            <textarea rows={8} value={body} onChange={(e) => setBody(e.target.value)} />
          </label>
          <ReplyHelp message={body} onInsert={setBody} />
          <p className="small muted">
            {t('campaign.fieldsHint', { fields, example: '{{name | …}}' })}
          </p>
          <label className="field">
            <span>{t('campaign.footer')}</span>
            <textarea rows={4} value={footer} onChange={(e) => setFooter(e.target.value)} />
            <span className="small muted">{t('campaign.footerHint', { link })}</span>
          </label>
          <p className="small muted">{t('campaign.noTracking')}</p>
          {problems.length > 0 && (subject || body || footer) && (
            <div role="alert" className="status-down small" data-testid="campaign-problems">
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
            problems.length === 0 && subject.trim() !== '' && body.trim() !== '',
          )}
        </form>
      )}

      {step === 'preview' && (
        <Preview
          rows={audience}
          locale={locale}
          request={{ subject, body, footer }}
          testAddress={user?.email ?? null}
          footer={nav('write', 'confirm', t('batch.toConfirm'), true)}
        />
      )}

      {step === 'confirm' && (
        <div className="stack" data-testid="campaign-confirm">
          <h2>{t('campaign.confirm.heading', { count: receiving.length })}</h2>
          <dl className="stack stack--tight">
            <div>
              <dt className="muted small">{t('send.subject')}</dt>
              <dd>{subject.trim()}</dd>
            </div>
            <div>
              <dt className="muted small">{t('campaign.footer')}</dt>
              <dd className="outgoing__text">{footer.trim()}</dd>
            </div>
            <div>
              <dt className="muted small">{t('send.to')}</dt>
              <dd className="outgoing__text" data-testid="campaign-confirm-to">
                {receiving.map((row) => row.email.trim()).join(', ')}
              </dd>
            </div>
          </dl>
          <p className="small" data-testid="campaign-counts">
            {t('hygiene.counts', {
              send: receiving.length,
              skipped: list.total - audience.length,
            })}
          </p>
          {suppressed.size > 0 && (
            <p className="small" data-testid="campaign-suppressed">
              {t('campaign.leftOut', { count: audience.length - receiving.length })}
            </p>
          )}
          <ModeNote mode={mode?.mode ?? null} />
          {user && (
            <div className="card stack stack--tight" data-testid="campaign-test-first">
              <p className="small">{t('campaign.testFirstHint')}</p>
              <div className="row">
                <button
                  type="button"
                  className="button"
                  disabled={busy}
                  onClick={() => void testFirst()}
                >
                  <Icon name="email" className="icon--lead" />
                  {t('campaign.testFirst')}
                </button>
              </div>
            </div>
          )}
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

/** The recipients, sortable, with any one's own message to read and a test of it to yourself. */
function Preview({
  rows,
  locale,
  request,
  testAddress,
  footer,
}: {
  rows: readonly BatchRow[];
  locale: string;
  request: { subject: string; body: string; footer: string };
  testAddress: string | null;
  footer: React.ReactNode;
}) {
  const t = useT();
  const toast = useToast();
  const [sort, setSort] = useState<{ column: SortColumn; direction: 'asc' | 'desc' } | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [seen, setSeen] = useState<ReadonlySet<number>>(new Set());
  const [working, setWorking] = useState<number | null>(null);

  const order = useMemo(() => {
    const indexed = rows.map((row, index) => ({ ...row, index }));
    return sort ? sortedRows(indexed, sort.column, sort.direction, locale) : indexed;
  }, [rows, sort, locale]);

  async function test(index: number) {
    if (!testAddress) return;
    setWorking(index);
    try {
      await client.sendCampaign({
        key: crypto.randomUUID(),
        confirmed: true,
        testTo: testAddress,
        ...request,
        subject: request.subject.trim(),
        rows: [rows[index]!],
      });
      toast.show(t('campaign.testQueued', { email: testAddress }));
    } catch {
      toast.show(t('send.failed'), 'error');
    } finally {
      setWorking(null);
    }
  }

  const header = (column: 'name' | 'email') => {
    const active = sort?.column === column ? sort.direction : null;
    return (
      <th aria-sort={active === 'asc' ? 'ascending' : active === 'desc' ? 'descending' : 'none'}>
        <button
          type="button"
          className="button button--quiet small"
          title={t('batch.sortBy', { column: t(`batch.col.${column}`) })}
          onClick={() => setSort({ column, direction: active === 'asc' ? 'desc' : 'asc' })}
        >
          {t(`batch.col.${column}`)}
          {active && <span aria-hidden="true">{active === 'asc' ? ' ↑' : ' ↓'}</span>}
        </button>
      </th>
    );
  };

  const message =
    open === null ? null : renderCampaign(request, rows[open]!, t('campaign.previewLink'));

  return (
    <div className="stack" data-testid="campaign-preview">
      <p className="small" aria-live="polite" data-testid="campaign-seen">
        {t('batch.seen', { done: seen.size, total: rows.length })}
      </p>
      <div className="table-scroll">
        <table className="grid">
          <thead>
            <tr>
              {header('name')}
              {header('email')}
              <th>{/* the buttons; the header would only repeat them */}</th>
            </tr>
          </thead>
          <tbody>
            {order.map((row) => (
              <tr key={row.index} data-seen={seen.has(row.index)}>
                <td>{row.name}</td>
                <td>{row.email}</td>
                <td className="row">
                  <button
                    type="button"
                    className="button button--quiet small"
                    onClick={() => {
                      setOpen(row.index);
                      setSeen((current) => new Set(current).add(row.index));
                    }}
                  >
                    {t('batch.preview')}
                  </button>
                  {testAddress && (
                    <button
                      type="button"
                      className="button button--quiet small"
                      disabled={working !== null}
                      onClick={() => void test(row.index)}
                    >
                      {t('campaign.testToMe')}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {message && open !== null && (
        <section
          className="card stack stack--tight"
          aria-label={t('campaign.previewOf', { name: rows[open]!.name || rows[open]!.email })}
          data-testid="campaign-message"
        >
          <p>
            <strong>{message.subject}</strong>
          </p>
          <PlainTextView text={message.text} />
        </section>
      )}
      {footer}
    </div>
  );
}
