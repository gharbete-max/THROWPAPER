import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useParams } from 'react-router';
import { client } from '../lib/api.js';
import { formatDateTime, useT } from '../lib/i18n.js';
import { useSession } from '../lib/session.js';

type Outcome = 'admitted' | 'already' | 'revoked' | 'wrong-event' | 'not-found' | 'bad-signature';

interface Attendee {
  submissionId: string;
  reference: string;
  name: string;
  email: string | null;
  revoked: boolean;
  checkedInAt: string | null;
}

interface CheckInResult {
  outcome: Outcome;
  attendee: Attendee | null;
  checkedInAt: string | null;
}

/**
 * The door.
 *
 * Deliberately loud and low-density: one enormous answer, readable at arm's length in bad light by
 * somebody who is also talking to a queue. The reference field is always present and refocuses
 * after every scan, because the camera is the fast path and typing is the one that always works.
 */
export default function CheckIn() {
  const t = useT();
  const { id: eventId } = useParams();
  const { user } = useSession();

  const [code, setCode] = useState('');
  const [result, setResult] = useState<CheckInResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [counts, setCounts] = useState<{ checkedIn: number; registered: number } | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const controlsRef = useRef<{ stop: () => void } | null>(null);
  // Guards against the decoder firing the same card ten times a second while it sits in frame.
  const lastScan = useRef<{ code: string; at: number }>({ code: '', at: 0 });

  const submit = useCallback(
    async (value: string) => {
      if (!eventId || !value.trim() || busy) return;
      setBusy(true);
      try {
        const response = await client.checkIn(eventId, value.trim());
        setResult(response);
        setCode('');
        client
          .attendance(eventId)
          .then((a) => setCounts({ checkedIn: a.checkedIn, registered: a.registered }))
          .catch(() => undefined);
      } catch {
        setResult({ outcome: 'not-found', attendee: null, checkedInAt: null });
      } finally {
        setBusy(false);
        inputRef.current?.focus();
      }
    },
    [eventId, busy],
  );

  useEffect(() => {
    if (!eventId) return;
    client
      .attendance(eventId)
      .then((a) => setCounts({ checkedIn: a.checkedIn, registered: a.registered }))
      .catch(() => undefined);
  }, [eventId]);

  async function startScanning() {
    setCameraError(null);
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
      // Camera denied, absent, or not on a secure origin. Typing still works, so say so and move on.
      setCameraError(error instanceof Error ? error.message : String(error));
      setScanning(false);
      inputRef.current?.focus();
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

  return (
    <section className="stack checkin">
      <header className="row row--between">
        <h1>{t('checkin.title')}</h1>
        {counts && (
          <span className="badge">
            {t('checkin.counts', { checkedIn: counts.checkedIn, registered: counts.registered })}
          </span>
        )}
      </header>

      {result && <Verdict result={result} />}

      <div className="card stack">
        <video ref={videoRef} className={scanning ? 'checkin__video' : 'checkin__video--off'} />

        <div className="row">
          {scanning ? (
            <button className="button button--quiet" onClick={stopScanning}>
              {t('checkin.stopCamera')}
            </button>
          ) : (
            <button className="button" onClick={startScanning}>
              {t('checkin.startCamera')}
            </button>
          )}
        </div>

        {cameraError && (
          <p className="small muted">
            {t('checkin.cameraUnavailable')} {cameraError}
          </p>
        )}

        <form className="stack" onSubmit={onSubmit}>
          <label className="field">
            <span>{t('checkin.reference')}</span>
            <input
              ref={inputRef}
              autoFocus
              autoComplete="off"
              className="checkin__input"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="AB12-CD34"
            />
          </label>
          <button className="button" type="submit" disabled={busy}>
            {busy ? t('checkin.checking') : t('checkin.check')}
          </button>
        </form>
      </div>
    </section>
  );
}

function Verdict({ result }: { result: CheckInResult }) {
  const t = useT();
  const { locale } = useSession();
  const tone =
    result.outcome === 'admitted' ? 'good' : result.outcome === 'already' ? 'warn' : 'bad';

  return (
    <div className={`verdict verdict--${tone}`}>
      <strong className="verdict__headline">{t(`checkin.outcome.${result.outcome}`)}</strong>

      {result.attendee && (
        <>
          <span className="verdict__name">{result.attendee.name || result.attendee.reference}</span>
          <span className="verdict__meta">{result.attendee.reference}</span>
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
