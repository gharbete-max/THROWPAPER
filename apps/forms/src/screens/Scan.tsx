import { useEffect, useRef, useState, type DragEvent } from 'react';
import { Link } from 'react-router';
import { ApiError, client } from '../lib/api.js';
import { saveBlob } from '../lib/email-handoff.js';
import { useT } from '../lib/i18n.js';
import { useToast } from '../lib/toast.js';
import { useConfirm } from '../components/Confirm.js';
import { EmptyState } from '../components/EmptyState.js';
import { Icon } from '../components/Icon.js';
import { openPdf, type PaperPdf } from './builder/paper/extract.js';
import {
  movePage,
  pagesOfFile,
  removePage,
  requestOf,
  turnPage,
  type ScanPage,
} from './scan-plan.js';

/** The server's limits (`api-forms/src/pdf/arrange.ts`), so the screen can say so before sending. */
const MAX_FILES = 10;
const MAX_FILE_BYTES = 25 * 1024 * 1024;

/**
 * Arrange pages: PDFs put together, pages taken out, turned and put in order, then made into one
 * PDF to download. The server does the work (`POST /v1/pdf/arrange`) and keeps nothing; the pages
 * shown here are drawn in this browser from the files the person chose.
 */
export function Scan() {
  const t = useT();
  const toast = useToast();
  const confirm = useConfirm();
  const [files, setFiles] = useState<File[]>([]);
  const [pdfs, setPdfs] = useState<PaperPdf[]>([]);
  const [pages, setPages] = useState<ScanPage[]>([]);
  const [busy, setBusy] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  // The drawings are released when the screen goes.
  const open = useRef<PaperPdf[]>([]);
  open.current = pdfs;
  useEffect(
    () => () => {
      for (const pdf of open.current) void pdf.close();
    },
    [],
  );

  function say(key: ReturnType<typeof errorKey>) {
    toast.show(t(key), 'error');
  }

  async function add(chosen: File[]) {
    const pdfFiles = chosen.filter(
      (file) => file.type === 'application/pdf' || /\.pdf$/i.test(file.name),
    );
    if (pdfFiles.length === 0) return;
    if (files.length + pdfFiles.length > MAX_FILES) return say('scan.error.tooMany');
    if (pdfFiles.some((file) => file.size > MAX_FILE_BYTES)) return say('scan.error.tooLarge');

    const opened: PaperPdf[] = [];
    try {
      for (const file of pdfFiles) opened.push(await openPdf(await file.arrayBuffer()));
    } catch {
      for (const pdf of opened) void pdf.close();
      return say('scan.error.unreadable');
    }
    const first = files.length;
    setFiles((current) => [...current, ...pdfFiles]);
    setPdfs((current) => [...current, ...opened]);
    setPages((current) => [
      ...current,
      ...opened.flatMap((pdf, index) => pagesOfFile(first + index, pdf.pageCount)),
    ]);
  }

  async function make(acceptSignatureLoss = false) {
    const request = requestOf(pages, files);
    setBusy(true);
    try {
      const blob = await client.arrangePdf(request.files, request.plan, acceptSignatureLoss);
      saveBlob(blob, 'loppa.pdf');
    } catch (error) {
      if (error instanceof ApiError && error.code === 'signed') {
        // Asked before anything is changed: the new PDF cannot carry the old signature.
        const agreed = await confirm(t('scan.signed'), {
          confirmLabel: t('scan.signedConfirm'),
          danger: true,
        });
        if (agreed) {
          setBusy(false);
          return make(true);
        }
      } else {
        say(errorKey(error));
      }
    } finally {
      setBusy(false);
    }
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
          accept="application/pdf,.pdf"
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
        {pages.length > 0 ? (
          <>
            <span className="muted small" aria-live="polite">
              {t('scan.count', { count: pages.length })}
            </span>
            <button type="button" className="button" disabled={busy} onClick={() => void make()}>
              <Icon name="download" /> {busy ? t('scan.working') : t('scan.download')}
            </button>
          </>
        ) : null}
        <Link className="button button--quiet" to="/forms?new">
          {t('scan.toForm')}
        </Link>
      </div>

      {pages.length === 0 ? (
        <EmptyState icon="upload" title={t('scan.empty')} />
      ) : (
        <ol className="scan__pages" aria-label={t('scan.heading')}>
          {pages.map((page, position) => (
            <li key={page.id} className="scan__page">
              <Thumb pdf={pdfs[page.file]!} index={page.page} turn={page.turn} />
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
                  label={t('scan.remove')}
                  icon="trash"
                  onClick={() => setPages(removePage(pages, page.id))}
                />
              </span>
            </li>
          ))}
        </ol>
      )}
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
  icon: 'arrow-left' | 'arrow-right' | 'redo' | 'trash';
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
function Thumb({ pdf, index, turn }: { pdf: PaperPdf; index: number; turn: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const drawing = new AbortController();
    pdf.render(index, 140, element, drawing.signal).catch(() => {});
    return () => drawing.abort();
  }, [pdf, index]);
  return (
    <span className="scan__thumb">
      <canvas ref={canvas} className="scan__canvas" style={{ transform: `rotate(${turn}deg)` }} />
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
