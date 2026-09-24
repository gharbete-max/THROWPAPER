import { useEffect, useRef, useState } from 'react';
import type { forms as formSchemas } from '@tp/shared';
import { ApiError, client } from '../lib/api.js';
import { useT } from '../lib/i18n.js';
import { Icon } from './Icon.js';

/** How often the computer asks whether the phone has sent more. */
const POLL_MS = 2000;

type State =
  | { kind: 'opening' }
  | { kind: 'open'; session: formSchemas.PhoneScanSession; pages: number }
  | { kind: 'collecting' }
  | { kind: 'expired' }
  | { kind: 'failed'; reason: 'no-network' | 'failed' };

/**
 * The computer's half of scanning with a phone: a QR code for the phone to open, a count of the
 * pages it has sent, and — when the person says so — those pages, handed on exactly as
 * `CameraScan` hands on its own. On the desktop the phone reaches this computer through a relay
 * that exists only while the code is open (`api-forms/src/desktop/phone-relay.ts`).
 */
export function PhoneScan({
  onDone,
  onBack,
  multiple = true,
}: {
  onDone: (pages: File[]) => void;
  onBack: () => void;
  multiple?: boolean;
}) {
  const t = useT();
  const [state, setState] = useState<State>({ kind: 'opening' });
  const [attempt, setAttempt] = useState(0);
  const sessionId = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    setState({ kind: 'opening' });
    client.openPhoneScan().then(
      (session) => {
        if (cancelled) {
          void client.closePhoneScan(session.id).catch(() => undefined);
          return;
        }
        sessionId.current = session.id;
        setState({ kind: 'open', session, pages: session.pages });
        timer = setInterval(() => {
          client.phoneScan(session.id).then(
            (latest) => {
              if (cancelled) return;
              setState((current) =>
                current.kind === 'open' ? { ...current, pages: latest.pages } : current,
              );
              // One photo was asked for: the first one to arrive is it.
              if (!multiple && latest.pages > 0) {
                clearInterval(timer);
                void collect(session.id, 1);
              }
            },
            (error: unknown) => {
              if (!cancelled && error instanceof ApiError && error.status === 404) {
                clearInterval(timer);
                sessionId.current = null;
                setState({ kind: 'expired' });
              }
            },
          );
        }, POLL_MS);
      },
      (error: unknown) => {
        if (cancelled) return;
        setState({
          kind: 'failed',
          reason:
            error instanceof ApiError && error.code === 'no-network' ? 'no-network' : 'failed',
        });
      },
    );
    return () => {
      cancelled = true;
      clearInterval(timer);
      // Closing drops the pages with it: nothing lingers in memory for a scan nobody finished.
      if (sessionId.current) void client.closePhoneScan(sessionId.current).catch(() => undefined);
      sessionId.current = null;
    };
    // `collect` and `multiple` are stable for the life of one code; a new attempt is a new code.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  async function collect(id: string, count: number) {
    setState({ kind: 'collecting' });
    try {
      const files: File[] = [];
      for (let n = 1; n <= count; n += 1) {
        const blob = await client.phoneScanPage(id, n);
        const extension = blob.type === 'image/png' ? 'png' : 'jpg';
        files.push(new File([blob], `phone-${n}.${extension}`, { type: blob.type }));
      }
      onDone(files);
    } catch {
      setState({ kind: 'failed', reason: 'failed' });
    }
  }

  return (
    <div className="scan stack" data-testid="phone-scan">
      <h3>{t('phone.heading')}</h3>
      {state.kind === 'opening' || state.kind === 'collecting' ? (
        <p className="muted" role="status">
          {t('phone.opening')}
        </p>
      ) : state.kind === 'failed' ? (
        <p className="status-warning" role="alert">
          {state.reason === 'no-network' ? t('phone.noNetwork') : t('phone.failed')}
        </p>
      ) : state.kind === 'expired' ? (
        <p className="status-warning" role="status">
          {t('phone.expired')}
        </p>
      ) : (
        <>
          <p className="small">{t('phone.hint')}</p>
          <img
            className="phone-scan__qr"
            src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(state.session.qrSvg)}`}
            alt={t('phone.qrAlt')}
            width={240}
            height={240}
          />
          <p className="small muted phone-scan__link">{state.session.phoneUrl}</p>
          <p role="status" data-testid="phone-scan-count">
            {t('phone.received', { count: state.pages })}
          </p>
        </>
      )}
      <div className="row">
        {state.kind === 'open' && multiple && (
          <button
            type="button"
            className="button"
            disabled={state.pages === 0}
            onClick={() => void collect(state.session.id, state.pages)}
          >
            {t('phone.useReceived', { count: state.pages })}
          </button>
        )}
        {(state.kind === 'expired' || state.kind === 'failed') && (
          <button type="button" className="button" onClick={() => setAttempt((n) => n + 1)}>
            {t('phone.newCode')}
          </button>
        )}
        <button type="button" className="button button--quiet" onClick={onBack}>
          <Icon name="image" />
          {t('phone.back')}
        </button>
      </div>
    </div>
  );
}
