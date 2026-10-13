import { lazy, Suspense, useEffect, useRef, useState, type DragEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { ApiError, client } from '../lib/api.js';
import { saveBlob } from '../lib/email-handoff.js';
import { sendWith } from '../lib/send-handoff.js';
import { signingWith } from '../lib/sign-handoff.js';
import { useT } from '../lib/i18n.js';
import { useToast } from '../lib/toast.js';
import { useConfirm } from '../components/Confirm.js';
import { CameraScan } from '../components/CameraScan.js';
import { EmptyState } from '../components/EmptyState.js';
import { Icon } from '../components/Icon.js';
import { openPdf, type PaperPdf } from './builder/paper/extract.js';
import { isPhoto, preparePhoto } from './scan-photo.js';
import { fromWord, WordToPdf } from './WordToPdf.js';
import { InvoiceScanEntry } from './invoice-scan/Entry.js';
import {
  movePage,
  pagesOfFile,
  removePage,
  requestOf,
  turnPage,
  type ScanPage,
} from './scan-plan.js';

const ScanEdit = lazy(() => import('./scan-edit/ScanEdit.js'));

/** The server's limits (`api-forms/src/pdf/arrange.ts`), so the screen can say so before sending. */
const MAX_FILES = 40;
const MAX_FILE_BYTES = 25 * 1024 * 1024;

/** A file's pages as the screen draws them: a PDF by pdf.js, a photograph as itself. */
type Source = { pdf: PaperPdf } | { url: string };

/**
 * Arrange pages: PDFs and photographs (from disk, the camera or a phone) put together, pages taken out, turned and put in order, then made into one
 * PDF to download. The server does the work (`POST /v1/pdf/arrange`) and keeps nothing; the pages
 * shown here are drawn in this browser from the files the person chose.
 */
export function Scan() {
  const t = useT();
  const toast = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const [files, setFiles] = useState<File[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [camera, setCamera] = useState(false);
  const [pages, setPages] = useState<ScanPage[]>([]);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<{ blob: Blob; page: number } | null>(null);
  const picker = useRef<HTMLInputElement>(null);

  // The drawings are released when the screen goes.
  const open = useRef<Source[]>([]);
  open.current = sources;
  useEffect(
    () => () => {
      for (const source of open.current) {
        if ('pdf' in source) void source.pdf.close();
        else URL.revokeObjectURL(source.url);
      }
    },
    [],
  );

  function say(key: ReturnType<typeof errorKey> | 'scan.error.notSupported') {
    toast.show(t(key), 'error');
  }

  async function add(chosen: File[]) {
    if (chosen.length === 0) return;
    const wanted = chosen.filter(
      (file) => file.type === 'application/pdf' || /\.pdf$/i.test(file.name) || isPhoto(file),
    );
    if (wanted.length < chosen.length) say('scan.error.notSupported');
    if (wanted.length === 0) return;
    if (files.length + wanted.length > MAX_FILES) return say('scan.error.tooMany');
    if (wanted.some((file) => file.size > MAX_FILE_BYTES)) return say('scan.error.tooLarge');

    const sent: File[] = [];
    const opened: Source[] = [];
    try {
      for (const file of wanted) {
        if (isPhoto(file)) {
          const photo = await preparePhoto(file);
          sent.push(photo);
          opened.push({ url: URL.createObjectURL(photo) });
        } else {
          sent.push(file);
          opened.push({ pdf: await openPdf(await file.arrayBuffer()) });
        }
      }
    } catch {
      for (const source of opened) {
        if ('pdf' in source) void source.pdf.close();
        else URL.revokeObjectURL(source.url);
      }
      return say('scan.error.unreadable');
    }
    const first = files.length;
    setFiles((current) => [...current, ...sent]);
    setSources((current) => [...current, ...opened]);
    setPages((current) => [
      ...current,
      ...opened.flatMap((source, index) =>
        pagesOfFile(first + index, 'pdf' in source ? source.pdf.pageCount : 1),
      ),
    ]);
  }

  /**
   * `then` is what happens to the made PDF: saved to disk, handed on to Signing or Send, or (a
   * function) given to the caller, as the editing step is.
   */
  async function make(
    acceptSignatureLoss = false,
    then: 'download' | 'sign' | 'send' | ((blob: Blob) => void) = 'download',
  ) {
    const request = requestOf(pages, files);
    setBusy(true);
    try {
      const blob = await client.arrangePdf(request.files, request.plan, acceptSignatureLoss);
      // A PDF made from a Word file keeps "layout may differ from Word" in its name.
      const name = files.find((file) => fromWord.has(file))?.name ?? 'loppa.pdf';
      const made = new File([blob], name, { type: 'application/pdf' });
      if (typeof then === 'function') then(blob);
      else if (then === 'sign') navigate(...signingWith(made));
      else if (then === 'send') navigate(...sendWith(made));
      else saveBlob(blob, name);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'signed') {
        // Asked before anything is changed: the new PDF cannot carry the old signature.
        const agreed = await confirm(t('scan.signed'), {
          confirmLabel: t('scan.signedConfirm'),
          danger: true,
        });
        if (agreed) {
          setBusy(false);
          return make(true, then);
        }
      } else {
        say(errorKey(error));
      }
    } finally {
      setBusy(false);
    }
  }

  /** The edited PDF is now the only file: its pages are the list. */
  async function replaceAll(file: File) {
    const pdf = await openPdf(await file.arrayBuffer());
    for (const old of sources) if ('pdf' in old) void old.pdf.close();
    setFiles([file]);
    setSources([{ pdf }]);
    setPages(pagesOfFile(0, pdf.pageCount));
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    void add([...event.dataTransfer.files]);
  }

  return (
    <section className="stack scan" onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
      <header className="stack stack--tight">
        <h1>{t('scan.heading')}</h1>
        <p className="muted small">{t('scan.intro')}</p>
      </header>

      <div className="scan__bar">
        <input
          ref={picker}
          type="file"
          accept="application/pdf,.pdf,image/jpeg,image/png,image/webp,image/heic,image/heif"
          multiple
          hidden
          data-testid="scan-files"
          onChange={(event) => {
            void add([...(event.target.files ?? [])]);
            event.target.value = '';
          }}
        />
        <button type="button" className="button" onClick={() => picker.current?.click()}>
          <Icon name="upload" /> {t('scan.add')}
        </button>
        <button type="button" className="button" onClick={() => setCamera(true)}>
          <Icon name="image" /> {t('scan.camera')}
        </button>
        {pages.length > 0 ? (
          <>
            <span className="muted small" aria-live="polite">
              {t('scan.count', { count: pages.length })}
            </span>
            <button type="button" className="button" disabled={busy} onClick={() => void make()}>
              <Icon name="download" /> {busy ? t('scan.working') : t('scan.download')}
            </button>
            <button
              type="button"
              className="button button--quiet"
              disabled={busy}
              onClick={() => void make(false, 'sign')}
            >
              <Icon name="signature" /> {t('scan.sign')}
            </button>
            <button
              type="button"
              className="button button--quiet"
              disabled={busy}
              onClick={() => void make(false, 'send')}
            >
              <Icon name="email" /> {t('scan.send')}
            </button>
          </>
        ) : null}
        <Link className="button button--quiet" to="/forms?new">
          {t('scan.toForm')}
        </Link>
      </div>

      {camera ? (
        <CameraScan
          onCancel={() => setCamera(false)}
          onDone={(taken) => {
            setCamera(false);
            void add(taken);
          }}
        />
      ) : null}
      <WordToPdf onPdf={(pdf) => void add([pdf])} />
      <InvoiceScanEntry />

      {pages.length === 0 ? (
        <EmptyState icon="upload" title={t('scan.empty')} />
      ) : (
        <ol className="scan__pages" aria-label={t('scan.heading')}>
          {pages.map((page, position) => (
            <li key={page.id} className="scan__page">
              <Thumb source={sources[page.file]!} index={page.page} turn={page.turn} />
              <span className="small">{t('scan.page', { n: position + 1 })}</span>
              <span className="scan__actions">
                <PageButton
                  label={t('scan.earlier')}
                  icon="arrow-left"
                  disabled={position === 0}
                  onClick={() => setPages(movePage(pages, page.id, -1))}
                />
                <PageButton
                  label={t('scan.later')}
                  icon="arrow-right"
                  disabled={position === pages.length - 1}
                  onClick={() => setPages(movePage(pages, page.id, 1))}
                />
                <PageButton
                  label={t('scan.turn')}
                  icon="redo"
                  onClick={() => setPages(turnPage(pages, page.id))}
                />
                <PageButton
                  label={t('scan.edit')}
                  icon="edit"
                  disabled={busy}
                  onClick={() => void make(false, (blob) => setEditing({ blob, page: position }))}
                />
                <PageButton
                  label={t('scan.remove')}
                  icon="trash"
                  onClick={() => setPages(removePage(pages, page.id))}
                />
              </span>
            </li>
          ))}
        </ol>
      )}
      {editing ? (
        <Suspense fallback={null}>
          <ScanEdit
            blob={editing.blob}
            page={editing.page}
            onCancel={() => setEditing(null)}
            onDone={(file) => {
              setEditing(null);
              void replaceAll(file);
            }}
          />
        </Suspense>
      ) : null}
    </section>
  );
}

function PageButton({
  label,
  icon,
  disabled,
  onClick,
}: {
  label: string;
  icon: 'arrow-left' | 'arrow-right' | 'redo' | 'trash' | 'edit';
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="button button--quiet button--icon"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon name={icon} />
    </button>
  );
}

/** A page as a small picture, turned by CSS as far as the person has turned it. */
function Thumb({ source, index, turn }: { source: Source; index: number; turn: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const pdf = 'pdf' in source ? source.pdf : null;
  useEffect(() => {
    const element = canvas.current;
    if (!element || !pdf) return;
    const drawing = new AbortController();
    pdf.render(index, 140, element, drawing.signal).catch(() => {});
    return () => drawing.abort();
  }, [pdf, index]);
  const style = { transform: `rotate(${turn}deg)` };
  return (
    <span className="scan__thumb">
      {'url' in source ? (
        <img src={source.url} alt="" className="scan__canvas" style={style} />
      ) : (
        <canvas ref={canvas} className="scan__canvas" style={style} />
      )}
    </span>
  );
}

/** Which of the screen's sentences a failure is, by the server's code. */
function errorKey(error: unknown) {
  const code = error instanceof ApiError ? error.code : '';
  switch (code) {
    case 'encrypted':
      return 'scan.error.encrypted' as const;
    case 'unreadable':
    case 'too-costly':
    case 'image-too-large':
      return 'scan.error.unreadable' as const;
    case 'too-large':
      return 'scan.error.tooLarge' as const;
    case 'too-many-files':
      return 'scan.error.tooMany' as const;
    case 'too-many-pages':
      return 'scan.error.tooManyPages' as const;
    default:
      return 'scan.error.failed' as const;
  }
}
