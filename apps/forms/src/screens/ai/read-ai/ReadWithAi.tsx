import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import {
  PIXEL_BUDGET,
  assembleDocument,
  documentText,
  type AiStatus,
  type Block,
  type ReadQuality,
  type StructuredPage,
} from '@tp/shared/ai';
import { PROOFREAD_LIMITS } from '@tp/shared/summary';
import { Icon } from '../../../components/Icon.js';
import { aiBridge } from '../../../lib/ai-bridge.js';
import { summaryWithText } from '../../../lib/documents-handoff.js';
import { emailAboutWith } from '../../../lib/email-about-handoff.js';
import { useT } from '../../../lib/i18n.js';
import { ProofreadSection } from '../proofread/ProofreadSection.js';
import type { ScanPage } from '../../scan/scan-plan.js';
import { readPages, type ReadablePage } from './read-document.js';
import { readablePages, type ScanSource } from './pictures.js';

/**
 * "Read with AI" on the pages Scan holds (docs/plan/AI-SYSTEM.md D4): the model on this computer
 * reads each page from a picture of it, one page at a time, and the result is a structured document
 * shown beside the original, labelled as generated. The deterministic readers (the import, the
 * digital copy, the invoice scan) are untouched and stay the way to work offline; this is the
 * optional one. The original pages are never changed, and nothing is stored: closing this forgets
 * the reading (the shell keeps a cache of read pages, which Settings can empty).
 *
 * A page the readers disagree on is marked "check this page" and can be read again at a higher
 * resolution on its own; a page that failed is listed, never left out.
 */
const REASONS = ['mismatch', 'cut-off', 'repetition', 'unreadable-output', 'not-read'] as const;
type Phase = 'waiting' | 'reading' | 'done';

/** Why the model cannot be used right now, in a sentence; null when it can. */
function blocker(status: AiStatus | null): 'model' | 'runtime' | 'memory' | null {
  if (!status) return null;
  const model = status.models.find((m) => m.capabilities.includes('vision') && m.available);
  if (!model || model.state === 'missing' || model.state === 'damaged') return 'model';
  if (status.runtime?.hash === 'missing' || status.runtime?.hash === 'damaged') return 'runtime';
  return !model.resident && status.freeMemoryBytes < model.requiredMemoryBytes ? 'memory' : null;
}

export default function ReadWithAi({
  files: filesNow,
  sources: sourcesNow,
  pages: pagesNow,
  onClose,
}: {
  files: readonly File[];
  sources: readonly ScanSource[];
  pages: readonly ScanPage[];
  onClose: () => void;
}) {
  // The pages as they were when the person asked: reordering them in Scan afterwards must not
  // restart a reading that is under way.
  const { files, sources, pages } = useRef({
    files: filesNow,
    sources: sourcesNow,
    pages: pagesNow,
  }).current;
  const t = useT();
  const navigate = useNavigate();
  const bridge = aiBridge()!;
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [readable, setReadable] = useState<ReadablePage[] | null>(null);
  const [phases, setPhases] = useState<Phase[]>(() => pages.map(() => 'waiting'));
  const [results, setResults] = useState<ReadonlyMap<number, StructuredPage>>(new Map());
  const [running, setRunning] = useState(false);
  const [stopped, setStopped] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    let alive = true;
    void bridge.status().then((next) => alive && setStatus(next));
    void readablePages(files, sources, pages).then((next) => alive && setReadable(next));
    return () => {
      alive = false;
      abort.current?.abort();
    };
  }, [bridge, files, sources, pages]);

  const run = useCallback(
    async (indexes: number[], quality: ReadQuality) => {
      if (!readable) return;
      abort.current = new AbortController();
      setRunning(true);
      setStopped(null);
      const outcome = await readPages({
        bridge,
        pages: readable,
        indexes,
        quality,
        signal: abort.current.signal,
        onPage: (index, state, page) => {
          setPhases((current) => current.map((p, i) => (i === index ? state : p)));
          if (page) setResults((current) => new Map(current).set(index + 1, page));
        },
      });
      // Pages not reached go back to waiting.
      setPhases((current) => current.map((p) => (p === 'reading' ? 'waiting' : p)));
      setStopped(outcome.stopped === 'cancelled' ? null : outcome.stopped);
      setRunning(false);
    },
    [bridge, readable],
  );

  const doc = useMemo(
    () =>
      readable && results.size > 0
        ? assembleDocument(readable[0]!.fileSha256, pages.length, results)
        : null,
    [readable, results, pages.length],
  );
  const plain = useMemo(() => (doc ? documentText(doc) : null), [doc]);
  const headed = useMemo(
    () => (doc ? documentText(doc, (n) => t('scan.page', { n })).text : ''),
    [doc, t],
  );
  const counts = useMemo(() => {
    const all = [...results.values()];
    return {
      ok: all.filter((p) => p.status === 'ok').length,
      uncertain: all.filter((p) => p.status === 'uncertain').length,
      failed: all.filter((p) => p.status === 'failed').length,
    };
  }, [results]);

  const blocked = blocker(status);
  const finished = !running && results.size > 0;
  const text = plain?.text ?? '';
  const tooLong = text.length > PROOFREAD_LIMITS.material;
  const gb = (bytes: number) => (bytes / 1000 ** 3).toFixed(1);
  const model = status?.models.find((m) => m.capabilities.includes('vision') && m.available);

  async function copy() {
    try {
      await navigator.clipboard.writeText(headed);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const reasonText = (page: StructuredPage) =>
    page.reason === null
      ? ''
      : (REASONS as readonly string[]).includes(page.reason)
        ? t(`read.reason.${page.reason as (typeof REASONS)[number]}`)
        : t(`summary.problem.${page.reason}`);

  return (
    <section className="card stack" aria-labelledby="read-heading" data-testid="read-ai">
      <div className="row">
        <h2 id="read-heading">{t('read.heading')}</h2>
        <button type="button" className="button button--quiet" onClick={onClose}>
          {t('read.close')}
        </button>
      </div>
      <p className="muted small">{t('read.privacy')}</p>

      {blocked === 'model' ? (
        <p role="alert" data-testid="read-no-model">
          {t('read.noModel')} <Link to="/ai-setup">{t('read.noModelLink')}</Link>
        </p>
      ) : null}
      {blocked === 'runtime' ? (
        <p role="alert">
          {t('read.noRuntime')} <Link to="/ai-setup">{t('read.noModelLink')}</Link>
        </p>
      ) : null}
      {blocked === 'memory' && status && model ? (
        <p className="status-down" role="alert">
          {t('read.lowMemory', {
            free: gb(status.freeMemoryBytes),
            need: gb(model.requiredMemoryBytes),
          })}
        </p>
      ) : null}
      {stopped ? (
        <p className="status-down" role="alert">
          {t(
            `summary.problem.${stopped === 'not-available' || stopped === 'consent-required' ? 'failed' : stopped}`,
          )}
        </p>
      ) : null}

      <p className="muted small">{t('read.expect')}</p>
      <div className="row">
        <button
          type="button"
          className="button"
          disabled={running || !readable || status === null || blocked !== null}
          onClick={() =>
            void run(
              pages.map((_, i) => i),
              'normal',
            )
          }
        >
          <Icon name="preview" /> {t('read.start')}
        </button>
        {running ? (
          <button
            type="button"
            className="button button--quiet"
            onClick={() => abort.current?.abort()}
          >
            {t('summary.stop')}
          </button>
        ) : null}
      </div>

      <p
        role="status"
        aria-live="polite"
        className={running || finished ? 'small' : 'visually-hidden'}
      >
        {running
          ? t('read.progress', {
              done: phases.filter((p) => p === 'done').length + 1,
              total: pages.length,
            })
          : finished
            ? t('read.done', counts)
            : ''}
      </p>

      <ol className="read__pages" aria-label={t('read.result.heading')}>
        {pages.map((page, index) => {
          const result = results.get(index + 1);
          return (
            <li key={page.id} className="read__page" data-testid="read-page">
              <div className="row">
                <strong>{t('scan.page', { n: index + 1 })}</strong>
                <span className={result?.status === 'ok' ? 'small' : 'small status-down'}>
                  {result ? t(`read.status.${result.status}`) : t(`read.status.${phases[index]!}`)}
                </span>
              </div>
              {result && result.status !== 'ok' ? (
                <p className="small">{reasonText(result)}</p>
              ) : null}
              {result ? <Blocks blocks={result.blocks} /> : null}
              {!result && phases[index] === 'reading' ? (
                <div className="skeleton" data-testid="read-skeleton">
                  <span className="skeleton__line" aria-hidden="true" />
                  <span className="skeleton__line" aria-hidden="true" />
                  <span className="skeleton__line" aria-hidden="true" />
                  <span className="skeleton__line skeleton__line--short" aria-hidden="true" />
                  <p className="small muted">{t('read.slow')}</p>
                </div>
              ) : null}
              {result && result.status !== 'ok' && !running ? (
                <div className="row">
                  <button
                    type="button"
                    className="button button--quiet"
                    title={`${PIXEL_BUDGET.high / 1e6} MP`}
                    onClick={() => void run([index], 'high')}
                  >
                    {t('read.again')}
                  </button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>

      {finished ? (
        <div className="stack stack--tight">
          <p className="muted small">{t('read.result.label')}</p>
          <div className="row">
            <button
              type="button"
              className="button"
              onClick={() => navigate(...summaryWithText(headed))}
            >
              <Icon name="long_text" /> {t('read.summarise')}
            </button>
            <button
              type="button"
              className="button button--quiet"
              disabled={tooLong || text.trim() === ''}
              onClick={() =>
                navigate(
                  ...emailAboutWith({
                    purpose: 'summary',
                    material: headed,
                    quotes: [],
                    recipient: '',
                    overall: 'good',
                  }),
                )
              }
            >
              <Icon name="email" /> {t('about.open')}
            </button>
            <button type="button" className="button button--quiet" onClick={() => void copy()}>
              <Icon name="copy" /> {copied ? t('summary.copied') : t('summary.copy')}
            </button>
          </div>
          {tooLong ? <p className="status-down">{t('summary.problem.too-long')}</p> : null}
          <ProofreadSection text={text} pages={plain?.pages ?? []} />
        </div>
      ) : null}
    </section>
  );
}

/** What was read on a page, in reading order: plain, so it can be checked against the original. */
function Blocks({ blocks }: { blocks: readonly Block[] }) {
  const t = useT();
  return (
    <div className="stack stack--tight">
      {blocks.map((block, i) => {
        switch (block.type) {
          case 'heading':
            return (
              <p key={i}>
                <strong>{block.text}</strong>
              </p>
            );
          case 'paragraph':
            return (
              <p key={i} className="summary__text">
                {block.text}
              </p>
            );
          case 'field':
            return (
              <p key={i} className="summary__text">
                <span className="muted">{block.label}</span> {block.value}
              </p>
            );
          case 'checkbox':
            return (
              <p key={i}>
                {block.label}{' '}
                <span className="muted small">
                  ({t(block.checked ? 'read.checked.yes' : 'read.checked.no')})
                </span>
              </p>
            );
          case 'figure':
            return (
              <p key={i} className="muted small">
                {t('read.figure')}
                {block.caption ? `: ${block.caption}` : ''}
              </p>
            );
          case 'table': {
            const grid: string[][] = Array.from({ length: block.rows }, () =>
              Array.from({ length: block.columns }, () => ''),
            );
            for (const cell of block.cells) grid[cell.row]![cell.column] = cell.text;
            return (
              <table key={i} className="table">
                <tbody>
                  {grid.map((row, r) => (
                    <tr key={r}>
                      {row.map((cell, c) => (
                        <td key={c}>{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            );
          }
        }
      })}
    </div>
  );
}
