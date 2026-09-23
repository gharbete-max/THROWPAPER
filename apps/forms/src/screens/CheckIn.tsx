import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import type { api } from '@tp/shared';
import { pickText } from '@tp/i18n';
import { ApiError, client } from '../lib/api.js';
import { formatDateTime, formatTime, useT } from '../lib/i18n.js';
import { useSession } from '../lib/session.js';
import { useConfirm } from '../components/Confirm.js';
import { EmptyState } from '../components/EmptyState.js';
import { Icon } from '../components/Icon.js';

type Outcome =
  | 'admitted'
  | 'already'
  | 'revoked'
  | 'wrong-event'
  | 'not-found'
  /** A guest card whose registration no longer names that guest — see ADR 0003. */
  | 'no-such-guest'
  | 'bad-signature'
  | 'undone'
  /** The undo request itself failed; the arrival stands. Client-side only. */
  | 'undo-failed'
  /**
   * The request did not come back. Client-side only — the API answers 200 with a verdict for
   * every outcome it has, so anything thrown is a fault and not an answer about this card.
   */
  | 'failed';

interface Attendee {
  submissionId: string;
  /** The card's own reference: `ABCD-EFGH`, or `ABCD-EFGH:2` for a guest. */
  reference: string;
  name: string;
  email: string | null;
  revoked: boolean;
  checkedInAt: string | null;
  /** 0 for the registrant, 1-based for a guest. Needed to undo the right card. */
  entryIndex?: number;
  /** Who brought them, for a guest. Null for somebody who brought themselves. */
  broughtBy?: string | null;
}

interface CheckInResult {
  outcome: Outcome;
  attendee: Attendee | null;
  checkedInAt: string | null;
  /**
   * What was scanned or typed, kept for the verdict when there is nobody to name: the field is
   * cleared for the next card, so without this a typo and the wrong queue look the same.
   */
  code?: string;
}

/** An arrival this operator made, kept so it can be taken back. */
interface Arrival {
  attendee: Attendee;
  at: string;
}

const RECENT = 5;

/**
 * The door.
 *
 * This is the screen the product's positioning rests on — rain, a queue, one hand, bad wifi — and
 * it is a *mode* rather than a page: the shell drops its sidebar and session row here (see
 * `App.tsx`), because a person working a door is not navigating a product. The one way out is the
 * link at the top.
 *
 * What is large is what is read at arm's length: the count, the verdict, the reference. The
 * verdict has a fixed height and is always present — an idle prompt before the first scan — so the
 * layout does not jump at the exact moment the operator needs certainty. The reference field is
 * always there, because the camera is the fast path and typing is the one that always works.
 *
 * Focus follows one rule: while the camera runs, the camera is the input and focus stays where it
 * is; otherwise typing is the input and the field takes focus back after a check-in or an undo.
 * Refocusing after a *scan* raised the phone's keyboard over the viewfinder, which sits below the
 * form — the next guest was being scanned into a screen that had just hidden the camera.
 *
 * The last five arrivals stay on screen with an undo each. The door's mistake is a mis-scan — the
 * wrong card, or the card of the person behind — and the remedy is a button beside the arrival that
 * was just made, not a support ticket.
 */
export default function CheckIn() {
  const t = useT();
  const { id: eventId } = useParams();
  const { user, locale, locales } = useSession();
  const confirm = useConfirm();

  /**
   * The event this door belongs to, `'missing'` when the id names none.
   *
   * A wrong id used to render a fully working door whose every scan said "Not found" — the
   * attendance 404 was swallowed with the counts — which sends a queue away from a door that was
   * never open. Now the door is only a door once its event exists.
   */
  const [event, setEvent] = useState<api.EventResponse | 'missing' | null>(null);
  const [code, setCode] = useState('');
  const [result, setResult] = useState<CheckInResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [cameraError, setCameraError] = useState(false);
  const [counts, setCounts] = useState<{ checkedIn: number; registered: number } | null>(null);
  const [recent, setRecent] = useState<Arrival[]>([]);
  const online = useOnline();

  const videoRef = useRef<HTMLVideoElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const controlsRef = useRef<{ stop: () => void } | null>(null);
  // Guards against the decoder firing the same card ten times a second while it sits in frame.
  const lastScan = useRef<{ code: string; at: number }>({ code: '', at: 0 });

  /** The camera is the input while it runs; the field is when it does not. See the top of the file. */
  const refocus = useCallback(() => {
    if (!controlsRef.current) inputRef.current?.focus();
  }, []);

  const refreshCounts = useCallback(() => {
    if (!eventId) return;
    client
      .attendance(eventId)
      .then((a) => setCounts({ checkedIn: a.checkedIn, registered: a.registered }))
      .catch(() => undefined);
  }, [eventId]);

  const submit = useCallback(
    async (value: string) => {
      if (!eventId || !value.trim() || busy) return;
      setBusy(true);
      try {
        const response = await client.checkIn(eventId, value.trim());
        setResult({ ...response, code: value.trim() });
        setCode('');
        if (response.outcome === 'admitted' && response.attendee && response.checkedInAt) {
          const arrival = { attendee: response.attendee, at: response.checkedInAt };
          setRecent((current) => [arrival, ...current].slice(0, RECENT));
        }
        refreshCounts();
      } catch {
        /*
         * A fault is not a verdict.
         *
         * `POST /v1/events/:id/check-ins` answers 200 with a verdict for every outcome it has,
         * not-found included — so nothing that lands here is an answer about this card. It is a
         * 500, a 403, a timeout, a parse error. Rendering any of them as "not found" told the
         * person on the door to turn away somebody who is on the list.
         *
         * A dropped connection is still its own case: the offline banner says what happened and
         * the verdict stays as it was, because the scan was never sent.
         *
         * The typed value is kept either way — `setCode('')` runs only on success — so whoever is
         * at the door can press the button again rather than ask for the card back.
         */
        if (navigator.onLine) {
          setResult({
            outcome: 'failed',
            attendee: null,
            checkedInAt: null,
            code: value.trim(),
          });
        }
      } finally {
        setBusy(false);
        refocus();
      }
    },
    [eventId, busy, refreshCounts, refocus],
  );

  async function undo(arrival: Arrival) {
    if (!eventId) return;
    const who = arrival.attendee.name || arrival.attendee.reference;
    // Rule 7: nothing is taken back without a confirmation step. One press more, not a ticket.
    const ok = await confirm(t('checkin.undoConfirm', { name: who }), {
      confirmLabel: t('checkin.undo'),
    });
    if (!ok) return;
    try {
      await client.undoCheckIn(
        eventId,
        arrival.attendee.submissionId,
        arrival.attendee.entryIndex ?? 0,
      );
      setRecent((current) => current.filter((entry) => entry !== arrival));
      setResult({ outcome: 'undone', attendee: arrival.attendee, checkedInAt: null });
      refreshCounts();
    } catch {
      // Left on the list: the arrival still stands, and the operator can try again — and is
      // told so. A confirm that changed nothing and said nothing was the door's one silence.
      setResult({ outcome: 'undo-failed', attendee: arrival.attendee, checkedInAt: null });
    } finally {
      refocus();
    }
  }

  useEffect(refreshCounts, [refreshCounts]);

  useEffect(() => {
    if (!eventId) return;
    client
      .getEvent(eventId)
      .then(setEvent)
      .catch((cause: unknown) => {
        // Only "there is no such event" closes the door. A dropped connection leaves it working
        // without a name; the offline banner already says what happened.
        if (cause instanceof ApiError && cause.status === 404) setEvent('missing');
      });
  }, [eventId]);

  async function startScanning() {
    setCameraError(false);
    try {
      // Loaded on demand: only the door needs a QR decoder, and it is not small.
      const { BrowserQRCodeReader } = await import('@zxing/browser');
      const reader = new BrowserQRCodeReader();
      const video = videoRef.current;
      if (!video) return;

      const controls = await reader.decodeFromVideoDevice(undefined, video, (decoded) => {
        if (!decoded) return;
        const text = decoded.getText();
        const now = Date.now();
        // Same card still in frame — ignore until it has been away for a moment.
        if (text === lastScan.current.code && now - lastScan.current.at < 3000) return;
        lastScan.current = { code: text, at: now };
        void submit(text);
      });

      controlsRef.current = controls;
      setScanning(true);
    } catch (error) {
      // Camera denied, absent, or not on a secure origin. Typing still works, so say so and move
      // on. The browser's own sentence is for whoever debugs, not for the screen: it is English
      // on a Swedish door.
      console.warn('camera unavailable', error);
      setCameraError(true);
      setScanning(false);
      refocus();
    }
  }

  function stopScanning() {
    controlsRef.current?.stop();
    controlsRef.current = null;
    setScanning(false);
  }

  useEffect(() => () => controlsRef.current?.stop(), []);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void submit(code);
  }

  if (!user) return null;

  if (event === 'missing') {
    return (
      <EmptyState
        icon="events"
        title={t('event.notFound')}
        action={
          <Link className="button button--quiet" to="/events">
            {t('events.title')}
          </Link>
        }
      />
    );
  }

  const eventName = event ? pickText(locales, event.name, locale).value : '';

  return (
    <section className="door">
      <header className="door__top">
        <Link className="button button--quiet small" to={`/events/${eventId}/attendance`}>
          <Icon name="arrow-left" className="icon--lead" />
          {t('checkin.leave')}
        </Link>
        {/* The event in the heading: the first thing read is which queue this is. */}
        <h1 className="door__title">
          {t('checkin.title')}
          {/* The space is for the reader: the span is a block to the eye and a run-on to a voice. */}
          {eventName && (
            <>
              {' '}
              <span className="door__event small muted">{eventName}</span>
            </>
          )}
        </h1>
        {/*
          The count is the largest number on the screen: it is the one the organiser asks for
          across the room, and it was the smallest type on the old page.
        */}
        <p className="door__count">
          {/*
            Read as one sentence. The two visual fragments — a big number, "of 232" — are hidden
            from the reader, and the sentence is hidden from the eye: an `aria-label` on a
            paragraph is not something every browser passes on.
          */}
          {counts && (
            <span className="visually-hidden">
              {t('checkin.counts', { checkedIn: counts.checkedIn, registered: counts.registered })}
            </span>
          )}
          <strong className="door__countIn" aria-hidden="true">
            {counts?.checkedIn ?? '–'}
          </strong>
          <span className="door__countOf small muted" aria-hidden="true">
            {t('checkin.ofRegistered', { registered: counts?.registered ?? '–' })}
          </span>
        </p>
      </header>

      {/*
        Offline is a state the door has, not an error the door reports. The copy on the site names
        bad wifi, and a scan that fails for want of a connection must not read as "not found".
      */}
      {!online && (
        <p className="door__offline" role="status">
          <Icon name="warning" className="icon--lead" />
          {t('checkin.offline')}
        </p>
      )}

      {/* Always present, always the same height: the layout must not jump at the verdict. */}
      <Verdict result={result} />

      <form className="door__form" onSubmit={onSubmit}>
        <label className="field">
          <span>{t('checkin.reference')}</span>
          <input
            ref={inputRef}
            autoFocus
            autoComplete="off"
            className="checkin__input"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder={t('checkin.referencePlaceholder')}
            // A reference is upper-case letters and digits; the phone's keyboard should start there,
            // and its action key should say "go" because pressing it checks the person in.
            autoCapitalize="characters"
            enterKeyHint="go"
          />
        </label>
        <div className="door__actions">
          {/* One filled button. The camera is a way of filling the field, not a second verb. */}
          <button className="button door__check" type="submit" disabled={busy}>
            <Icon name="check" className="icon--lead" />
            {busy ? t('checkin.checking') : t('checkin.check')}
          </button>
          {scanning ? (
            <button className="button button--quiet" type="button" onClick={stopScanning}>
              {t('checkin.stopCamera')}
            </button>
          ) : (
            <button className="button button--quiet" type="button" onClick={startScanning}>
              {t('checkin.startCamera')}
            </button>
          )}
        </div>
        {cameraError && <p className="small muted">{t('checkin.cameraUnavailable')}</p>}
      </form>

      <video ref={videoRef} className={scanning ? 'checkin__video' : 'checkin__video--off'} />

      {recent.length > 0 && (
        <section className="door__recent" aria-label={t('checkin.recent')}>
          <h2 className="small muted">{t('checkin.recent')}</h2>
          <ul className="door__list">
            {recent.map((arrival) => {
              const who = arrival.attendee.name || arrival.attendee.reference;
              return (
                // Keyed by card: a member and their guest share a submission id.
                <li className="door__row" key={arrival.attendee.reference}>
                  <span className="door__who">{who}</span>
                  <span className="door__when small muted">{formatTime(locale, arrival.at)}</span>
                  <button
                    className="button button--quiet small"
                    type="button"
                    onClick={() => void undo(arrival)}
                  >
                    <Icon name="undo" className="icon--lead" />
                    {t('checkin.undo')}
                    {/* Five "Undo" buttons are five buttons only if each says whose. */}
                    <span className="visually-hidden"> {who}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </section>
  );
}

function Verdict({ result }: { result: CheckInResult | null }) {
  const t = useT();
  const { locale } = useSession();

  if (!result) {
    return (
      <div className="verdict verdict--idle" role="status">
        <span className="verdict__headline">{t('checkin.idle')}</span>
      </div>
    );
  }

  const tone =
    result.outcome === 'admitted'
      ? 'good'
      : result.outcome === 'already' || result.outcome === 'undone'
        ? 'warn'
        : 'bad';

  return (
    <div className={`verdict verdict--${tone}`} role="status">
      <strong className="verdict__headline">
        {result.outcome === 'undo-failed'
          ? t('users.errorFailed')
          : t(`checkin.outcome.${result.outcome}`)}
      </strong>

      {/* Nobody to name: say what was refused, so a typo can be seen as one. */}
      {!result.attendee && result.code && <span className="verdict__name">{result.code}</span>}

      {result.attendee && (
        <>
          <span className="verdict__name">{result.attendee.name || result.attendee.reference}</span>
          <span className="verdict__meta">{result.attendee.reference}</span>
          {/*
            Whose guest this is, when it is a guest's card.

            The door's next question after "who is this" is "and are they with somebody" — a guest
            with no name answer shows only a reference otherwise, and the person on the door has no
            way to put them back together with the member in front of them.
          */}
          {result.attendee.broughtBy && (
            <span className="verdict__meta">
              {t('checkin.guestOf', { name: result.attendee.broughtBy })}
            </span>
          )}
        </>
      )}

      {result.checkedInAt && result.outcome === 'already' && (
        <span className="verdict__meta">
          {t('checkin.arrivedAt', { time: formatDateTime(locale, result.checkedInAt) })}
        </span>
      )}
    </div>
  );
}

/** Whether the browser believes it has a network. Coarse, and the door only needs coarse. */
function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);
  return online;
}
