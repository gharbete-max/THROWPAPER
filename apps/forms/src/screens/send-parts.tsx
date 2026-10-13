import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import type { api } from '@tp/shared';
import { client } from '../lib/api.js';
import { useEdition } from '../lib/edition.js';
import { useT } from '../lib/i18n.js';

/** What a send does on this server, asked once per screen. */
export function useSendMode(): api.SendModeResponse | null {
  const [mode, setMode] = useState<api.SendModeResponse | null>(null);
  useEffect(() => {
    let cancelled = false;
    client.sendMode().then(
      (answer) => {
        if (!cancelled) setMode(answer);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, []);
  return mode;
}

const NOTE = {
  'to-send': 'send.mode.toSend',
  test: 'send.mode.test',
  live: 'send.mode.live',
} as const;

/** Where the messages will go, in words — on the write step and again on the confirmation. */
export function ModeNote({ mode }: { mode: api.SendMode | null }) {
  const t = useT();
  if (!mode) return null;
  return (
    <p className="card small" data-testid="send-mode" data-mode={mode} role="note">
      {t(NOTE[mode])}
    </p>
  );
}

/** Which of the status sentences a provider's name earns: waiting for the person, a test, or sent. */
function sentKey(provider: string | null) {
  if (provider === 'queue') return 'send.state.inToSend' as const;
  if (provider !== null && ['console', 'outbox', 'memory'].includes(provider)) {
    return 'send.state.test' as const;
  }
  return 'send.state.sent' as const;
}

interface Recipient {
  id: string;
  to: string;
}

/**
 * What became of each message: queued, then sent or failed. Asks every second until none is still
 * queued (or for a minute, which is longer than a send takes). On the desktop "sent" means "now in
 * To send" and the screen says so, because the app itself sends nothing there.
 */
export function Delivery({ recipients }: { recipients: readonly Recipient[] }) {
  const t = useT();
  const edition = useEdition();
  const [states, setStates] = useState<Record<string, { state: string; provider: string | null }>>(
    {},
  );

  useEffect(() => {
    let cancelled = false;
    let tries = 0;
    async function poll() {
      try {
        const { items } = await client.sendStatus(recipients.map((r) => r.id));
        if (cancelled) return;
        setStates(Object.fromEntries(items.map((i) => [i.id, i])));
        if (items.some((i) => i.state === 'queued') && (tries += 1) < 60) {
          timer = setTimeout(() => void poll(), 1000);
        }
      } catch {
        if (!cancelled && (tries += 1) < 60) timer = setTimeout(() => void poll(), 2000);
      }
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [recipients]);

  return (
    <>
      <div className="table-scroll">
        <table className="grid" data-testid="send-status">
          <thead>
            <tr>
              <th>{t('send.recipient')}</th>
              <th>{t('send.status')}</th>
            </tr>
          </thead>
          <tbody>
            {recipients.map((recipient) => {
              const seen = states[recipient.id];
              const key =
                !seen || seen.state === 'queued'
                  ? ('send.state.queued' as const)
                  : seen.state === 'failed'
                    ? ('send.state.failed' as const)
                    : seen.state === 'skipped'
                      ? ('send.state.skipped' as const)
                      : sentKey(seen.provider);
              return (
                <tr key={recipient.id} data-state={seen?.state ?? 'queued'}>
                  <td>{recipient.to}</td>
                  <td>{t(key)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {edition === 'desktop' && (
        <p>
          <Link className="button" to="/outgoing">
            {t('send.openOutgoing')}
          </Link>
        </p>
      )}
    </>
  );
}
