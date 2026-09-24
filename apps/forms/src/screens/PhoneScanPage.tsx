import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import type { forms as formSchemas } from '@tp/shared';
import { ApiError, client } from '../lib/api.js';
import { useT } from '../lib/i18n.js';
import { CameraScan } from '../components/CameraScan.js';
import { Loading } from '../components/Loading.js';

/** The long side a page is sent at: plenty to read and straighten, a fraction of a raw photo. */
const MAX_SIDE = 2400;

type State =
  | { kind: 'loading' }
  | { kind: 'gone' }
  | { kind: 'ready'; status: formSchemas.PhoneScanStatus }
  | { kind: 'sending'; number: number; count: number }
  | { kind: 'sent'; status: formSchemas.PhoneScanStatus }
  | { kind: 'failed'; status: formSchemas.PhoneScanStatus; reason: 'failed' | 'full' };

/**
 * The phone's half of scanning for a computer: opened from the QR code, signed in to nothing.
 * It photographs pages — live where the browser allows a camera, otherwise with the phone's own
 * camera app — and sends each one to the computer that showed the code. Straightening happens on
 * the computer, where the person sees it large.
 */
export default function PhoneScanPage() {
  const t = useT();
  const { token = '' } = useParams();
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    client.phoneScanStatus(token).then(
      (status) => !cancelled && setState({ kind: 'ready', status }),
      () => !cancelled && setState({ kind: 'gone' }),
    );
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function send(pages: File[]) {
    let status: formSchemas.PhoneScanStatus | null = null;
    for (const [index, page] of pages.entries()) {
      setState({ kind: 'sending', number: index + 1, count: pages.length });
      try {
        status = await client.sendPhoneScanPage(token, await shrink(page));
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) {
          setState({ kind: 'gone' });
          return;
        }
        const latest = status ?? (await client.phoneScanStatus(token).catch(() => null));
        if (!latest) {
          setState({ kind: 'gone' });
          return;
        }
        setState({
          kind: 'failed',
          status: latest,
          reason: error instanceof ApiError && error.status === 409 ? 'full' : 'failed',
        });
        return;
      }
    }
    if (status) setState({ kind: 'sent', status });
  }

  return (
    <main className="shell shell--narrow stack">
      <h1>{t('phone.page.heading')}</h1>
      {state.kind === 'loading' ? (
        <Loading />
      ) : state.kind === 'gone' ? (
        <p className="status-warning" role="alert">
          {t('phone.page.gone')}
        </p>
      ) : state.kind === 'sending' ? (
        <p role="status">{t('phone.page.sending', { number: state.number, count: state.count })}</p>
      ) : state.kind === 'ready' ? (
        <>
          <p>{t('phone.page.intro')}</p>
          <CameraScan
            phone={false}
            onDone={(pages) => void send(pages)}
            onCancel={() =>
              setState((s) =>
                s.kind === 'ready' && s.status.pages > 0 ? { kind: 'sent', status: s.status } : s,
              )
            }
          />
        </>
      ) : (
        <>
          {state.kind === 'failed' ? (
            <p className="status-warning" role="alert">
              {state.reason === 'full' ? t('phone.page.full') : t('phone.page.failed')}
            </p>
          ) : (
            <p role="status" data-testid="phone-sent">
              {t('phone.page.sent', { count: state.status.pages })}
            </p>
          )}
          {state.status.pages < state.status.maxPages && (
            <button
              type="button"
              className="button"
              onClick={() => setState({ kind: 'ready', status: state.status })}
            >
              {t('phone.page.more')}
            </button>
          )}
        </>
      )}
    </main>
  );
}

/** A photo as a JPEG no longer than `MAX_SIDE`, base64 for the JSON body. */
async function shrink(file: File): Promise<formSchemas.PhoneScanPage> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', 0.88),
  );
  if (!blob) throw new Error('Could not encode the page');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return { contentType: 'image/jpeg', base64: btoa(binary) };
}
