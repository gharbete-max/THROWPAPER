import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Translator } from '@tp/i18n';
import { Icon } from './Icon.js';
import {
  canShareFile,
  copyableDraft,
  mailtoHref,
  saveBlob,
  shareFile,
  type EmailText,
} from '../lib/email-handoff.js';

export interface FinishedDocumentHandle {
  token: string;
  filename: string;
  draftProgram: string | null;
}

type Load = 'loading' | 'ready' | 'failed' | 'expired';
type Draft = 'idle' | 'opening' | 'opened' | 'failed';

/**
 * "Your document is ready" — the finished PDF, on the confirmation screen.
 *
 * The file is fetched as soon as the screen shows, not when a button is pressed. Two reasons: the
 * person sees at once whether it worked, and every button below then acts on a file already in
 * hand, inside the click — which is what a browser requires before it will open a tab, show the
 * share sheet or start a download without calling it a pop-up.
 *
 * The token goes in a POST body. See `routes/public-forms.ts` for why it is never in a URL.
 *
 * Nothing here claims more than happened. `mailto:` cannot attach a file, so its button is
 * accompanied by a sentence saying to attach the PDF by name; the share sheet and the desktop
 * draft *do* carry the file, and only they say so.
 */
export function FinishedDocument({
  slug,
  handle,
  title,
  reference,
  t,
}: {
  slug: string;
  handle: FinishedDocumentHandle;
  title: string;
  reference: string;
  t: Translator;
}) {
  const [load, setLoad] = useState<Load>('loading');
  const [file, setFile] = useState<File | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [emailOpen, setEmailOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>('idle');
  const [copied, setCopied] = useState(false);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoad('loading');
    fetch(`/api/public/forms/${slug}/document`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: handle.token }),
    })
      .then(async (response) => {
        if (cancelled) return;
        if (response.status === 404) return setLoad('expired');
        if (!response.ok) return setLoad('failed');
        const blob = await response.blob();
        if (cancelled) return;
        setFile(new File([blob], handle.filename, { type: 'application/pdf' }));
        setLoad('ready');
      })
      .catch(() => {
        if (!cancelled) setLoad('failed');
      });
    return () => {
      cancelled = true;
    };
  }, [slug, handle.token, handle.filename, attempt]);

  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setObjectUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const text: EmailText = useMemo(
    () => ({
      subject: t('public.email.subject', { title, reference }),
      body: t('public.email.body', { filename: handle.filename, reference }),
    }),
    [t, title, reference, handle.filename],
  );
  const shareable = file !== null && canShareFile(file);

  const openDraft = useCallback(async () => {
    if (!handle.draftProgram) return;
    setDraft('opening');
    try {
      const response = await fetch(`/api/public/forms/${slug}/document/email-draft`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: handle.token, subject: text.subject, text: text.body }),
      });
      setDraft(response.status === 204 ? 'opened' : 'failed');
    } catch {
      setDraft('failed');
    }
  }, [handle.draftProgram, handle.token, slug, text]);

  const program = handle.draftProgram ?? '';

  return (
    <section
      className="finished stack"
      aria-labelledby="finished-heading"
      aria-busy={load === 'loading'}
    >
      <div className="finished__file">
        <span className="finished__icon" aria-hidden="true">
          <Icon name="file" />
        </span>
        <div className="stack stack--tight finished__name">
          <h3 id="finished-heading">
            {load === 'loading' ? t('public.document.preparing') : t('public.document.ready')}
          </h3>
          <p className="small muted finished__filename">{handle.filename}</p>
        </div>
      </div>

      {load === 'failed' && (
        <div className="row">
          <p className="status-down" role="alert">
            {t('public.document.failed')}
          </p>
          <button
            type="button"
            className="button button--quiet"
            onClick={() => setAttempt((value) => value + 1)}
          >
            {t('public.document.retry')}
          </button>
        </div>
      )}
      {load === 'expired' && (
        <p className="muted" role="status">
          {t('public.document.expired', { reference })}
        </p>
      )}

      {load !== 'expired' && load !== 'failed' && (
        <div className="row finished__actions">
          <button
            type="button"
            className="button"
            disabled={!file}
            onClick={() => file && saveBlob(file, handle.filename)}
          >
            <Icon name="download" />
            {t('public.document.download')}
          </button>
          {objectUrl ? (
            <a className="button button--quiet" href={objectUrl} target="_blank" rel="noopener">
              <Icon name="external" />
              {t('public.document.open')}
            </a>
          ) : (
            <button type="button" className="button button--quiet" disabled>
              <Icon name="external" />
              {t('public.document.open')}
            </button>
          )}
          <button
            type="button"
            className="button button--quiet"
            aria-expanded={emailOpen}
            aria-controls="finished-email"
            disabled={!file}
            onClick={() => setEmailOpen((open) => !open)}
          >
            <Icon name="email" />
            {t('public.document.email')}
          </button>
        </div>
      )}

      {emailOpen && file && (
        <div className="finished__email stack" id="finished-email">
          <h4>{t('public.email.title')}</h4>

          {handle.draftProgram && (
            <div className="stack stack--tight">
              <div className="row">
                <button
                  type="button"
                  className="button"
                  disabled={draft === 'opening'}
                  onClick={() => void openDraft()}
                >
                  <Icon name="paperclip" />
                  {draft === 'opening'
                    ? t('public.email.drafting', { program })
                    : t('public.email.draft', { program })}
                </button>
              </div>
              {draft === 'opened' && (
                <p className="status-up" role="status">
                  {t('public.email.draftOpened', { program })}
                </p>
              )}
              {draft === 'failed' && (
                <p className="status-down" role="alert">
                  {t('public.email.draftFailed', { program })}
                </p>
              )}
            </div>
          )}

          <div className="row">
            {shareable && (
              <button
                type="button"
                className={handle.draftProgram ? 'button button--quiet' : 'button'}
                onClick={() => void shareFile(file, text)}
              >
                <Icon name="share" />
                {t('public.email.share')}
              </button>
            )}
            <a className="button button--quiet" href={mailtoHref(text)}>
              <Icon name="email" />
              {t('public.email.app')}
            </a>
            <button
              type="button"
              className="button button--quiet"
              onClick={() => {
                navigator.clipboard?.writeText(copyableDraft(text)).then(
                  () => setCopied(true),
                  () => undefined,
                );
              }}
            >
              <Icon name="copy" />
              {copied ? t('public.email.copied') : t('public.email.copy')}
            </button>
          </div>
          <p className="small muted">
            {t('public.email.attachNote', { filename: handle.filename })}
          </p>
        </div>
      )}
    </section>
  );
}
