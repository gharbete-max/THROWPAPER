import { useEffect, useRef, useState } from 'react';
import { useT } from '../lib/i18n.js';
import { Icon } from './Icon.js';
import { PhoneScan } from './PhoneScan.js';

/**
 * A document scanner in the page: the camera, live, and a shutter — on a phone its back camera, on
 * a PC its webcam, in the desktop app the same (the shell grants the camera to our own window).
 * Several pages in a row; each is a JPEG `File`, handed on as if it had been picked from disk, so
 * everything downstream — the four-corner straightening, OCR, the PDF — is the path that already
 * exists for a photograph.
 *
 * Nothing leaves the device here. Frames are drawn to a canvas and encoded by the browser.
 *
 * **When there is no live camera** — no device, permission refused, or a page that is not a secure
 * context (a phone reaching a plain-HTTP address) — it says which, and offers the phone's own
 * camera through a file input with `capture`, which needs neither permission nor HTTPS.
 */
export const MAX_SCAN_PAGES = 20;

type Status =
  | { kind: 'starting' }
  | { kind: 'live' }
  | { kind: 'unavailable'; reason: 'insecure' | 'denied' | 'none' | 'failed' };

interface CameraScanProps {
  onDone: (pages: File[]) => void;
  onCancel: () => void;
  /** One page (a photo for a form) or several (a document). */
  multiple?: boolean;
  /**
   * Offer a phone instead, by QR code (`PhoneScan`). On by default — a PC's webcam is poor at
   * paper; off on the phone's own scan page, which would otherwise offer itself.
   */
  phone?: boolean;
}

export function CameraScan({ phone = true, ...props }: CameraScanProps) {
  const [withPhone, setWithPhone] = useState(false);
  if (withPhone) {
    return (
      <PhoneScan
        onDone={props.onDone}
        onBack={() => setWithPhone(false)}
        {...(props.multiple === undefined ? {} : { multiple: props.multiple })}
      />
    );
  }
  // Unmounting the live view is what stops the camera while the phone is used.
  return <LiveScan {...props} {...(phone ? { onPhone: () => setWithPhone(true) } : {})} />;
}

function LiveScan({
  onDone,
  onCancel,
  multiple = true,
  onPhone,
}: Omit<CameraScanProps, 'phone'> & { onPhone?: () => void }) {
  const t = useT();
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<Status>({ kind: 'starting' });
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [cameraId, setCameraId] = useState<string | null>(null);
  const [pages, setPages] = useState<{ file: File; url: string }[]>([]);
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function start() {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        setStatus({ kind: 'unavailable', reason: 'insecure' });
        return;
      }
      setStatus({ kind: 'starting' });
      try {
        const media = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: cameraId
            ? { deviceId: { exact: cameraId } }
            : // The back camera on a phone; a laptop has only the one and ignores the hint.
              {
                facingMode: { ideal: 'environment' },
                width: { ideal: 2560 },
                height: { ideal: 1920 },
              },
        });
        if (cancelled) {
          media.getTracks().forEach((track) => track.stop());
          return;
        }
        stream.current = media;
        if (video.current) {
          video.current.srcObject = media;
          await video.current.play().catch(() => {});
        }
        setStatus({ kind: 'live' });
        // Labels are only readable once permission is granted, so ask after starting.
        const devices = await navigator.mediaDevices.enumerateDevices();
        if (!cancelled) setCameras(devices.filter((device) => device.kind === 'videoinput'));
      } catch (error) {
        const name = (error as DOMException).name;
        setStatus({
          kind: 'unavailable',
          reason:
            name === 'NotAllowedError' || name === 'SecurityError'
              ? 'denied'
              : name === 'NotFoundError' || name === 'OverconstrainedError'
                ? 'none'
                : 'failed',
        });
      }
    }
    void start();
    return () => {
      cancelled = true;
      stream.current?.getTracks().forEach((track) => track.stop());
      stream.current = null;
    };
  }, [cameraId]);

  // Object URLs for the thumbnails live as long as the thumbnails do: revoked when one is
  // removed, and the rest once, when the scanner closes. (An effect on `pages` would revoke the
  // ones still on screen every time a page was added.)
  const urls = useRef<string[]>([]);
  useEffect(() => () => urls.current.forEach((url) => URL.revokeObjectURL(url)), []);

  async function capture() {
    const element = video.current;
    if (!element || element.videoWidth === 0) return;
    const canvas = document.createElement('canvas');
    canvas.width = element.videoWidth;
    canvas.height = element.videoHeight;
    canvas.getContext('2d')!.drawImage(element, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.92),
    );
    if (!blob) return;
    const file = new File([blob], `scan-${pages.length + 1}.jpg`, { type: 'image/jpeg' });
    setFlash(true);
    setTimeout(() => setFlash(false), 150);
    if (!multiple) {
      onDone([file]);
      return;
    }
    if (pages.length >= MAX_SCAN_PAGES) return;
    const url = URL.createObjectURL(file);
    urls.current.push(url);
    setPages((current) => [...current, { file, url }]);
  }

  function fromSystemCamera(files: FileList | null) {
    if (files && files.length > 0) onDone(Array.from(files).slice(0, MAX_SCAN_PAGES));
  }

  return (
    <div className="scan stack" data-testid="camera-scan">
      {status.kind === 'unavailable' ? (
        <div className="stack" role="status">
          <p className="status-warning">{t(`camera.unavailable.${status.reason}`)}</p>
          {/*
            The phone's own camera app, through the file input. `capture` asks for the camera
            directly; it needs no permission prompt and no secure context.
          */}
          <label className="button">
            <Icon name="image" />
            {t('camera.systemCamera')}
            <input
              className="visually-hidden"
              type="file"
              accept="image/*"
              capture="environment"
              multiple={multiple}
              onChange={(event) => fromSystemCamera(event.target.files)}
            />
          </label>
        </div>
      ) : (
        <div className={flash ? 'scan__view scan__view--flash' : 'scan__view'}>
          <video
            ref={video}
            className="scan__video"
            playsInline
            muted
            aria-label={t('camera.preview')}
          />
          {status.kind === 'starting' && (
            <p className="scan__hint muted" role="status">
              {t('camera.starting')}
            </p>
          )}
        </div>
      )}

      {status.kind === 'live' && (
        <div className="row row--between">
          <button type="button" className="button" onClick={() => void capture()}>
            <Icon name="image" />
            {multiple ? t('camera.capturePage') : t('camera.capture')}
          </button>
          {cameras.length > 1 && (
            <label className="row small">
              <span>{t('camera.choose')}</span>
              <select
                value={cameraId ?? ''}
                onChange={(event) => setCameraId(event.target.value || null)}
              >
                <option value="">{t('camera.default')}</option>
                {cameras.map((camera, index) => (
                  <option key={camera.deviceId || index} value={camera.deviceId}>
                    {camera.label || t('camera.numbered', { number: index + 1 })}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}

      {multiple && pages.length > 0 && (
        <ol className="scan__pages" aria-label={t('camera.pages', { count: pages.length })}>
          {pages.map((page, index) => (
            <li key={page.url} className="scan__page">
              <img src={page.url} alt={t('camera.page', { number: index + 1 })} />
              <button
                type="button"
                className="button button--quiet small"
                onClick={() => {
                  URL.revokeObjectURL(page.url);
                  urls.current = urls.current.filter((url) => url !== page.url);
                  setPages((current) => current.filter((_, i) => i !== index));
                }}
              >
                {t('camera.remove')}
              </button>
            </li>
          ))}
        </ol>
      )}

      <div className="row">
        {multiple && (
          <button
            type="button"
            className="button"
            disabled={pages.length === 0}
            onClick={() => onDone(pages.map((page) => page.file))}
          >
            {t('camera.done', { count: pages.length })}
          </button>
        )}
        {onPhone && (
          <button type="button" className="button button--quiet" onClick={onPhone}>
            {t('phone.use')}
          </button>
        )}
        <button type="button" className="button button--quiet" onClick={onCancel}>
          {t('camera.cancel')}
        </button>
      </div>
    </div>
  );
}
