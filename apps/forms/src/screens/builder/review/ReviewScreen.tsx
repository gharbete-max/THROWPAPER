import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import {
  BUILDER_GRAPH,
  importQuestions,
  MachineError,
  type Conversation,
} from '@tp/shared/builder';
import { MAX_PAPER_PAGES } from '@tp/shared/forms';
import { MAX_PASTE } from '@tp/shared/import';
import { LoadFailed } from '../../../components/LoadFailed.js';
import { Loading } from '../../../components/Loading.js';
import { client } from '../../../lib/api.js';
import { useT } from '../../../lib/i18n.js';
import { useSession } from '../../../lib/session.js';
import { startConversation } from '../guided/conversation.js';
import { Saver } from '../guided/saver.js';
import { clipboardText } from '../paper/clipboard.js';
import { isDocx, readDocx } from '../paper/docx.js';
import { fieldBoxes, openPdf, TooManyPages, type PaperPdf } from '../paper/extract.js';
import type { Reading } from '../paper/reading.js';
import { NoWorker, ReadingTooSlow, readInWorker } from '../paper/read-in-worker.js';
import { DocxRefused } from '../paper/refusal.js';
import { DraftPane } from './DraftPane.js';
import { fieldsOf } from './fields.js';
import { reviewKey } from './keys.js';
import { act, counts, readyToUse, startReview, undo, type Action, type Review } from './review.js';
import { SourcePane } from './SourcePane.js';

/**
 * "Start from paper" — the review screen, at `/forms/:id/import` (`IMPORT-PIPELINE.md` §8,
 * `PREDICTIVE-BUILDER.md`, "The two doors"). Never skipped.
 *
 * The author gives it a PDF or a Word document, or pastes text; the stages read it in their worker,
 * on this device. The review opens on one sentence — "I read 14 questions. 3 need your eye." — the
 * document on one side and the form it would make on the other, linked line by line. Nothing enters
 * the form until "Use these questions", which adds them through the conversation's machine as one
 * step Back undoes, saves, and opens the editor. What was read never leaves the machine: only the
 * questions the author added do, in the draft (`CAVEATS.md` #43).
 *
 * A photograph or a scanned page is not read here yet; the editor's paper import takes it as pages
 * to draw on (ADR 0004).
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
  const [error, setError] = useState<string | null>(null);
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState('');
  const [read, setRead] = useState<{ reading: Reading; pdf: PaperPdf | null } | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

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
        });
        setConversation(started.conversation);
      })
      .catch(() => setFailed(true));
  }, [id, user?.role]);

  useEffect(load, [load]);

  // An open PDF holds its pages for the source pane; closed when another replaces it, or on leaving.
  useEffect(() => () => void read?.pdf?.close(), [read]);

  function refused(cause: unknown) {
    setPhase('choose');
    setError(
      cause instanceof TooManyPages
        ? t('paper.tooManyPages', { count: cause.pages, max: MAX_PAPER_PAGES })
        : cause instanceof DocxRefused
          ? t(`paper.docx.${cause.reason}`)
          : cause instanceof ReadingTooSlow
            ? t('paper.tooSlow')
            : cause instanceof NoWorker
              ? t('paper.noWorker')
              : t('paper.notReadable'),
    );
  }

  function opened(reading: Reading, pdf: PaperPdf | null) {
    const started = startReview(reading);
    setRead({ reading, pdf });
    setReview(started);
    setSelectedId(started.items[0]?.id ?? null);
    setError(null);
    setPhase('review');
  }

  async function chooseFile(file: File | undefined) {
    if (!file) return;
    setPhase('reading');
    setError(null);
    try {
      if (isDocx(file)) {
        const raw = await readDocx(await file.arrayBuffer());
        opened(await readInWorker({ kind: 'raw', raw }), null);
      } else if (file.type === 'application/pdf') {
        const pdf = await openPdf(await file.arrayBuffer(), 0);
        try {
          const boxes = fieldBoxes(pdf.fields, 0);
          const raw = await pdf.raw();
          opened(await readInWorker({ kind: 'raw', raw, fields: boxes }), pdf);
        } catch (cause) {
          await pdf.close();
          throw cause;
        }
      } else {
        setPhase('choose');
        setError(t('review.photo'));
      }
    } catch (cause) {
      refused(cause);
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

  function perform(action: Action) {
    setReview((current) => (current ? act(current, action) : current));
  }

  async function use() {
    if (!review || !conversation || !saver.current || !id) return;
    setError(null);
    let next: Conversation;
    try {
      const fields = fieldsOf(review.items, {
        definition: conversation.state.draft.definition,
        retired: conversation.state.sidecar.retiredIds,
        locale: contentLocale,
      });
      next = importQuestions(conversation, fields);
    } catch (cause) {
      if (!(cause instanceof MachineError)) throw cause;
      setError(t('review.useFailed'));
      return;
    }
    setPhase('using');
    const current = saver.current;
    await current.save(next);
    await current.settled();
    if (current.status !== 'saved') {
      setPhase('review');
      setError(t('review.useFailed'));
      return;
    }
    setConversation(next);
    navigate(`/forms/${id}`);
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
      if (key.kind === 'undo') setReview(undo(review));
      else if (key.kind === 'move') {
        const next = review.items[Math.min(review.items.length - 1, Math.max(0, at + key.by))];
        if (next) setSelectedId(next.id);
      } else if (!item) return;
      else if (key.kind === 'chip') {
        const type = item.alternatives[key.index];
        if (type) perform({ kind: 'pick', itemId: item.id, type });
      } else if (key.kind === 'split') perform({ kind: 'split', itemId: item.id, at: 1 });
      else if (key.kind === 'merge') {
        perform({ kind: 'merge', itemId: item.id });
        const before = review.items[at - 1];
        if (before && !before.field && !item.field) setSelectedId(before.id);
      } else perform({ kind: key.kind, itemId: item.id });
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
        <h1>{t('conversation.doors.paper')}</h1>
        <p className="muted">{t('review.choose.explain')}</p>
        <div className="row">
          <label className="field">
            <span>{t('review.choose.file')}</span>
            <input
              type="file"
              accept={`application/pdf,${DOCX_TYPE},.docx`}
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
          {phase === 'reading' && <span className="muted">{t('paper.reading')}</span>}
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

      {tally.questions === 0 ? (
        <p className="status-warning">{t('review.empty')}</p>
      ) : (
        <div className="review__panes">
          <SourcePane
            layout={read.reading.layout}
            pdf={read.pdf}
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
          {!error && tally.needEye > 0 && <span>{t('review.useBlocked')}</span>}
          {!error && tally.needEye === 0 && tally.texts > 0 && tally.questions > 0 && (
            <span className="muted">{t('review.useTexts')}</span>
          )}
        </div>
        <div className="row">
          <button
            type="button"
            className="button"
            disabled={!ready || tally.questions === 0 || phase === 'using'}
            onClick={() => void use()}
          >
            {phase === 'using' ? t('review.using') : t('review.use', { count: tally.questions })}
          </button>
          <button
            type="button"
            className="button button--quiet"
            disabled={review.actions.length === 0 || phase === 'using'}
            aria-keyshortcuts="Control+Z Meta+Z"
            onClick={() => setReview(undo(review))}
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
              setPasting(false);
              setPasted('');
              setError(null);
              setPhase('choose');
            }}
          >
            {t('review.again')}
          </button>
          <Link className="button button--bare" to={editor}>
            {t('review.cancel')}
          </Link>
        </div>
      </footer>
    </section>
  );
}

const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
