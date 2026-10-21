import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { localeLabel } from '@tp/i18n';
import type { AiBridge } from '@tp/shared/ai';
import {
  PROOFREAD_LIMITS,
  SUMMARY_LOCALES,
  applyFixes,
  feedbackMaterial,
  isSummaryLocale,
  localeOfText,
  summaryIn,
  type Issue,
  type PageRange,
  type ProofreadKind,
  type SummaryLocale,
} from '@tp/shared/summary';
import { Icon } from '../../../components/Icon.js';
import { emailAboutWith } from '../../../lib/email-about-handoff.js';
import { useT } from '../../../lib/i18n.js';
import { useSession } from '../../../lib/session.js';
import { useReplyJob } from '../../send/reply-job.js';

/**
 * Proofreading: the model on this computer lists mistakes in a text, each with the exact words it
 * means (checked to stand in the text, or dropped), a kind and a fix. The person accepts or ignores
 * each one; accepted fixes go into a COPY shown below and never into the text it came from. The
 * list can become a polite review email, written in Send's compose step (nothing is sent here).
 * Nothing is stored: closing the panel forgets it. Contracts, consents, declarations and clinical
 * texts are held to spelling (`mustQuote`, CLAUDE.md rule 8). The result is labelled generated.
 */
interface Answer {
  issues: Issue[];
  rejected: number;
}

/** What the shell sent back, trusted no more than the shell trusted the model: every span is looked up again. */
function parse(text: string, json: string): Answer | null {
  try {
    const raw = JSON.parse(json) as { issues?: unknown; rejected?: unknown };
    if (!Array.isArray(raw.issues)) return null;
    const issues = (raw.issues as Issue[]).filter(
      (issue) =>
        typeof issue.id === 'number' &&
        typeof issue.span === 'string' &&
        text.slice(issue.start, issue.end) === issue.span,
    );
    return { issues, rejected: typeof raw.rejected === 'number' ? raw.rejected : 0 };
  } catch {
    return null;
  }
}

const CONTEXT = 32;

export default function ProofreadPanel({
  bridge,
  text,
  source,
  pages,
}: {
  bridge: AiBridge;
  text: string;
  /** What a factual doubt is checked against ('' for none). */
  source: string;
  /** Where each page's words stand in `text`, for pointing at pages in the review email. */
  pages: PageRange[];
}) {
  const t = useT();
  const navigate = useNavigate();
  const { locale } = useSession();
  const { state, start, cancel } = useReplyJob(bridge);
  const [into, setInto] = useState<SummaryLocale>(() => {
    const found = localeOfText(text);
    if (found && summaryIn(found) !== 'no') return found;
    return isSummaryLocale(locale) && summaryIn(locale) !== 'no' ? locale : 'en-GB';
  });
  const [marks, setMarks] = useState<ReadonlyMap<number, 'accepted' | 'ignored'>>(new Map());
  const [recipient, setRecipient] = useState('');
  const [overall, setOverall] = useState<'good' | 'mixed'>('good');
  const [copied, setCopied] = useState(false);

  const running = state.phase === 'running';
  const answer = useMemo(
    () => (state.phase === 'done' ? parse(text, state.text) : null),
    [state.phase, state.text, text],
  );
  useEffect(() => setMarks(new Map()), [answer]);

  const issues = useMemo(() => answer?.issues ?? [], [answer]);
  const accepted = useMemo(
    () => new Set([...marks].filter(([, v]) => v === 'accepted').map(([id]) => id)),
    [marks],
  );
  const ignored = [...marks.values()].filter((v) => v === 'ignored').length;
  const copy = useMemo(() => applyFixes(text, issues, accepted), [text, issues, accepted]);
  const kept = issues.filter((issue) => marks.get(issue.id) !== 'ignored');
  const tooLong = text.length > PROOFREAD_LIMITS.text || source.length > PROOFREAD_LIMITS.source;

  function mark(id: number, value: 'accepted' | 'ignored') {
    setMarks((current) => {
      const next = new Map(current);
      if (next.get(id) === value) next.delete(id);
      else next.set(id, value);
      return next;
    });
  }

  function writeEmail() {
    const { material, spans } = feedbackMaterial(kept, pages, (kind) =>
      t(`proof.kind.${kind satisfies ProofreadKind}`),
    );
    navigate(
      ...emailAboutWith({ purpose: 'feedback', material, quotes: spans, recipient, overall }),
    );
  }

  async function copyText() {
    try {
      await navigator.clipboard.writeText(copy);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const step = running
    ? state.step
      ? t(`summary.step.${state.step.step}`, { done: state.step.done + 1, total: state.step.total })
      : t('summary.step.loading')
    : '';

  return (
    <section className="card stack" aria-labelledby="proof-heading" data-testid="proofread-panel">
      <h3 id="proof-heading">{t('proof.heading')}</h3>
      <p className="muted small">{t('proof.privacy')}</p>
      <div className="row">
        <label className="field">
          <span>{t('summary.language')}</span>
          <select
            value={into}
            disabled={running}
            onChange={(event) => setInto(event.target.value as SummaryLocale)}
          >
            {SUMMARY_LOCALES.map((code) => (
              <option key={code} value={code} disabled={summaryIn(code) === 'no'}>
                {localeLabel(code)}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="button"
          disabled={running || tooLong || text.trim() === ''}
          onClick={() => void start({ kind: 'proofread', text, source, into })}
        >
          {t('proof.start')}
        </button>
        {running ? (
          <button type="button" className="button button--quiet" onClick={cancel}>
            {t('summary.stop')}
          </button>
        ) : null}
      </div>
      {tooLong ? (
        <p className="status-down" role="alert">
          {t('summary.problem.too-long')}
        </p>
      ) : null}
      <p role="status" aria-live="polite" className={step ? 'small' : 'visually-hidden'}>
        {step}
      </p>
      {state.phase === 'failed' && state.problem ? (
        <p className="status-down" role="alert">
          {t(
            `summary.problem.${state.problem === 'not-available' || state.problem === 'consent-required' ? 'failed' : state.problem}`,
          )}
        </p>
      ) : null}

      {answer ? (
        <div className="stack" data-testid="proofread-result">
          <p className="muted small">{t('read.result.label')}</p>
          {issues.length === 0 ? <p role="status">{t('proof.none')}</p> : null}
          {answer.rejected > 0 ? (
            <p className="muted small">{t('proof.dropped', { count: answer.rejected })}</p>
          ) : null}
          <ol className="proof__issues">
            {issues.map((issue) => {
              const mine = marks.get(issue.id);
              const page = pages.find((p) => issue.start >= p.start && issue.start < p.end)?.page;
              return (
                <li key={issue.id} className="proof__issue" data-testid="proofread-issue">
                  <span className="small muted">
                    {t(`proof.kind.${issue.kind}`)}
                    {page ? ` · ${t('scan.page', { n: page })}` : ''}
                    {mine
                      ? ` · ${t(mine === 'accepted' ? 'proof.accepted' : 'proof.ignored')}`
                      : ''}
                  </span>
                  <p lang={into.slice(0, 2)} className="summary__text">
                    {text.slice(Math.max(0, issue.start - CONTEXT), issue.start)}
                    <mark>{issue.span}</mark>
                    {text.slice(issue.end, issue.end + CONTEXT)}
                  </p>
                  <p className="small">
                    {issue.fix === null
                      ? t('proof.doubt')
                      : t('proof.suggested', { fix: issue.fix })}
                  </p>
                  <div className="row">
                    {issue.fix !== null ? (
                      <button
                        type="button"
                        className="button button--quiet"
                        aria-pressed={mine === 'accepted'}
                        onClick={() => mark(issue.id, 'accepted')}
                      >
                        {mine === 'accepted' ? t('proof.undo') : t('proof.accept')}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="button button--quiet"
                      aria-pressed={mine === 'ignored'}
                      onClick={() => mark(issue.id, 'ignored')}
                    >
                      {mine === 'ignored' ? t('proof.undo') : t('proof.ignore')}
                    </button>
                  </div>
                </li>
              );
            })}
          </ol>

          {issues.length > 0 ? (
            <>
              <p className="small" role="status">
                {t('proof.tally', {
                  accepted: accepted.size,
                  ignored,
                  open: issues.length - accepted.size - ignored,
                })}
              </p>
              <div className="stack stack--tight">
                <h4>{t('proof.copy.heading')}</h4>
                <p className="muted small">{t('proof.copy.note')}</p>
                <textarea
                  rows={6}
                  readOnly
                  value={copy}
                  lang={into.slice(0, 2)}
                  aria-label={t('proof.copy.heading')}
                  data-testid="proofread-copy"
                />
                <div className="row">
                  <button
                    type="button"
                    className="button button--quiet"
                    onClick={() => void copyText()}
                  >
                    <Icon name="copy" /> {copied ? t('summary.copied') : t('summary.copy')}
                  </button>
                </div>
              </div>
              <div className="stack stack--tight">
                <h4>{t('proof.email.heading')}</h4>
                <div className="row">
                  <label className="field">
                    <span>{t('proof.email.to')}</span>
                    <input
                      value={recipient}
                      maxLength={PROOFREAD_LIMITS.recipient}
                      onChange={(event) => setRecipient(event.target.value)}
                    />
                  </label>
                  <label className="field">
                    <span>{t('proof.email.overall')}</span>
                    <select
                      value={overall}
                      onChange={(event) => setOverall(event.target.value as 'good' | 'mixed')}
                    >
                      <option value="good">{t('proof.email.good')}</option>
                      <option value="mixed">{t('proof.email.mixed')}</option>
                    </select>
                  </label>
                </div>
                <div className="row">
                  <button
                    type="button"
                    className="button"
                    disabled={kept.length === 0}
                    onClick={writeEmail}
                  >
                    <Icon name="email" /> {t('proof.email.write')}
                  </button>
                </div>
                {kept.length === 0 ? <p className="muted small">{t('proof.email.none')}</p> : null}
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
