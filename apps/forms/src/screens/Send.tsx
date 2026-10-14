import { lazy, Suspense, useRef, useState } from 'react';
import { useLocation } from 'react-router';
import { Email, SEND_LIMITS } from '@tp/shared/api';
import { client } from '../lib/api.js';
import { useT } from '../lib/i18n.js';
import { useSession } from '../lib/session.js';
import { useToast } from '../lib/toast.js';
import { addressesOf, isSendable, sendFileFromState, subjectOf } from '../lib/send-handoff.js';
import { checkAddresses, tokensOf } from '../lib/address-hygiene.js';
import { formatMegabytes as megabytes } from '../lib/attachment-size.js';
import { Icon } from '../components/Icon.js';
import { Loading } from '../components/Loading.js';
import { Delivery, ModeNote, useSendMode } from './send-parts.js';
import { AddressInput, RecentAddresses, useAddressBook } from './AddressInput.js';
import { AddressIssues } from './AddressIssues.js';
import { AttachmentSize } from './AttachmentSize.js';

// The list screen is the larger half and only some people open it.
const SendBatch = lazy(() => import('./SendBatch.js').then((m) => ({ default: m.SendBatch })));
const SendCampaign = lazy(() =>
  import('./SendCampaign.js').then((m) => ({ default: m.SendCampaign })),
);

/**
 * Send — a document, by mail, to someone (Documents, "Send"). Two ways in: one document to some
 * people (this screen, and the place every part hands its PDF to: `sendWith`), or one personalised
 * PDF each from a list (`SendBatch`). Either way the same three steps: write it, look at exactly
 * what will go and to whom (the confirmation, rule 7), and only then queue it. A request that has
 * not been confirmed queues nothing; where the mail goes — a test place, To send, or out — is
 * said before the press and after it (`ModeNote`).
 */
export function Send() {
  const t = useT();
  const [which, setWhich] = useState<'one' | 'batch' | 'campaign'>('one');

  return (
    <section className="stack">
      <header className="stack stack--tight">
        <h1>{t('send.heading')}</h1>
        <p className="muted small">{t('send.intro')}</p>
      </header>
      <div className="row" role="radiogroup" aria-label={t('send.heading')}>
        {(['one', 'batch', 'campaign'] as const).map((choice) => (
          <button
            key={choice}
            type="button"
            role="radio"
            aria-checked={which === choice}
            className={which === choice ? 'button' : 'button button--quiet'}
            onClick={() => setWhich(choice)}
          >
            {t(`send.tab.${choice}`)}
          </button>
        ))}
      </div>
      {which === 'one' ? (
        <SendOne />
      ) : (
        <Suspense fallback={<Loading />}>
          {which === 'batch' ? <SendBatch /> : <SendCampaign />}
        </Suspense>
      )}
    </section>
  );
}

type Step = 'write' | 'confirm' | 'done';

function SendOne() {
  const t = useT();
  const toast = useToast();
  const { user } = useSession();
  const mode = useSendMode();
  const picker = useRef<HTMLInputElement>(null);
  const handed = sendFileFromState(useLocation().state);

  const [file, setFile] = useState<File | null>(handed);
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState(handed ? subjectOf(handed) : '');
  const [message, setMessage] = useState('');
  const [step, setStep] = useState<Step>('write');
  const [key, setKey] = useState('');
  const [testToMe, setTestToMe] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [queued, setQueued] = useState<{ id: string; to: string }[]>([]);

  const addresses = addressesOf(to);
  const book = useAddressBook();
  const tokens = tokensOf(to);
  /** Fixing or skipping a row of the table rewrites the box it came from. */
  const rewrite = (index: number, address: string | null) =>
    setTo(
      tokens
        .flatMap((token, i) => (i !== index ? [token] : address === null ? [] : [address]))
        .join(', '),
    );

  function choose(chosen: File | undefined) {
    if (!chosen) return;
    if (!isSendable(chosen)) return toast.show(t('send.notSupported'), 'error');
    if (chosen.size > SEND_LIMITS.attachmentBytes) {
      return toast.show(t('send.tooLarge'), 'error');
    }
    setFile(chosen);
    setSubject((current) => current || subjectOf(chosen));
  }

  /** The write step's checks, in the person's words. */
  function review() {
    const bad = addresses.filter((address) => !Email.safeParse(address).success);
    if (!file) return setProblem(t('send.noFile'));
    if (addresses.length === 0) return setProblem(t('send.noAddress'));
    if (bad.length > 0) return setProblem(t('send.badAddresses', { list: bad.join(', ') }));
    if (addresses.length > SEND_LIMITS.recipients) {
      return setProblem(t('send.tooMany', { count: SEND_LIMITS.recipients }));
    }
    if (!subject.trim()) return setProblem(t('send.noSubject'));
    setProblem(null);
    // One key per confirmation: pressing twice is the same press.
    setKey(crypto.randomUUID());
    setStep('confirm');
  }

  async function press() {
    if (!file) return;
    setBusy(true);
    try {
      const result = await client.sendDocument({
        file,
        to: addresses,
        subject: subject.trim(),
        message,
        key,
        ...(testToMe && user ? { testTo: user.email } : {}),
      });
      setQueued(result.items.map((item) => ({ id: item.id, to: item.to })));
      if (!testToMe) book.remember(addresses);
      setStep('done');
    } catch {
      toast.show(t('send.failed'), 'error');
    } finally {
      setBusy(false);
    }
  }

  if (step === 'done') {
    return (
      <div className="stack" data-testid="send-done">
        <h2>{t('send.done')}</h2>
        <Delivery recipients={queued} />
        <div className="row">
          <button
            type="button"
            className="button button--quiet"
            onClick={() => {
              setStep('write');
              setQueued([]);
              setTestToMe(false);
            }}
          >
            {t('send.another')}
          </button>
        </div>
      </div>
    );
  }

  if (step === 'confirm' && file) {
    return (
      <div className="stack" data-testid="send-confirm">
        <h2>{t('send.confirm.heading', { count: addresses.length })}</h2>
        <dl className="stack stack--tight">
          <div>
            <dt className="muted small">{t('send.to')}</dt>
            <dd data-testid="send-confirm-to">{addresses.join(', ')}</dd>
          </div>
          <div>
            <dt className="muted small">{t('send.subject')}</dt>
            <dd data-testid="send-confirm-subject">{subject.trim()}</dd>
          </div>
          {message.trim() && (
            <div>
              <dt className="muted small">{t('send.message')}</dt>
              <dd className="outgoing__text">{message}</dd>
            </div>
          )}
          <div>
            <dt className="muted small">{t('send.attachment')}</dt>
            <dd data-testid="send-confirm-file">
              <Icon name="paperclip" className="icon--lead" />
              {file.name} · {megabytes(file.size)}
            </dd>
          </div>
        </dl>
        {/\.docx$/i.test(file.name) && <p className="small muted">{t('send.wordAsIs')}</p>}
        <AttachmentSize file={file} onReplace={setFile} />
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
            onClick={() => setStep('write')}
          >
            {t('send.confirm.back')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <form
      className="stack"
      onSubmit={(event) => {
        event.preventDefault();
        review();
      }}
    >
      <ModeNote mode={mode?.mode ?? null} />
      <div className="row">
        <input
          ref={picker}
          type="file"
          accept="application/pdf,.pdf,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          hidden
          data-testid="send-file"
          onChange={(event) => {
            choose(event.target.files?.[0]);
            event.target.value = '';
          }}
        />
        <button type="button" className="button" onClick={() => picker.current?.click()}>
          <Icon name="upload" className="icon--lead" />
          {file ? t('send.changeFile') : t('send.choose')}
        </button>
        {file && (
          <span className="small" data-testid="send-file-name">
            <Icon name="paperclip" className="icon--lead" />
            {file.name} · {megabytes(file.size)}
          </span>
        )}
      </div>
      {file && /\.docx$/i.test(file.name) && <p className="small muted">{t('send.wordAsIs')}</p>}
      <label className="field">
        <span>{t('send.to')}</span>
        <AddressInput
          value={to}
          onChange={setTo}
          book={book.book}
          label={t('send.to')}
          describedBy="send-to-hint"
        />
        <span id="send-to-hint" className="small muted">
          {t('send.toHint', { count: SEND_LIMITS.recipients })}
        </span>
      </label>
      <RecentAddresses book={book} />
      <AddressIssues
        addresses={tokens}
        // The address still being typed is not looked at until a separator ends it.
        issues={checkAddresses(/[\s,;]$/.test(to) ? tokens : tokens.slice(0, -1))}
        skipped={0}
        onEdit={rewrite}
        onSkip={(index) => rewrite(index, null)}
      />
      <label className="field">
        <span>{t('send.subject')}</span>
        <input value={subject} onChange={(event) => setSubject(event.target.value)} />
      </label>
      <label className="field">
        <span>{t('send.message')}</span>
        <textarea rows={5} value={message} onChange={(event) => setMessage(event.target.value)} />
      </label>
      {problem && (
        <p className="status-down small" role="alert">
          {problem}
        </p>
      )}
      <div className="row">
        <button type="submit" className="button">
          {t('send.review')}
        </button>
      </div>
    </form>
  );
}
