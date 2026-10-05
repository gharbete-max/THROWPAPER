import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { BUILDER_GRAPH, importQuestions, reimport, type Conversation } from '@tp/shared/builder';
import { MAX_PAPER_PAGES } from '@tp/shared/forms';
import { MAX_PASTE, type ImportChoices, type PageBox } from '@tp/shared/import';
import { LoadFailed } from '../../../components/LoadFailed.js';
import { Loading } from '../../../components/Loading.js';
import { client } from '../../../lib/api.js';
import { useT } from '../../../lib/i18n.js';
import { useSession } from '../../../lib/session.js';
import { startConversation } from '../guided/conversation.js';
import { Saver } from '../guided/saver.js';
import { clipboardText } from '../paper/clipboard.js';
import { isDocx, readDocx } from '../paper/docx.js';
import { fieldBoxes, openPdf, TooManyPages, type PageDrawer } from '../paper/extract.js';
import {
  openPageReader,
  READ_LONG_SIDE,
  ReadingPageTooSlow,
  type PageReader,
} from '../paper/ocr.js';
import { photoDocument } from '../paper/ocr-words.js';
import { isPhoto, openPhoto, PHOTO_TYPES } from '../paper/photo.js';
import type { Reading } from '../paper/reading.js';
import { NoWorker, ReadingTooSlow, readInWorker } from '../paper/read-in-worker.js';
import { DocxRefused } from '../paper/refusal.js';
import { ChangesPane } from './ChangesPane.js';
import { DraftPane } from './DraftPane.js';
import { importOf, roomForPaper, type PaperOf } from './fields.js';
import { reviewKey } from './keys.js';
import {
  changesAnything,
  compareWithForm,
  isUpdate,
  itemsAdded,
  keptAlready,
  noChoices,
  nothingChanged,
  reimportOf,
  type Update,
} from './reimport.js';
import {
  act,
  counts,
  follow,
  readyToUse,
  startReview,
  undo,
  type Action,
  type Review,
} from './review.js';
import { SourcePane } from './SourcePane.js';

/**
 * "Start from paper" — the review screen, at `/forms/:id/import` (`IMPORT-PIPELINE.md` §8,
 * `PREDICTIVE-BUILDER.md`, "The two doors"). Never skipped.
 *
 * The author gives it a PDF, a Word document or a photograph of a form, or pastes text; the stages
 * read it in their worker, on this device. A photograph, and a PDF's pages that are a scan, are read
 * word by word by OCR first, in a worker of its own (S14, `docs/plan/SCANS.md`). The review opens
 * on one sentence — "I read 14 questions. 3 need your eye." — the document on one side and the
 * form it would make on the other, linked line by line. Nothing enters the form until "Use these
 * questions", which adds them through the conversation's machine as one step Back undoes, saves,
 * and goes on in the conversation (S12). What was read never leaves the machine: only the
 * questions the author added do, in the draft (`CAVEATS.md` #43).
 */
export function ReviewScreen() {
  const { id } = useParams();
  const t = useT();
  const navigate = useNavigate();
  const { locales, contentLocale, user } = useSession();

  const [conversation, setConversation] = useState<Conversation | null>(null);
  const saver = useRef<Saver | null>(null);
  const [failed, setFailed] = useState(false);

  const [phase, setPhase] = useState<'choose' | 'reading' | 'review' | 'using'>('choose');
  /** The page OCR is reading, while it reads one: it takes seconds, not milliseconds. */
  const [ocrPage, setOcrPage] = useState<{ page: number; count: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState('');
  const [read, setRead] = useState<{
    reading: Reading;
    /** What draws its pages in the source pane: its PDF, or its photograph. */
    pages: PageDrawer | null;
    /** A PDF's file and its own fields' widgets: what the form keeps to write answers back on (S12b). */
    paper: { file: File; pages: number; widgets: ReadonlyMap<string, PageBox> } | null;
  } | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** On a form that has anything already (S12c): what the person chose to take from the document. */
  const [choices, setChoices] = useState<ImportChoices>(noChoices);
  /** Somebody saved this form's conversation in another tab: nothing more is added from here. */
  const [conflict, setConflict] = useState(false);
  /** Whether the screen is still open, for a document that finishes reading after it was left. */
  const open = useRef(true);
  useEffect(
    () => () => {
      open.current = false;
    },
    [],
  );

  const load = useCallback(() => {
    if (!id) return;
    setFailed(false);
    setConversation(null);
    Promise.all([
      client.getForm(id),
      client.builderSession(id),
      client.brandKit().catch(() => null),
    ])
      .then(([form, stored, brand]) => {
        const started = startConversation({
          graph: BUILDER_GRAPH,
          definition: form.draftDefinition,
          title: form.title,
          stored: stored.session,
          brandKitExists: brand?.customised ?? false,
          canChangeBrand: user?.role === 'admin',
        });
        saver.current = new Saver(client, BUILDER_GRAPH, id, {
          version: stored.version,
          draft: form.draftDefinition,
          title: form.title,
        });
        setConversation(started.conversation);
      })
      .catch(() => setFailed(true));
  }, [id, user?.role]);

  useEffect(load, [load]);

  // An open PDF or photograph holds its pages for the source pane; closed when another replaces it,
  // or on leaving.
  useEffect(() => () => void read?.pages?.close(), [read]);

  function refused(cause: unknown) {
    setPhase('choose');
    setError(
      cause instanceof TooManyPages
        ? t('paper.tooManyPages', { count: cause.pages, max: MAX_PAPER_PAGES })
        : cause instanceof DocxRefused
          ? t(`paper.docx.${cause.reason}`)
          : cause instanceof ReadingTooSlow
            ? t('paper.tooSlow')
            : cause instanceof ReadingPageTooSlow
              ? t('review.ocrTooSlow')
              : cause instanceof NoWorker
                ? t('paper.noWorker')
                : t('paper.notReadable'),
    );
  }

  function opened(
    reading: Reading,
    pages: PageDrawer | null,
    paper: { file: File; pages: number; widgets: ReadonlyMap<string, PageBox> } | null = null,
  ) {
    if (!open.current) {
      void pages?.close();
      return;
    }
    const started = startReview(reading);
    setRead({ reading, pages, paper });
    setReview(started);
    setChoices(noChoices);
    setSelectedId(started.items[0]?.id ?? null);
    setError(null);
    setPhase('review');
  }

  async function chooseFile(file: File | undefined) {
    if (!file) return;
    setPhase('reading');
    setError(null);
    // One OCR worker for the whole document, started only when a page needs it.
    let reader: PageReader | null = null;
    const readByOcr = async (
      picture: () => Promise<HTMLCanvasElement>,
      page: number,
      count: number,
    ) => {
      setOcrPage({ page, count });
      reader ??= await openPageReader(contentLocale);
      return reader.read(await picture());
    };
    try {
      if (isDocx(file)) {
        const raw = await readDocx(await file.arrayBuffer());
        opened(await readInWorker({ kind: 'raw', raw }), null);
      } else if (file.type === 'application/pdf') {
        const pdf = await openPdf(await file.arrayBuffer(), 0);
        try {
          const boxes = fieldBoxes(pdf.fields, 0);
          // A page with no text layer is a scan: its words are read by OCR.
          const raw = await pdf.raw({
            ocr: (index) =>
              readByOcr(() => pdf.picture(index, READ_LONG_SIDE), index + 1, pdf.pageCount),
          });
          const widgets = new Map(
            boxes.map((box) => [box.name, { pageNo: box.pageNo, box: box.box }]),
          );
          opened(await readInWorker({ kind: 'raw', raw, fields: boxes }), pdf, {
            file,
            pages: pdf.pageCount,
            widgets,
          });
        } catch (cause) {
          await pdf.close();
          throw cause;
        }
      } else if (isPhoto(file)) {
        // One page, read as it is; the form keeps no paper of it (`SCANS.md` §3).
        const photo = await openPhoto(file);
        try {
          const recognised = await readByOcr(
            () => Promise.resolve(photo.picture(READ_LONG_SIDE)),
            1,
            1,
          );
          const raw = photoDocument(recognised, photo.sha256);
          opened(await readInWorker({ kind: 'raw', raw }), photo);
        } catch (cause) {
          await photo.close();
          throw cause;
        }
      } else {
        refused(new Error(file.type));
      }
    } catch (cause) {
      refused(cause);
    } finally {
      setOcrPage(null);
      await (reader as PageReader | null)?.close();
    }
  }

  async function readPasted() {
    setPhase('reading');
    setError(null);
    try {
      opened(await readInWorker({ kind: 'paste', text: pasted }), null);
    } catch (cause) {
      refused(cause);
    }
  }

  /** The review after `step`, with the selection on what became of the selected item. */
  function change(step: (current: Review) => Review) {
    if (!review) return;
    const next = step(review);
    setReview(next);
    setSelectedId(follow(review.items, next.items, selectedId));
  }

  function perform(action: Action) {
    change((current) => act(current, action));
  }

  async function use() {
    if (!review || !conversation || !saver.current || !id || conflict) return;
    setError(null);
    setPhase('using');
    // A PDF is kept with the form first, so a response can come back as that paper (S12b). If it
    // cannot be kept, nothing is added: trying again is one press.
    let source: { key: string; pages: number } | undefined;
    let paper: PaperOf | undefined;
    if (read?.paper && roomForPaper(conversation.state.draft.definition)) {
      try {
        const kept = await client.addPaper(id, read.paper.file);
        source = { key: kept.key, pages: read.paper.pages };
      } catch {
        setPhase('review');
        setError(t('review.useFailed'));
        return;
      }
      const kept = conversation.state.draft.definition.paper?.sources ?? [];
      paper = {
        layout: read.reading.layout,
        firstPage: kept.reduce((pages, one) => pages + one.pages, 0),
        widgets: read.paper.widgets,
      };
    }
    let next: Conversation;
    try {
      const { fields, decided } = importOf(review.items, {
        definition: conversation.state.draft.definition,
        retired: conversation.state.sidecar.retiredIds,
        locale: contentLocale,
        ...(paper ? { paper } : {}),
      });
      // What the document decided goes with them, so the conversation asks only the rest (S12).
      next = importQuestions(BUILDER_GRAPH, conversation, fields, decided, source);
    } catch {
      // Refused by the machine, or a question the form cannot hold: said, never left unhandled.
      setPhase('review');
      setError(t('review.useFailed'));
      return;
    }
    // The saver never rejects: how it went is its status.
    const current = saver.current;
    await current.save(next);
    await current.settled();
    if (current.status === 'conflict') {
      // The draft may already hold the questions; adding them again would add them twice.
      setConflict(true);
      setPhase('review');
      setError(t('review.conflict'));
      return;
    }
    if (current.status !== 'saved') {
      setPhase('review');
      setError(t('review.useFailed'));
      return;
    }
    setConversation(next);
    // The two doors meet (S12): the conversation goes on from the questions just added — "Go
    // through the questions from your document?" — and "Build it myself" is one press from there.
    navigate(`/forms/${id}/guided`);
  }

  /**
   * "Update the form" (S12c): the form brought up to date with the document read again, as one step
   * the conversation's Back undoes; then on in the conversation, which walks what was added. The
   * paper the form keeps is left as it is (`CONVERGENCE.md`, "Not in S12").
   */
  async function updateForm(update: Update) {
    if (!conversation || !saver.current || !id || conflict) return;
    setError(null);
    setPhase('using');
    let next: Conversation;
    try {
      const plan = reimportOf(update, choices, {
        definition: conversation.state.draft.definition,
        sidecar: conversation.state.sidecar,
        locale: contentLocale,
      });
      next = reimport(BUILDER_GRAPH, conversation, plan);
    } catch {
      setPhase('review');
      setError(t('review.useFailed'));
      return;
    }
    const current = saver.current;
    await current.save(next);
    await current.settled();
    if (current.status === 'conflict') {
      setConflict(true);
      setPhase('review');
      setError(t('review.conflict'));
      return;
    }
    if (current.status !== 'saved') {
      setPhase('review');
      setError(t('review.useFailed'));
      return;
    }
    setConversation(next);
    navigate(`/forms/${id}/guided`);
  }

  // The keys, on the whole window, while a review is open.
  useEffect(() => {
    if (phase !== 'review' || !review) return;
    function onKey(event: KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing || !review) return;
      const target = event.target as HTMLElement | null;
      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target?.isContentEditable === true;
      const onControl = target?.closest('button, a, summary, [role="button"]') !== null;
      const key = reviewKey(event, { typing, onControl });
      if (!key) return;
      event.preventDefault();
      const at = review.items.findIndex((item) => item.id === selectedId);
      const item = review.items[at];
      if (key.kind === 'undo') change(undo);
      else if (key.kind === 'move') {
        const next = review.items[Math.min(review.items.length - 1, Math.max(0, at + key.by))];
        if (next) setSelectedId(next.id);
      } else if (!item) return;
      else if (key.kind === 'chip') {
        const type = item.alternatives[key.index];
        if (type) perform({ kind: 'pick', itemId: item.id, type });
      } else if (key.kind === 'split') perform({ kind: 'split', itemId: item.id, at: 1 });
      else perform({ kind: key.kind, itemId: item.id });
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (failed) return <LoadFailed onRetry={load} />;
  if (!conversation) return <Loading />;

  const editor = `/forms/${id}`;

  if (phase !== 'review' && phase !== 'using') {
    return (
      <section className="review review--choose stack">
        {isUpdate(conversation.state.draft.definition) ? (
          <>
            <h1>{t('paper.update')}</h1>
            <p className="muted">{t('review.choose.update')}</p>
          </>
        ) : (
          <>
            <h1>{t('conversation.doors.paper')}</h1>
            <p className="muted">{t('review.choose.explain')}</p>
          </>
        )}
        <div className="row">
          <label className="field">
            <span>{t('review.choose.file')}</span>
            <input
              type="file"
              accept={`application/pdf,${DOCX_TYPE},.docx,${PHOTO_TYPES.join(',')}`}
              disabled={phase === 'reading'}
              onChange={(event) => void chooseFile(event.target.files?.[0])}
            />
          </label>
          <button
            type="button"
            className="button button--quiet"
            aria-expanded={pasting}
            onClick={() => setPasting((open) => !open)}
          >
            {t('paper.paste.open')}
          </button>
        </div>
        {pasting && (
          <div className="stack">
            <label className="field">
              <span>{t('paper.paste.label')}</span>
              <textarea
                rows={8}
                maxLength={MAX_PASTE}
                value={pasted}
                onChange={(event) => setPasted(event.target.value)}
                onPaste={(event) => {
                  // Plain text is pasted by the browser as it is; only HTML alone is read here.
                  if (event.clipboardData.getData('text/plain').trim() !== '') return;
                  const text = clipboardText(event.clipboardData);
                  if (text === '') return;
                  event.preventDefault();
                  const area = event.currentTarget;
                  area.setRangeText(text, area.selectionStart, area.selectionEnd, 'end');
                  setPasted(area.value);
                }}
              />
            </label>
            <div className="row">
              <button
                type="button"
                className="button"
                disabled={pasted.trim() === '' || phase === 'reading'}
                onClick={() => void readPasted()}
              >
                {t('paper.paste.read')}
              </button>
            </div>
          </div>
        )}
        <div role="status" className="small">
          {phase === 'reading' && (
            <span className="muted">{ocrPage ? t('review.ocr', ocrPage) : t('paper.reading')}</span>
          )}
          {error && <span className="status-down">{error}</span>}
        </div>
        <p className="small muted">{t('review.photo')}</p>
        <div className="row">
          <Link className="button button--quiet" to={`${editor}?paper`}>
            {t('review.toEditor')}
          </Link>
          <Link className="button button--bare" to={editor}>
            {t('review.cancel')}
          </Link>
        </div>
      </section>
    );
  }

  if (!review || !read) return <Loading />;
  const tally = counts(review.items);
  const ready = readyToUse(review.items);
  // A PDF the form has no room to keep: its questions come without their places on it (said).
  const full =
    read.paper !== null &&
    conversation !== null &&
    !roomForPaper(conversation.state.draft.definition);
  // A form that has anything already is brought up to date, not added to (S12c).
  const definition = conversation?.state.draft.definition ?? null;
  const updating = definition !== null && isUpdate(definition);
  const same = updating && keptAlready(definition, read.reading.layout.source.sha256);
  const update =
    updating && !same && conversation
      ? compareWithForm(review.items, {
          definition,
          sidecar: conversation.state.sidecar,
          locale: contentLocale,
        })
      : null;
  const adding = update ? new Set(itemsAdded(update, choices)) : new Set<string>();
  const heldBack = review.items.some(
    (item) => adding.has(item.id) && item.bucket === 'review' && !item.decided,
  );
  const changing = update !== null && changesAnything(update, choices);

  return (
    <section className="review stack">
      <header className="review__head">
        <h1 className="review__summary" aria-live="polite">
          {t('review.summary', { count: tally.questions })}{' '}
          {tally.needEye > 0 ? t('review.needEye', { count: tally.needEye }) : t('review.allClear')}
        </h1>
        <p className="small muted">{t('review.note')}</p>
        <p className="small muted">{t('review.keys')}</p>
      </header>

      {tally.questions === 0 && (
        <p className="status-warning">
          {review.items.length === 0 ? t('review.empty') : t('review.noQuestions')}
        </p>
      )}
      {same && <p className="status-ok">{t('review.changes.same')}</p>}
      {update && (
        <ChangesPane
          update={update}
          choices={choices}
          onChoose={setChoices}
          keepsPaper={(definition?.paper?.sources.length ?? 0) > 0}
        />
      )}
      {review.items.length > 0 && (
        <div className="review__panes">
          <SourcePane
            layout={read.reading.layout}
            pages={read.pages}
            items={review.items}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
          <DraftPane
            review={review}
            debug={read.reading.debug}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onAct={perform}
            locale={contentLocale}
            locales={locales}
          />
        </div>
      )}

      <footer className="review__foot">
        <div role="status" className="small">
          {error && <span className="status-down">{error}</span>}
          {!error && !updating && tally.needEye > 0 && <span>{t('review.useBlocked')}</span>}
          {!error && !updating && tally.needEye === 0 && tally.texts > 0 && tally.questions > 0 && (
            <span className="muted">{t('review.useTexts')}</span>
          )}
          {!error && !updating && full && (
            <span>{t('review.paperFull', { max: MAX_PAPER_PAGES })}</span>
          )}
          {!error && update && heldBack && <span>{t('review.useBlocked')}</span>}
          {!error && update && !changing && !nothingChanged(update.comparison) && (
            <span className="muted">{t('review.changes.pick')}</span>
          )}
        </div>
        <div className="row">
          {updating ? (
            <button
              type="button"
              className="button"
              disabled={!update || !changing || heldBack || phase === 'using' || conflict}
              onClick={() => update && void updateForm(update)}
            >
              {phase === 'using' ? t('review.using') : t('review.update')}
            </button>
          ) : (
            <button
              type="button"
              className="button"
              disabled={!ready || tally.questions === 0 || phase === 'using' || conflict}
              onClick={() => void use()}
            >
              {phase === 'using' ? t('review.using') : t('review.use', { count: tally.questions })}
            </button>
          )}
          <button
            type="button"
            className="button button--quiet"
            disabled={review.actions.length === 0 || phase === 'using'}
            aria-keyshortcuts="Control+Z Meta+Z"
            onClick={() => change(undo)}
          >
            {t('review.undo')}
          </button>
          <button
            type="button"
            className="button button--quiet"
            disabled={phase === 'using'}
            onClick={() => {
              setRead(null);
              setReview(null);
              setSelectedId(null);
              setPasting(false);
              setPasted('');
              setError(null);
              setPhase('choose');
            }}
          >
            {t('review.again')}
          </button>
          {/* Not while the questions are saved: the editor would open on the draft before them. */}
          <button
            type="button"
            className="button button--bare"
            disabled={phase === 'using'}
            onClick={() => navigate(editor)}
          >
            {t('review.cancel')}
          </button>
        </div>
      </footer>
    </section>
  );
}

const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
