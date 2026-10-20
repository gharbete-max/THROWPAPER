import { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import type { AiBridge, AiEvent, AiModelStatus, AiProblem, AiStatus } from '@tp/shared/ai';
import { aiBridge } from '../../lib/ai-bridge.js';
import { useT } from '../../lib/i18n.js';
import { useConfirm } from '../../components/Confirm.js';
import { Banner } from '../../components/Banner.js';
import { Icon } from '../../components/Icon.js';

const GB = 1000 ** 3;
const MB = 1000 ** 2;

// Only when this panel is shown: the list of models is its own chunk.
const ModelTiers = lazy(() => import('./ModelTiers.js'));

/**
 * Every AI model Loppa knows, on one list (ADR 0024): installed, missing, damaged, in use, or for
 * evaluation only; its size and licence; where each of its files was found; and the actions to
 * get it or to use a file already on the disk, with the exact folder to put files in by hand.
 *
 * What the list says comes from the shell's status and nothing in the window decides it. There is
 * one model (ADR 0025) and the program that runs it, listed under it. A model with no engine to run
 * it is "not available yet" and offers nothing; an evaluation-only model can be opened from disk and
 * is never offered for download.
 *
 * Nothing starts on its own. A download needs the button and then a confirmation that says what it
 * costs and that no document is sent (CLAUDE.md rule 7).
 */
export function ModelsPanel() {
  const bridge = aiBridge();
  return bridge ? <Models bridge={bridge} /> : null;
}

type Progress = Extract<AiEvent, { kind: 'install' }>;

function Models({ bridge }: { bridge: AiBridge }) {
  const t = useT();
  const confirm = useConfirm();
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [problem, setProblem] = useState<AiProblem | null>(null);

  const refresh = useCallback(() => void bridge.status().then(setStatus), [bridge]);
  useEffect(refresh, [refresh]);
  useEffect(
    () =>
      bridge.onEvent((event) => {
        if (!event.id.startsWith('install:')) return;
        if (event.kind === 'install') setProgress(event);
        if (event.kind === 'installed') {
          setProgress(null);
          setProblem(null);
          setStatus(event.status);
        }
        if (event.kind === 'install-failed') {
          setProgress(null);
          setProblem(event.problem);
          refresh();
        }
      }),
    [bridge, refresh],
  );

  if (!status) return null;
  const working = progress !== null || status.activity !== 'idle';

  async function get(model: AiModelStatus) {
    if (!model.consent) return;
    const yes = await confirm(
      t('ai.models.getConfirm', {
        name: model.name,
        host: model.consent.host,
        files: model.consent.files.join(', '),
        size: (model.consent.totalBytes / GB).toFixed(1),
      }),
      { confirmLabel: t('ai.models.getConfirmYes'), danger: false },
    );
    if (!yes) return;
    setProblem(null);
    const result = await bridge.install(model.id, model.consent);
    if (!result.ok) setProblem(result.problem);
  }

  async function open(model: AiModelStatus) {
    setProblem(null);
    const result = await bridge.openFromDisk(model.id);
    if (!result.ok && result.problem !== 'cancelled') setProblem(result.problem);
  }

  async function remove(model: AiModelStatus) {
    const yes = await confirm(t('ai.models.removeConfirm', { name: model.name }), {
      confirmLabel: t('ai.models.removeConfirmYes'),
    });
    if (yes) setStatus(await bridge.remove(model.id));
  }

  async function clear() {
    const yes = await confirm(t('ai.models.clearCacheConfirm'), {
      confirmLabel: t('ai.models.clearCacheYes'),
    });
    if (yes) setStatus(await bridge.clearCache());
  }

  const mb = (bytes: number) => String(Math.round(bytes / MB));
  // A problem with no sentence of its own is "something went wrong".
  const sentence = (p: AiProblem) =>
    t(`summary.problem.${p === 'not-available' || p === 'consent-required' ? 'failed' : p}`);
  // Speed and time left are the shell's own reckoning over the whole install.
  const progressText = (p: Progress) =>
    p.etaSeconds === null
      ? t('ai.models.progress', {
          file: p.file,
          files: p.files,
          done: mb(p.done),
          total: mb(p.total),
        })
      : t('ai.models.progressEta', {
          done: mb(p.modelDone),
          total: mb(p.modelTotal),
          speed: (p.bytesPerSecond / MB).toFixed(1),
          minutes: Math.max(1, Math.round(p.etaSeconds / 60)),
        });

  return (
    <section className="card stack" aria-labelledby="ai-models">
      <Banner name="streaks" className="banner--thin" />
      <h2 id="ai-models">{t('ai.models.heading')}</h2>
      <p className="muted small">{t('ai.models.intro')}</p>

      <Suspense fallback={null}>
        <ModelTiers
          status={status}
          bridge={bridge}
          working={working}
          onStatus={setStatus}
          onGet={(model) => void get(model)}
          onOpen={(model) => void open(model)}
          onRemove={(model) => void remove(model)}
        />
      </Suspense>

      {status.runtime ? (
        <p className="small" data-runtime>
          {status.runtime.path === null || status.runtime.source === null ? (
            t('ai.models.fileMissing', { name: status.runtime.name })
          ) : (
            <>
              {t('ai.models.file', {
                name: status.runtime.name,
                where: `${t(`ai.models.source.${status.runtime.source}`)}, ${t(`ai.models.hash.${status.runtime.hash === 'missing' ? 'unchecked' : status.runtime.hash}`)}`,
              })}
              <br />
              <code className="ai-path">{status.runtime.path}</code>
            </>
          )}
        </p>
      ) : null}

      {progress ? (
        <div className="stack">
          <progress
            value={progress.modelDone}
            max={progress.modelTotal}
            aria-label={progressText(progress)}
          />
          <p className="small" aria-live="polite">
            {progressText(progress)}
          </p>
          <button
            type="button"
            className="button button--quiet"
            onClick={() => void bridge.cancel(progress.id)}
          >
            {t('summary.cancel')}
          </button>
        </div>
      ) : null}
      {problem ? (
        <p className="status-down" role="alert">
          {sentence(problem)}
        </p>
      ) : null}

      <div className="row">
        <span className="muted small">
          {t('ai.models.cache', {
            count: status.cache.entries,
            size: mb(status.cache.bytes),
          })}
        </span>
        <button
          type="button"
          className="button button--quiet"
          disabled={working || status.cache.entries === 0}
          onClick={() => void clear()}
        >
          <Icon name="trash" /> {t('ai.models.clearCache')}
        </button>
      </div>
    </section>
  );
}
