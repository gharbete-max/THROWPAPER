import { useCallback, useEffect, useState } from 'react';
import type { AiBridge, AiEvent, AiModelStatus, AiProblem, AiStatus } from '@tp/shared/ai';
import { aiBridge } from '../../lib/ai-bridge.js';
import { useT } from '../../lib/i18n.js';
import { useConfirm } from '../../components/Confirm.js';
import { Icon } from '../../components/Icon.js';

const GB = 1000 ** 3;
const MB = 1000 ** 2;

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
    const yes = await confirm(
      t('ai.models.getConfirm', { name: model.name, size: (model.bytes / GB).toFixed(1) }),
      { confirmLabel: t('ai.models.getConfirmYes'), danger: false },
    );
    if (!yes) return;
    setProblem(null);
    const result = await bridge.install(model.id, true);
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

  return (
    <section className="card stack" aria-labelledby="ai-models">
      <h2 id="ai-models">{t('ai.models.heading')}</h2>
      <p className="muted small">{t('ai.models.intro')}</p>

      <ul className="stack" role="list">
        {status.models.map((model) => (
          <li key={model.id} className="stack" data-model={model.id}>
            <h3>
              {model.name}{' '}
              <span className={model.state === 'damaged' ? 'badge badge--warning' : 'badge'}>
                {t(`ai.models.state.${model.state}`)}
              </span>
              {!model.available ? (
                <span className="badge badge--quiet">{t('ai.models.unavailable')}</span>
              ) : null}
            </h3>
            <p className="muted small">
              {t('ai.models.size', { size: (model.bytes / GB).toFixed(1) })} ·{' '}
              {t('ai.models.licence', { licence: model.licence })}
              {model.resident ? ` · ${t('ai.models.loaded')}` : ''}
            </p>
            {!model.available ? (
              <p className="muted small">{t('ai.models.unavailableWhy')}</p>
            ) : null}
            {model.label === 'unverified-licence' ? (
              <p className="status-warning small">{t('ai.models.unverifiedLicence')}</p>
            ) : null}
            <ul className="small" role="list">
              {model.files.map((file) => (
                <li key={file.name}>
                  {file.path === null || file.source === null ? (
                    t('ai.models.fileMissing', { name: file.name })
                  ) : (
                    <>
                      {t('ai.models.file', {
                        name: file.name,
                        where: `${t(`ai.models.source.${file.source}`)}, ${t(`ai.models.hash.${file.hash === 'missing' ? 'unchecked' : file.hash}`)}`,
                      })}
                      <br />
                      <code className="ai-path">{file.path}</code>
                    </>
                  )}
                </li>
              ))}
            </ul>
            <p className="muted small">{t('ai.models.folder', { path: model.folder })}</p>
            {model.available ? <p className="muted small">{t('ai.models.needs')}</p> : null}

            {model.available ? (
              <div className="row">
                {model.available && !model.evaluationOnly ? (
                  <button
                    type="button"
                    className="button"
                    disabled={
                      working || model.downloadBlocked !== null || model.state === 'installed'
                    }
                    onClick={() => void get(model)}
                  >
                    <Icon name="download" /> {t('ai.models.get')}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="button"
                  disabled={working}
                  onClick={() => void open(model)}
                >
                  <Icon name="upload" /> {t('ai.models.open')}
                </button>
                {model.files.some((file) => file.path !== null) ? (
                  <button
                    type="button"
                    className="button button--quiet"
                    disabled={working}
                    onClick={() => void remove(model)}
                  >
                    <Icon name="trash" /> {t('ai.models.remove')}
                  </button>
                ) : null}
              </div>
            ) : null}
            {model.available &&
            !model.evaluationOnly &&
            model.downloadBlocked !== null &&
            model.state !== 'installed' ? (
              <p className="muted small">{t('ai.models.downloadOff')}</p>
            ) : null}
          </li>
        ))}
      </ul>

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
            value={progress.done}
            max={progress.total}
            aria-label={t('ai.models.progress', {
              file: progress.file,
              files: progress.files,
              done: mb(progress.done),
              total: mb(progress.total),
            })}
          />
          <p className="small" aria-live="polite">
            {t('ai.models.progress', {
              file: progress.file,
              files: progress.files,
              done: mb(progress.done),
              total: mb(progress.total),
            })}
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
