import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { localeLabel } from '@tp/i18n';
import type { AiBridge, AiProblem, TextTask } from '@tp/shared/ai';
import { mustQuote } from '@tp/shared/quoted';
import {
  PROOFREAD_LIMITS,
  SHORT_MATERIAL,
  digitCheck,
  missingSpans,
  REPLY_LIMITS,
  REPLY_TONES,
  SUMMARY_LOCALES,
  isSummaryLocale,
  localeOfText,
  replyFlags,
  translateInto,
  type ReplyTone,
  type SummaryLocale,
} from '@tp/shared/summary';
import { useConfirm } from '../../components/Confirm.js';
import type { EmailAbout } from '../../lib/email-about-handoff.js';
import { Icon } from '../../components/Icon.js';
import { useT } from '../../lib/i18n.js';
import { useSession } from '../../lib/session.js';
import { useReplyJob } from './reply-job.js';

/**
 * "Help me reply": a small writing aid under the message box (docs/plan/AI-SYSTEM.md D6), not a
 * chat. Paste the message you received, or leave it empty and write from your own notes; choose a
 * language and a tone; the model on this computer writes a draft you can make shorter, translate,
 * revise or write again, edit by hand, and then insert, copy or discard.
 *
 * The received message is untrusted and goes to the model as quoted data; the model has no tools.
 * Nothing here sends anything, and the draft is never inserted over text in the message box
 * without asking. Everything is in memory: nothing is stored, and closing the panel forgets it
 * (`bundle-split.test.ts` keeps it from reaching the server or any storage). Contracts, consents,
 * declarations and clinical messages get a neutral acknowledgement only (ADR 0012).
 */
export default function ReplyPanel({
  bridge,
  message,
  onInsert,
  about = null,
}: {
  bridge: AiBridge;
  /** What the message box holds now. */
  message: string;
  onInsert: (text: string) => void;
  /**
   * Something handed over to write an email about (a summary, or review comments on a text): it
   * stands where the received message does, as quoted data, and a first draft is a corporate email
   * about it. Shorter, translate and revise work on the draft as they do for a reply.
   */
  about?: EmailAbout | null;
}) {
  const t = useT();
  const confirm = useConfirm();
  const { locale } = useSession();
  const { state, start, cancel } = useReplyJob(bridge);

  const [installed, setInstalled] = useState<boolean | null>(null);
  const [received, setReceived] = useState(about?.material ?? '');
  const [recipient, setRecipient] = useState(about?.recipient ?? '');
  const [overall, setOverall] = useState<'good' | 'mixed'>(about?.overall ?? 'good');
  const [notes, setNotes] = useState('');
  const [into, setInto] = useState<SummaryLocale>(
    isSummaryLocale(locale) && translateInto(locale) === 'draft' ? locale : 'en-GB',
  );
  const [chosen, setChosen] = useState(false);
  const [tone, setTone] = useState<ReplyTone>(about ? 'formal' : 'professional');
  const [draft, setDraft] = useState('');
  const [draftLanguage, setDraftLanguage] = useState<SummaryLocale>(into);
  const [target, setTarget] = useState<SummaryLocale>(into === 'en-GB' ? 'sv-SE' : 'en-GB');
  const [instruction, setInstruction] = useState('');
  /** What the writer has asked for in words: the draft may take its numbers from these too. */
  const [asked, setAsked] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);
  const [inserted, setInserted] = useState(false);
  const before = useRef('');
  const first = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    first.current?.focus();
  }, []);

  useEffect(() => {
    let alive = true;
    void bridge.status().then((status) => {
      if (!alive) return;
      const model = status.models.find((m) => m.capabilities.includes('text') && m.available);
      setInstalled(model ? model.state === 'installed' || model.state === 'busy' : false);
    });
    return () => {
      alive = false;
    };
  }, [bridge]);

  // The draft is the model's while it writes, then the person's to edit. A task that did not finish
  // leaves the draft as it was.
  useEffect(() => {
    if (state.phase === 'done') setDraft(state.text);
    if (state.phase === 'failed') setDraft(before.current);
  }, [state.phase, state.text]);

  const running = state.phase === 'running';
  const shown = running ? state.text : draft;
  const missing =
    installed === false || state.problem === 'not-installed' || state.problem === 'damaged';
  const neutral = useMemo(
    () => mustQuote([received, notes, draft].join('\n')).quoteOnly,
    [received, notes, draft],
  );
  const flags = useMemo(
    () =>
      draft.trim() === '' ? null : replyFlags(draft, [received, notes, ...asked], draftLanguage),
    [draft, received, notes, asked, draftLanguage],
  );
  const tooLong =
    received.length > REPLY_LIMITS.received ||
    notes.length > REPLY_LIMITS.notes ||
    draft.length > REPLY_LIMITS.draft;
  const canWrite = installed === true && !running && !tooLong;
  const canGenerate = canWrite && (received.trim() !== '' || notes.trim() !== '');
  const hasDraft = draft.trim() !== '' && !running;
  /** A review has to quote what it is about; the draft is checked as the writer edits it. */
  const unquoted = about && hasDraft ? missingSpans(draft, about.quotes) : [];
  /** An email about a summary keeps the summary's numbers (a long text may leave some out). */
  const dropped =
    about?.purpose === 'summary' && hasDraft && received.length <= SHORT_MATERIAL
      ? digitCheck(received, draft).missing
      : [];

  function run(task: TextTask, language: SummaryLocale) {
    before.current = draft;
    setCopied(false);
    setInserted(false);
    setDraftLanguage(language);
    void start(task);
  }

  const context = { received, notes, into, tone } as const;
  const generate = () =>
    run(
      about
        ? {
            kind: 'compose-email',
            purpose: about.purpose,
            material: received,
            recipient,
            notes,
            into,
            tone,
            overall,
            quotes: about.quotes,
          }
        : { kind: 'draft-reply', ...context },
      into,
    );
  const shorter = () =>
    run({ kind: 'shorten-reply', ...context, into: draftLanguage, draft }, draftLanguage);
  const translate = () => run({ kind: 'translate-reply', ...context, into: target, draft }, target);
  const revise = () => {
    const text = instruction.trim();
    if (text === '') return;
    setAsked((list) => [...list, text]);
    setInstruction('');
    run(
      { kind: 'revise-reply', ...context, into: draftLanguage, draft, instruction: text },
      draftLanguage,
    );
  };

  function onReceived(text: string) {
    setReceived(text);
    // The reply goes out in the language of the message, until the writer has chosen another.
    if (!chosen) {
      const found = localeOfText(text);
      if (found && translateInto(found) === 'draft') setInto(found);
    }
  }

  async function insert() {
    if (message.trim() !== '') {
      const yes = await confirm(t('reply.overwrite'), {
        confirmLabel: t('reply.overwrite.yes'),
        danger: false,
      });
      if (!yes) return;
    }
    onInsert(draft);
    setInserted(true);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(draft);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  function discard() {
    cancel();
    setDraft('');
    setAsked([]);
    setCopied(false);
    setInserted(false);
  }

  const problem: AiProblem | null = state.phase === 'failed' ? state.problem : null;
  const problemKey = (p: AiProblem) =>
    p === 'not-available' || p === 'consent-required' ? 'failed' : p;
  const status = running
    ? state.step
      ? t(`summary.step.${state.step.step}`, { done: state.step.done + 1, total: state.step.total })
      : t('summary.step.loading')
    : inserted
      ? t('reply.inserted')
      : state.phase === 'done'
        ? t('reply.done')
        : '';

  const languages = (disabled: (code: SummaryLocale) => boolean) =>
    SUMMARY_LOCALES.map((code) => (
      <option key={code} value={code} disabled={disabled(code)}>
        {localeLabel(code)}
      </option>
    ));
  const refused = (code: SummaryLocale) => translateInto(code) === 'no';

  return (
    <section className="card stack" aria-labelledby="reply-heading" data-testid="reply-panel">
      <h3 id="reply-heading">{t('reply.heading')}</h3>
      <p className="muted small">{t('reply.privacy')}</p>

      {missing ? (
        <p role="alert" data-testid="reply-no-model">
          {t('reply.noModel')} <Link to="/ai-setup">{t('reply.noModelLink')}</Link>
        </p>
      ) : null}

      <label className="field">
        <span>{about ? t('about.material') : t('reply.received')}</span>
        <textarea
          ref={first}
          rows={5}
          value={received}
          disabled={running}
          readOnly={about !== null}
          aria-describedby={about ? undefined : 'reply-received-hint'}
          onChange={(event) => onReceived(event.target.value)}
        />
        {about ? null : (
          <span id="reply-received-hint" className="small muted">
            {t('reply.receivedHint')}
          </span>
        )}
      </label>
      {about ? (
        <div className="row">
          <label className="field">
            <span>{t('about.recipient')}</span>
            <input
              value={recipient}
              maxLength={PROOFREAD_LIMITS.recipient}
              disabled={running}
              onChange={(event) => setRecipient(event.target.value)}
            />
          </label>
          {about.purpose === 'feedback' ? (
            <label className="field">
              <span>{t('proof.email.overall')}</span>
              <select
                value={overall}
                disabled={running}
                onChange={(event) => setOverall(event.target.value as 'good' | 'mixed')}
              >
                <option value="good">{t('proof.email.good')}</option>
                <option value="mixed">{t('proof.email.mixed')}</option>
              </select>
            </label>
          ) : null}
        </div>
      ) : null}
      <label className="field">
        <span>{t('reply.notes')}</span>
        <textarea
          rows={3}
          value={notes}
          disabled={running}
          onChange={(event) => setNotes(event.target.value)}
        />
      </label>
      <div className="row">
        <label className="field">
          <span>{t('reply.language')}</span>
          <select
            value={into}
            disabled={running}
            onChange={(event) => {
              setInto(event.target.value as SummaryLocale);
              setChosen(true);
            }}
          >
            {languages(refused)}
          </select>
        </label>
        <label className="field">
          <span>{t('reply.tone')}</span>
          <select
            value={tone}
            disabled={running}
            onChange={(event) => setTone(event.target.value as ReplyTone)}
          >
            {REPLY_TONES.map((value) => (
              <option key={value} value={value}>
                {t(`reply.tone.${value}`)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {refused('is-IS') && into === 'is-IS' ? (
        <p className="muted small">{t('summary.is.translate')}</p>
      ) : null}
      {neutral && (received.trim() !== '' || notes.trim() !== '') ? (
        <p role="note" data-testid="reply-neutral">
          {t('reply.neutral')}
        </p>
      ) : null}
      <p className="muted small">{t('summary.expect')}</p>

      <div className="row">
        <button type="button" className="button" disabled={!canGenerate} onClick={generate}>
          {about ? t('about.write') : t('reply.generate')}
        </button>
        {running ? (
          <button type="button" className="button button--quiet" onClick={cancel}>
            {t('summary.stop')}
          </button>
        ) : null}
      </div>

      <p role="status" aria-live="polite" className={status ? 'small' : 'visually-hidden'}>
        {status}
      </p>
      {problem && !missing ? (
        <p className="status-down" role="alert">
          {t(`summary.problem.${problemKey(problem)}`)}
        </p>
      ) : null}

      {shown !== '' ? (
        <div className="stack" data-testid="reply-draft-area">
          <p id="reply-label" className="muted small">
            {t('reply.label')}
          </p>
          <label className="field">
            <span className="visually-hidden">{t('reply.draft')}</span>
            <textarea
              rows={8}
              value={shown}
              readOnly={running}
              lang={draftLanguage.slice(0, 2)}
              aria-describedby="reply-label"
              data-testid="reply-draft"
              onChange={(event) => {
                setDraft(event.target.value);
                setInserted(false);
              }}
            />
          </label>
          {hasDraft && flags ? (
            <div className="stack stack--tight">
              {flags.invented.length > 0 ? (
                <p className="status-down" role="alert" data-testid="reply-warn-numbers">
                  {t('reply.warn.numbers', { numbers: flags.invented.join(', ') })}
                </p>
              ) : null}
              {unquoted.length > 0 ? (
                <p className="status-down" role="alert" data-testid="reply-warn-spans">
                  {t('about.spans', { spans: unquoted.map((span) => `“${span}”`).join(', ') })}
                </p>
              ) : null}
              {dropped.length > 0 ? (
                <p className="status-down" role="alert" data-testid="reply-warn-dropped">
                  {t('about.missing', { numbers: dropped.join(', ') })}
                </p>
              ) : null}
              {flags.attachment ? (
                <p className="status-down" role="alert" data-testid="reply-warn-attachment">
                  {t('reply.warn.attachment')}
                </p>
              ) : null}
              {flags.wrongLanguage ? (
                <p className="status-down" role="alert" data-testid="reply-warn-language">
                  {t('reply.warn.language')}
                </p>
              ) : null}
              {state.warnings.some((w) => w.kind === 'repetition') ? (
                <p className="status-down" role="alert">
                  {t('summary.warn.repetition')}
                </p>
              ) : null}
              {flags.placeholders > 0 ? (
                <p className="small" data-testid="reply-placeholders">
                  {t('reply.placeholders', { count: flags.placeholders })}
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="row">
            <button
              type="button"
              className="button button--quiet"
              disabled={!canWrite || !hasDraft}
              onClick={shorter}
            >
              {t('reply.shorter')}
            </button>
            <button
              type="button"
              className="button button--quiet"
              disabled={!canWrite || !hasDraft}
              onClick={generate}
            >
              {t('reply.regenerate')}
            </button>
          </div>
          <div className="row">
            <label className="field field--inline">
              <span>{t('reply.translateTo')}</span>
              <select
                value={target}
                disabled={running}
                onChange={(event) => setTarget(event.target.value as SummaryLocale)}
              >
                {languages(refused)}
              </select>
            </label>
            <button
              type="button"
              className="button button--quiet"
              disabled={!canWrite || !hasDraft || neutral || target === draftLanguage}
              onClick={translate}
            >
              {t('reply.translate')}
            </button>
          </div>
          <div className="row">
            <label className="field field--inline">
              <span>{t('reply.revise')}</span>
              <input
                value={instruction}
                maxLength={REPLY_LIMITS.instruction}
                disabled={running}
                onChange={(event) => setInstruction(event.target.value)}
                onKeyDown={(event) => {
                  // Enter here asks for the change; it must not reach the form around the panel.
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    if (canWrite && hasDraft) revise();
                  }
                }}
              />
            </label>
            <button
              type="button"
              className="button button--quiet"
              disabled={!canWrite || !hasDraft || instruction.trim() === ''}
              onClick={revise}
            >
              {t('reply.reviseGo')}
            </button>
          </div>

          <div className="row">
            <button
              type="button"
              className="button"
              disabled={!hasDraft}
              onClick={() => void insert()}
            >
              <Icon name="email" className="icon--lead" />
              {t('reply.insert')}
            </button>
            <button
              type="button"
              className="button button--quiet"
              disabled={!hasDraft}
              onClick={() => void copy()}
            >
              <Icon name="copy" className="icon--lead" />
              {copied ? t('summary.copied') : t('summary.copy')}
            </button>
            <button type="button" className="button button--quiet" onClick={discard}>
              {t('reply.discard')}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
