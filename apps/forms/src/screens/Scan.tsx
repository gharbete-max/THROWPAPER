import { lazy, Suspense, useEffect, useRef, useState, type DragEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { ApiError, client } from '../lib/api.js';
import { saveBlob } from '../lib/email-handoff.js';
import { droppedFromState, fillWith, summaryWith } from '../lib/documents-handoff.js';
import { modelBridge } from '../lib/model-bridge.js';
import { remember } from '../lib/recent-docs.js';
import { sendWith } from '../lib/send-handoff.js';
import { signingWith } from '../lib/sign-handoff.js';
import { sniffFile, type Sniffed } from '../lib/sniff.js';
import { topLines, withPdf } from '../lib/suggest-name.js';
import { useSession } from '../lib/session.js';
import { useT } from '../lib/i18n.js';
import { useToast } from '../lib/toast.js';
import { Handoffs } from './documents/Handoffs.js';
import { OpenedNotice, type OpenedAs } from './documents/OpenedNotice.js';
import { useConfirm } from '../components/Confirm.js';
import { CameraScan } from '../components/CameraScan.js';
import { EmptyState } from '../components/EmptyState.js';
import { Icon } from '../components/Icon.js';
import { openPdf, type PaperPdf } from './builder/paper/extract.js';
import { preparePhoto } from './scan-photo.js';
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
const DigitalCopy = lazy(() => import('./digital-copy/DigitalCopy.js'));
const KeepPanel = lazy(() => import('./documents/KeepPanel.js'));
const ScanFilter = lazy(() => import('./scan-filter/ScanFilter.js'));

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
  const [copying, setCopying] = useState<{ source: Blob | HTMLCanvasElement; turn: number } | null>(
    null,
  );
  const [filtering, setFiltering] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const { user } = useSession();
  const location = useLocation();
  const [words, setWords] = useState<File[]>([]);
  const [opened, setOpened] = useState<OpenedAs | null>(null);
  const [invoiceFile, setInvoiceFile] = useState<File | null>(null);
  const [keeping, setKeeping] = useState(false);
  const handled = useRef(false);
  // How many files the list holds, kept synchronously: two adds in flight (a drop of mixed files) must not share an index.
  const count = useRef(0);

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

  /** What the files are, by their bytes. Returns the sources it opened, with the files they came from. */
  async function add(chosen: File[], sniffed?: Sniffed[]) {
    if (chosen.length === 0) return null;
    const kinds = sniffed ?? (await Promise.all(chosen.map((file) => sniffFile(file))));
    const wanted = chosen.filter((_, i) => kinds[i] === 'pdf' || kinds[i] === 'photo');
    const wantedKinds = kinds.filter((kind) => kind === 'pdf' || kind === 'photo');
    if (wanted.length < chosen.length) say('scan.error.notSupported');
    if (wanted.length === 0) return null;
    if (count.current + wanted.length > MAX_FILES) return void say('scan.error.tooMany');
    if (wanted.some((file) => file.size > MAX_FILE_BYTES)) return void say('scan.error.tooLarge');

    const sent: File[] = [];
    const opened: Source[] = [];
    try {
      for (const [at, file] of wanted.entries()) {
        if (wantedKinds[at] === 'photo') {
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
      return void say('scan.error.unreadable');
    }
    const first = count.current;
    count.current += sent.length;
    setFiles((current) => [...current, ...sent]);
    setSources((current) => [...current, ...opened]);
    setPages((current) => [
      ...current,
      ...opened.flatMap((source, index) =>
        pagesOfFile(first + index, 'pdf' in source ? source.pdf.pageCount : 1),
      ),
    ]);
    return { sent, opened: opened, kinds: wantedKinds };
  }

  /**
   * Files from a drop, the picker or the room: each is told apart by its bytes, remembered by name,
   * and put where it belongs. A Word file is made into a PDF by `WordToPdf`, which adds it; the rest
   * go into the page list. What was done is said, and the other ways to open it are offered.
   */
  async function receive(chosen: File[]) {
    const kinds = await Promise.all(chosen.map((file) => sniffFile(file)));
    const word = chosen.filter((_, i) => kinds[i] === 'word');
    const rest = chosen.filter((_, i) => kinds[i] === 'pdf' || kinds[i] === 'photo');
    if (word.length + rest.length < chosen.length) say('scan.error.notSupported');
    if (word.length + rest.length === 0) return;
    chosen.forEach((file, i) => {
      const kind = kinds[i];
      if (user && kind && kind !== 'other') remember(user.id, file, kind);
    });
    if (word.length > 0) setWords(word);
    const added = rest.length > 0 ? await add(rest) : null;
    if (rest.length > 0 && !added) return;

    const total = word.length + rest.length;
    const only = total === 1 ? (word[0] ?? rest[0]!) : null;
    const kind =
      total > 1 ? 'several' : word.length === 1 ? 'word' : (added!.kinds[0] as 'pdf' | 'photo');
    const source = added?.opened[0];
    const hasFields = kind === 'pdf' && !!source && 'pdf' in source && source.pdf.fields.length > 0;
    setOpened({
      kind,
      fill: only && hasFields ? () => navigate(...fillWith(only)) : null,
      choices:
        only && kind === 'pdf'
          ? [
              { key: 'fill', run: () => navigate(...fillWith(only)) },
              { key: 'invoice', run: () => setInvoiceFile(only) },
            ]
          : only && kind === 'photo'
            ? [{ key: 'invoice', run: () => setInvoiceFile(only) }]
            : [],
    });
  }

  useEffect(() => {
    const dropped = droppedFromState(location.state);
    if (dropped.length === 0 || handled.current) return;
    handled.current = true;
    // The files are taken out of the history state, so going back here does not add them again.
    void navigate(location.pathname, { replace: true, state: null });
    void receive(dropped);
    // Once, for what the room handed over when this opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** The first page's own text, for a name to suggest. A PDF made from Word offers its own name. */
  async function firstPageText() {
    const first = pages[0];
    if (!first) return '';
    const file = files[first.file];
    if (file && fromWord.has(file)) return file.name.replace(/\.pdf$/i, '');
    const source = sources[first.file];
    if (!source || !('pdf' in source)) return '';
    return topLines(await source.pdf.text(first.page));
  }

  /**
   * `then` is what happens to the made PDF: saved to disk, handed on to Signing, Send or Summary, or
   * (a function) given to the caller, as the editing step is. `keep` is the files and name chosen
   * on the keep panel.
   */
  async function make(
    acceptSignatureLoss = false,
    then: 'download' | 'sign' | 'send' | 'summarise' | ((blob: Blob) => void) = 'download',
    keep?: { files: File[]; name: string },
  ) {
    const request = requestOf(pages, keep?.files ?? files);
    setBusy(true);
    try {
      const blob = await client.arrangePdf(request.files, request.plan, acceptSignatureLoss);
      // A PDF made from a Word file keeps "layout may differ from Word" in its name.
      const name = keep?.name ?? files.find((file) => fromWord.has(file))?.name ?? 'loppa.pdf';
      const made = new File([blob], name, { type: 'application/pdf' });
      if (typeof then === 'function') then(blob);
      else if (then === 'sign') navigate(...signingWith(made));
      else if (then === 'send') navigate(...sendWith(made));
      else if (then === 'summarise') navigate(...summaryWith(made));
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
    count.current = 1;
    setFiles([file]);
    setSources([{ pdf }]);
    setPages(pagesOfFile(0, pdf.pageCount));
  }

  /** A page as a picture for its digital copy: the photograph itself, or a PDF's page drawn. */
  async function copyOf(page: ScanPage) {
    const source = sources[page.file]!;
    setCopying({
      source: 'pdf' in source ? await source.pdf.picture(page.page, 3000) : files[page.file]!,
      turn: page.turn,
    });
  }

  /** A photograph made over (filtered, or put back): its file and drawing change, its place does not. */
  function replacePhoto(index: number, photo: File) {
    const old = sources[index];
    if (old && 'url' in old) URL.revokeObjectURL(old.url);
    setFiles((current) => current.map((file, i) => (i === index ? photo : file)));
    setSources((current) =>
      current.map((source, i) => (i === index ? { url: URL.createObjectURL(photo) } : source)),
    );
    setFiltering(null);
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    void receive([...event.dataTransfer.files]);
  }

  // Summarise needs this computer's model; Fill needs the one PDF the person added, untouched.
  const onlyPdf = sources.length === 1 ? sources[0] : undefined;
  const fillable =
    onlyPdf &&
    'pdf' in onlyPdf &&
    onlyPdf.pdf.fields.length > 0 &&
    pages.length === onlyPdf.pdf.pageCount
      ? files[0]!
      : null;

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
          accept="application/pdf,.pdf,.docx,image/jpeg,image/png,image/webp,image/heic,image/heif"
          multiple
          hidden
          data-testid="scan-files"
          onChange={(event) => {
            void receive([...(event.target.files ?? [])]);
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
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={() => setKeeping(true)}
            >
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
            <Handoffs
              busy={busy}
              onSummarise={modelBridge() ? () => void make(false, 'summarise') : null}
              onFill={fillable ? () => navigate(...fillWith(fillable)) : null}
            />
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
      {opened ? <OpenedNotice opened={opened} /> : null}
      {keeping ? (
        <Suspense fallback={null}>
          <KeepPanel
            files={files}
            used={[...new Set(pages.map((page) => page.file))]}
            firstText={firstPageText}
            busy={busy}
            onCancel={() => setKeeping(false)}
            onKeep={(kept, name) => {
              setKeeping(false);
              void make(false, 'download', { files: kept, name: withPdf(name) });
            }}
          />
        </Suspense>
      ) : null}
      <WordToPdf incoming={words} onTaken={() => setWords([])} onPdf={(pdf) => void add([pdf])} />
      <InvoiceScanEntry file={invoiceFile} />

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
                {'url' in sources[page.file]! ? (
                  <PageButton
                    label={t('scan.filter.open')}
                    icon="preview"
                    onClick={() => setFiltering(page.id)}
                  />
                ) : null}
                <PageButton
                  label={t('scan.edit')}
                  icon="edit"
                  disabled={busy}
                  onClick={() => void make(false, (blob) => setEditing({ blob, page: position }))}
                />
                <PageButton
                  label={t('copy.open')}
                  icon="file"
                  disabled={busy}
                  onClick={() => void copyOf(page).catch(() => say('scan.error.unreadable'))}
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
      {copying ? (
        <Suspense fallback={null}>
          <DigitalCopy
            source={copying.source}
            turn={copying.turn}
            onClose={() => setCopying(null)}
          />
        </Suspense>
      ) : null}
      {pages.map((page, position) =>
        page.id === filtering ? (
          <Suspense key={page.id} fallback={null}>
            <ScanFilter
              number={position + 1}
              file={files[page.file]!}
              onApply={(photo) => replacePhoto(page.file, photo)}
              onClose={() => setFiltering(null)}
            />
          </Suspense>
        ) : null,
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
  icon: 'arrow-left' | 'arrow-right' | 'redo' | 'trash' | 'edit' | 'preview' | 'file';
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
