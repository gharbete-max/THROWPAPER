import { useEffect, useRef, useState } from 'react';
import type { Translator } from '@tp/i18n';
import type { IdentityCheckResponse } from '@tp/shared/forms';
import { Icon } from './Icon.js';

type State =
  | { kind: 'idle' }
  | { kind: 'waiting' }
  | { kind: 'confirmed'; name: string | null; test: boolean }
  | { kind: 'already' }
  | { kind: 'failed' };

/** How often, and for how long, the page asks whether the e-ID app has answered. */
const POLL_MS = 2000;
const GIVE_UP_MS = 3 * 60 * 1000;

/**
 * The optional e-ID step on the confirmation screen (CONTRACT §5.6).
 *
 * The form is already sent when this appears, and says so: the step can be taken or ignored, and
 * nothing about the submission depends on it. It never claims more than happened —
 *
 * - **no provider** (the case everywhere until one is chosen): one sentence that the step is not
 *   available and nothing more is needed. No button that leads nowhere;
 * - **the development provider**: the button works, and both the offer and the result say it is a
 *   test and not an identity check;
 * - **a real provider**: its app opens (`launchUrl`) and the page waits for its answer.
 *
 * On a confirmation the finished document changes (it now says so), so the parent is told to fetch
 * it again.
 */
export function IdentityStep({
  slug,
  token,
  offer,
  t,
  onConfirmed,
}: {
  slug: string;
  token: string;
  offer: { available: boolean; test: boolean };
  t: Translator;
  onConfirmed: () => void;
}) {
  const [state, setState] = useState<State>({ kind: 'idle' });
  const polling = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (polling.current) window.clearTimeout(polling.current);
    },
    [],
  );

  async function check(reference: string, until: number): Promise<void> {
    try {
      const response = await fetch(`/api/public/forms/${slug}/identity/check`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, reference }),
      });
      if (!response.ok) return setState({ kind: 'failed' });
      const body = (await response.json()) as IdentityCheckResponse;
      if (body.status === 'complete' && body.confirmed) {
        setState({ kind: 'confirmed', name: body.confirmed.name, test: body.confirmed.test });
        onConfirmed();
        return;
      }
      if (body.status !== 'pending' || Date.now() > until) return setState({ kind: 'failed' });
      polling.current = window.setTimeout(() => void check(reference, until), POLL_MS);
    } catch {
      setState({ kind: 'failed' });
    }
  }

  async function start() {
    setState({ kind: 'waiting' });
    try {
      const response = await fetch(`/api/public/forms/${slug}/identity`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      if (response.status === 409) return setState({ kind: 'already' });
      if (!response.ok) return setState({ kind: 'failed' });
      const started = (await response.json()) as { reference: string; launchUrl?: string };
      // A real provider's app, on this device. The development provider has none and answers at once.
      if (started.launchUrl) window.open(started.launchUrl, '_blank', 'noopener');
      await check(started.reference, Date.now() + GIVE_UP_MS);
    } catch {
      setState({ kind: 'failed' });
    }
  }

  return (
    <section className="identity-step stack stack--tight" aria-labelledby="identity-heading">
      <h3 id="identity-heading">
        <Icon name="user" />
        {t('public.eid.title')}
      </h3>

      {!offer.available && <p className="small">{t('public.eid.unavailable')}</p>}

      {offer.available && state.kind !== 'confirmed' && state.kind !== 'already' && (
        <>
          <p className="small">{t('public.eid.offer')}</p>
          {offer.test && <p className="small status-warning">{t('public.eid.testNote')}</p>}
          <div className="row">
            <button
              type="button"
              className="button button--quiet"
              disabled={state.kind === 'waiting'}
              onClick={() => void start()}
            >
              {state.kind === 'waiting'
                ? t('public.eid.waiting')
                : state.kind === 'failed'
                  ? t('public.eid.retry')
                  : t('public.eid.start')}
            </button>
          </div>
        </>
      )}

      <div role="status" aria-live="polite">
        {state.kind === 'confirmed' && (
          <p className={state.test ? 'small status-warning' : 'small status-up'}>
            {state.test
              ? t('public.eid.confirmedTest')
              : t('public.eid.confirmed', { name: state.name ?? '' })}
          </p>
        )}
        {state.kind === 'already' && <p className="small">{t('public.eid.already')}</p>}
        {state.kind === 'failed' && <p className="small status-down">{t('public.eid.failed')}</p>}
      </div>
    </section>
  );
}
