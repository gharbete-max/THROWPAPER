import { useEffect, useState } from 'react';
import { ApiError, client, type OutgoingList, type OutgoingMessage } from '../lib/api.js';
import { formatDateTime, useT } from '../lib/i18n.js';
import { useSession } from '../lib/session.js';
import { useToast } from '../lib/toast.js';
import { mailtoHref, saveBlob } from '../lib/email-handoff.js';
import { useConfirm } from '../components/Confirm.js';
import { EmptyState } from '../components/EmptyState.js';
import { LoadFailed } from '../components/LoadFailed.js';
import { Loading } from '../components/Loading.js';
import { Icon } from '../components/Icon.js';
import { OUTGOING_CHANGED } from '../lib/edition.js';

/**
 * To send — the desktop's mail, waiting for its person (`api-forms/src/mail/queue.ts`).
 *
 * The offline edition sends nothing by itself. A confirmation with its admission card, the
 * organiser's notice, a signer's invitation: each waits here until somebody opens it in their own
 * email program and presses Send there, from their own account. So this screen never says a
 * message was *sent* — only that it was opened, which is all it can know.
 *
 * Two ways to open one, and the screen says which it will use:
 *
 * - **A mail program the app can drive** (Outlook, Apple Mail): a draft, addressed, with the
 *   attachment already attached.
 * - **The system's email link** (`mailto:`) for anything else: addressed and written, but a link
 *   cannot carry a file (see `email-handoff.ts`), so the attachment is offered to save and the
 *   screen says to attach it.
 */
export function Outgoing() {
  const t = useT();
  const [data, setData] = useState<OutgoingList | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    client.listOutgoing().then(
      (response) => {
        if (!cancelled) setData(response);
      },
      () => {
        if (!cancelled) setFailed(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  if (failed) return <LoadFailed onRetry={() => setAttempt((value) => value + 1)} />;
  if (!data) return <Loading />;

  const reload = () => {
    setAttempt((value) => value + 1);
    // The count beside To send in the sidebar follows without waiting for a navigation.
    window.dispatchEvent(new Event(OUTGOING_CHANGED));
  };

  return (
    <section className="stack">
      <header className="stack stack--tight">
        <h1>{t('outgoing.heading')}</h1>
        <p className="muted small">{t('outgoing.intro')}</p>
      </header>

      {data.messages.length === 0 ? (
        <EmptyState icon="email" title={t('outgoing.empty')} hint={t('outgoing.emptyHint')} />
      ) : (
        <ul className="stack outgoing" aria-label={t('outgoing.heading')}>
          {data.messages.map((message) => (
            <OutgoingCard
              key={message.id}
              message={message}
              program={data.program}
              onChanged={reload}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function OutgoingCard({
  message,
  program,
  onChanged,
}: {
  message: OutgoingMessage;
  program: string | null;
  onChanged: () => void;
}) {
  const t = useT();
  const { locale } = useSession();
  const confirm = useConfirm();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  // A program that turned out not to be there: this message falls back to the email link.
  const [useLink, setUseLink] = useState(program === null);

  async function openInProgram() {
    setBusy(true);
    try {
      await client.openOutgoing(message.id);
      onChanged();
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) setUseLink(true);
      toast.show(t('outgoing.openFailed', { program: program ?? '' }), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    const answer = await confirm(t('outgoing.removeConfirm', { to: message.to }), {
      confirmLabel: t('outgoing.remove'),
    });
    if (!answer) return;
    setBusy(true);
    try {
      await client.removeOutgoing(message.id);
      onChanged();
    } catch {
      toast.show(t('users.errorFailed'), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function save(index: number, filename: string) {
    try {
      saveBlob(await client.outgoingAttachment(message.id, index), filename);
    } catch {
      toast.show(t('file.error.network'), 'error');
    }
  }

  const href = mailtoHref({ subject: message.subject, body: message.text, to: message.to });

  return (
    <li className="card stack stack--tight">
      <div className="row row--between">
        <strong>{message.subject}</strong>
        <span className={message.openedAt ? 'badge badge--quiet' : 'badge'}>
          {message.openedAt
            ? t('outgoing.opened', { when: formatDateTime(locale, message.openedAt) })
            : t('outgoing.waitingOne')}
        </span>
      </div>
      <p className="small">
        <span className="muted">{t('outgoing.to')}</span> {message.to}
        <span className="muted"> · {formatDateTime(locale, message.createdAt)}</span>
      </p>
      <details>
        <summary className="small">{t('outgoing.showText')}</summary>
        <p className="small outgoing__text">{message.text}</p>
      </details>

      {message.attachments.length > 0 && (
        <div className="row">
          {message.attachments.map((attachment, index) => (
            <button
              key={`${index}-${attachment.filename}`}
              type="button"
              className="button button--quiet small attachment"
              title={attachment.filename}
              onClick={() => void save(index, attachment.filename)}
            >
              <Icon name="paperclip" className="icon--lead" />
              {attachment.filename}
            </button>
          ))}
        </div>
      )}
      {useLink && message.attachments.length > 0 && (
        <p className="small muted">{t('outgoing.attachNote')}</p>
      )}

      <div className="row card__actions">
        {useLink ? (
          <a
            className="button"
            href={href}
            onClick={() => {
              // The page cannot see the email app open; it says so to the list instead.
              void client.markOutgoingOpened(message.id).then(onChanged, () => undefined);
            }}
          >
            <Icon name="email" className="icon--lead" />
            {t('outgoing.openEmailApp')}
          </a>
        ) : (
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={() => void openInProgram()}
          >
            <Icon name="email" className="icon--lead" />
            {t('outgoing.openIn', { program: program ?? '' })}
          </button>
        )}
        <button
          type="button"
          className="button button--quiet"
          disabled={busy}
          onClick={() => void remove()}
        >
          <Icon name="trash" className="icon--lead" />
          {t('outgoing.remove')}
        </button>
      </div>
    </li>
  );
}
