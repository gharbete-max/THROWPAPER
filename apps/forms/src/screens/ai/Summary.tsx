import { useEffect, useMemo, useRef, useState } from 'react';
import { localeLabel } from '@tp/i18n';
import { mustQuote } from '@tp/shared/quoted';
import {
  PROOFREAD_LIMITS,
  SUMMARY_LOCALES,
  quote,
  splitPassages,
  summaryIn,
  translateInto,
  type JobWarning,
  type ModelBridge,
  type ModelStatus,
  type SummaryLocale,
} from '@tp/shared/summary';
import { Link, useLocation, useNavigate } from 'react-router';
import { summaryFileFromState, summaryTextFromState } from '../../lib/documents-handoff.js';
import { emailAboutWith } from '../../lib/email-about-handoff.js';
import { aiBridge } from '../../lib/ai-bridge.js';
import { ProofreadSection } from './proofread/ProofreadSection.js';
import { useSession } from '../../lib/session.js';
import { useT } from '../../lib/i18n.js';
import { useEdition } from '../../lib/edition.js';
import { modelBridge } from '../../lib/model-bridge.js';
import { Icon } from '../../components/Icon.js';
import { Loading } from '../../components/Loading.js';
import { FormSource } from './summary/FormSource.js';
import { Banner } from '../../components/Banner.js';
import { useJob } from './summary/job.js';
import { textOfFile } from './summary/text.js';

/**
 * Summary and translation: the centre of the Documents room (`docs/plan/DOCUMENTS.md` section 4,
 * ADR 0023).
 *
 * A draft, made by a model on this computer, shown beside the original and labelled as generated.
 * It is never stored, never written into a document, form, envelope or message, and never sent
 * anywhere: the text goes to this computer's shell over the desktop shell's bridge and the result comes
 * back the same way. The hosted edition has no bridge and says so.
 *
 * Contracts, consents, declarations and clinical forms are quoted, never reworded or translated.
 * Which texts those are is decided by a word list (`mustQuote`), never by the model; the model is
 * only asked for passage numbers, and the quotes below are cut from the original text here.
 */
export function Summary() {
  const t = useT();
  const edition = useEdition();
  const bridge = modelBridge();
  // A PDF handed over from Scan, read here like one chosen below.
  const state = useLocation().state;
  const handed = summaryFileFromState(state);
  // What the AI reader read, handed over as text.
  const handedText = summaryTextFromState(state);

  if (!bridge) {
    return (
      <section className="stack">
        <h1>{t('room.centre')}</h1>
        {edition === null ? (
          <Loading />
        ) : (
          <p>{edition === 'desktop' ? t('room.centreLater') : t('room.centreNone')}</p>
        )}
      </section>
    );
  }
  return <Centre bridge={bridge} handed={handed} handedText={handedText} />;
}

type SourceKind = 'paste' | 'file' | 'form' | 'answers';
type Task = 'summarise' | 'translate';

function Centre({
  bridge,
  handed,
  handedText,
}: {
  bridge: ModelBridge;
  handed: File | null;
  handedText: string | null;
}) {
  const t = useT();
  const [status, setStatus] = useState<ModelStatus | null>(null);
  // The handed-over document goes to the set-up page and back.
  const location = useLocation();

  useEffect(() => {
    void bridge.status().then(setStatus);
  }, [bridge]);

  if (!status) return <Loading />;
  const ready = status.installed && !status.damaged;

  return (
    <section className="stack">
      <Banner name="summary" />
      <h1>{t('room.centre')}</h1>
      <p>{t('summary.intro')}</p>
      <p role="status">
        {status.damaged
          ? t('summary.problem.damaged')
          : ready
            ? t('summary.state.ready')
            : t('summary.problem.not-installed')}{' '}
        <Link to="/ai-setup" state={location.state}>
          {t('ai.setup.title')}
        </Link>
      </p>
      {ready ? (
        <Work bridge={bridge} status={status} handed={handed} handedText={handedText} />
      ) : null}
    </section>
  );
}

function Work({
  bridge,
  status,
  handed,
  handedText,
}: {
  bridge: ModelBridge;
  status: ModelStatus;
  handed: File | null;
  handedText: string | null;
}) {
  const t = useT();
  const { locale } = useSession();
  const [kind, setKind] = useState<SourceKind>(handed ? 'file' : 'paste');
  const [text, setText] = useState(handedText ?? '');
  const [reading, setReading] = useState<{ done: number; total: number } | null>(null);
  const [fileProblem, setFileProblem] = useState(false);
  const [task, setTask] = useState<Task>('summarise');
  const [into, setInto] = useState<SummaryLocale>(
    (SUMMARY_LOCALES as readonly string[]).includes(locale) ? (locale as SummaryLocale) : 'en-GB',
  );
  const { state, start, cancel, reset } = useJob(bridge);
  const navigate = useNavigate();
  const picker = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);

  const quoteOnly = useMemo(() => text.trim() !== '' && mustQuote(text).quoteOnly, [text]);
  const passages = useMemo(() => (quoteOnly ? splitPassages(text) : []), [quoteOnly, text]);
  const running = state.phase === 'running';
  const refused = task === 'summarise' ? summaryIn(into) === 'no' : translateInto(into) === 'no';
  const lowMemory = status.freeMemoryBytes < status.requiredMemoryBytes;
  const canStart = text.trim() !== '' && !running && (quoteOnly || !refused) && !lowMemory;

  function setSource(next: SourceKind) {
    setKind(next);
    setText('');
    setFileProblem(false);
    reset();
  }

  async function chooseFile(file: File) {
    setFileProblem(false);
    reset();
    try {
      const read = await textOfFile(file, locale, (done, total) => setReading({ done, total }));
      setText(read);
      setFileProblem(read.trim() === '');
    } catch {
      setText('');
      setFileProblem(true);
    } finally {
      setReading(null);
    }
  }

  useEffect(() => {
    if (handed) void chooseFile(handed);
    // Once, for the file this opened with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function go() {
    setCopied(false);
    if (quoteOnly) {
      void start({
        kind: 'select',
        passages: passages.map((p) => text.slice(p.start, p.end)),
        language: null,
      });
    } else if (task === 'summarise') {
      void start({
        kind: 'summarise',
        text,
        into,
        shape: kind === 'form' || kind === 'answers' ? 'form' : 'document',
      });
    } else {
      void start({ kind: 'translate', text, into });
    }
  }

  async function copy() {
    const shown = state.selected ? quote(text, passages, state.selected).join('\n\n') : state.text;
    try {
      await navigator.clipboard.writeText(shown);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const stepText = state.step
    ? t(`summary.step.${state.step.step}`, { done: state.step.done + 1, total: state.step.total })
    : t('summary.step.loading');

  return (
    <div className="stack">
      <div className="card stack">
        <h2>{t('summary.source.heading')}</h2>
        <div className="row" role="radiogroup" aria-label={t('summary.source.heading')}>
          {(['paste', 'file', 'form', 'answers'] as const).map((value) => (
            <label key={value} className="field field--inline">
              <input
                type="radio"
                name="summary-source"
                checked={kind === value}
                disabled={running}
                onChange={() => setSource(value)}
              />
              {t(`summary.source.${value}`)}
            </label>
          ))}
        </div>

        {kind === 'paste' ? (
          <label className="field">
            {t('summary.paste.label')}
            <textarea
              rows={8}
              value={text}
              disabled={running}
              onChange={(event) => {
                setText(event.target.value);
                reset();
              }}
            />
          </label>
        ) : null}

        {kind === 'file' ? (
          <div className="stack">
            <input
              ref={picker}
              type="file"
              hidden
              data-testid="summary-file"
              accept="application/pdf,.pdf,text/plain,.txt,.md"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void chooseFile(file);
                event.target.value = '';
              }}
            />
            <div className="row">
              <button
                type="button"
                className="button"
                disabled={running || reading !== null}
                onClick={() => picker.current?.click()}
              >
                <Icon name="upload" /> {t('summary.file.choose')}
              </button>
              {reading ? (
                <span className="muted small" role="status">
                  {t('summary.file.reading', { done: reading.done + 1, total: reading.total })}
                </span>
              ) : null}
            </div>
            {fileProblem ? (
              <p className="status-down" role="alert">
                {t('summary.file.empty')}
              </p>
            ) : null}
          </div>
        ) : null}

        {kind === 'form' || kind === 'answers' ? (
          <FormSource key={kind} answers={kind === 'answers'} onText={setText} />
        ) : null}

        {text.trim() !== '' && kind !== 'paste' ? (
          <label className="field">
            {t('summary.original')}
            <textarea rows={6} readOnly value={text} />
          </label>
        ) : null}
      </div>

      <div className="card stack">
        <h2>{t('summary.task.heading')}</h2>
        {quoteOnly ? (
          <>
            <p role="note">{t('summary.quoteOnly.notice')}</p>
            <p className="muted small">{t('summary.quoteOnly.caveat')}</p>
          </>
        ) : (
          <>
            <div className="row" role="radiogroup" aria-label={t('summary.task.heading')}>
              {(['summarise', 'translate'] as const).map((value) => (
                <label key={value} className="field field--inline">
                  <input
                    type="radio"
                    name="summary-task"
                    checked={task === value}
                    disabled={running}
                    onChange={() => setTask(value)}
                  />
                  {t(`summary.task.${value}`)}
                </label>
              ))}
            </div>
            <label className="field">
              {t('summary.language')}
              <select
                value={into}
                disabled={running}
                onChange={(event) => setInto(event.target.value as SummaryLocale)}
              >
                {SUMMARY_LOCALES.map((code) => (
                  <option
                    key={code}
                    value={code}
                    disabled={
                      task === 'summarise' ? summaryIn(code) === 'no' : translateInto(code) === 'no'
                    }
                  >
                    {localeLabel(code)}
                  </option>
                ))}
              </select>
            </label>
            {into === 'is-IS' ? (
              <p className="muted small">
                {task === 'summarise' ? t('summary.is.summary') : t('summary.is.translate')}
              </p>
            ) : null}
            {into === 'ru-RU' && task === 'summarise' ? (
              <p className="muted small">{t('summary.ru.names')}</p>
            ) : null}
          </>
        )}
        <p className="muted small">{t('summary.expect')}</p>
        <div className="row">
          <button type="button" className="button" disabled={!canStart} onClick={go}>
            {quoteOnly ? t('summary.quoteOnly.run') : t('summary.start')}
          </button>
          {running ? (
            <button type="button" className="button button--quiet" onClick={cancel}>
              {t('summary.stop')}
            </button>
          ) : null}
        </div>
        {lowMemory ? (
          <p className="status-down" role="alert">
            {t('summary.memory.low', {
              free: (status.freeMemoryBytes / 1000 ** 3).toFixed(1),
              need: (status.requiredMemoryBytes / 1000 ** 3).toFixed(0),
            })}
          </p>
        ) : null}
      </div>

      {running ? (
        <p role="status" aria-live="polite">
          {stepText}
        </p>
      ) : null}
      {state.phase === 'failed' && state.problem ? (
        <p className="status-down" role="alert">
          {t(`summary.problem.${state.problem}`)}
        </p>
      ) : null}

      {state.phase !== 'idle' && (state.text !== '' || state.selected) ? (
        <section
          className="card stack"
          aria-labelledby="summary-result"
          data-testid="summary-result"
        >
          <h2 id="summary-result">
            {state.selected
              ? t('summary.result.passages')
              : task === 'translate'
                ? t('summary.result.translation')
                : t('summary.result.summary')}
          </h2>
          <p className="muted small">{t('summary.result.note')}</p>
          {state.selected ? (
            <ol className="stack">
              {quote(text, passages, state.selected).map((passage, index) => (
                <li key={state.selected![index]}>
                  <span className="muted small">
                    {t('summary.passage', { n: state.selected![index]! })}
                  </span>
                  <blockquote className="summary__text">{passage}</blockquote>
                </li>
              ))}
            </ol>
          ) : (
            <div className="summary__text" lang={into.slice(0, 2)}>
              {state.text}
            </div>
          )}
          {warnings(state.warnings, t)}
          {task === 'summarise' && !state.selected && text.length > 6000 ? (
            <p className="muted small">{t('summary.result.digest')}</p>
          ) : null}
          {state.seconds !== null ? (
            <p className="muted small">
              {t('summary.result.time', { seconds: Math.round(state.seconds) })}
            </p>
          ) : null}
          {state.phase === 'done' ? (
            <div className="row">
              <button type="button" className="button button--quiet" onClick={() => void copy()}>
                <Icon name="copy" /> {copied ? t('summary.copied') : t('summary.copy')}
              </button>
              {aiBridge() && !state.selected ? (
                <button
                  type="button"
                  className="button button--quiet"
                  data-testid="summary-email"
                  onClick={() =>
                    navigate(
                      ...emailAboutWith({
                        purpose: 'summary',
                        material: state.text,
                        quotes: [],
                        recipient: '',
                        overall: 'good',
                      }),
                    )
                  }
                >
                  <Icon name="email" /> {t('about.open')}
                </button>
              ) : null}
            </div>
          ) : null}
          {state.phase === 'done' && !state.selected ? (
            // The original is the source for the number check, when it is short enough to be one.
            <ProofreadSection
              text={state.text}
              source={text.length <= PROOFREAD_LIMITS.source ? text : ''}
            />
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function warnings(list: JobWarning[], t: ReturnType<typeof useT>) {
  return list.map((warning) => {
    // Only the reply helper's drafts and emails raise these; a summary never does.
    if (
      warning.kind === 'wrong-language' ||
      warning.kind === 'attachment-mentioned' ||
      warning.kind === 'spans-missing'
    ) {
      return null;
    }
    if (warning.kind === 'repetition') {
      return (
        <p key="repetition" className="status-down" role="alert">
          {t('summary.warn.repetition')}
        </p>
      );
    }
    return (
      <p key={warning.kind} className="status-down" role="alert">
        {t(warning.kind === 'numbers-added' ? 'summary.warn.added' : 'summary.warn.missing', {
          numbers: warning.numbers.join(', '),
        })}
      </p>
    );
  });
}
