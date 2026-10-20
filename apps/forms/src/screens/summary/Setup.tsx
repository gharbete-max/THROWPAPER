import { useEffect, useState } from 'react';
import type { ModelBridge, ModelEvent, ModelProblem, ModelStatus } from '@tp/shared/summary';
import { useT } from '../../lib/i18n.js';
import { useConfirm } from '../../components/Confirm.js';
import { Icon } from '../../components/Icon.js';

const GB = 1000 ** 3;
const MB = 1000 ** 2;

/**
 * The settings step: get the model, open one from disk, or remove it (ADR 0023 section 6).
 *
 * Nothing here starts on its own. The download needs the person's button and then a confirmation
 * that says what it costs and that no document is sent (CLAUDE.md rule 7); "open from disk" asks
 * the computer's own file dialog. The numbers shown come from the shell's status, never from a
 * constant in the window.
 */
export function Setup({
  bridge,
  status,
  onStatus,
}: {
  bridge: ModelBridge;
  status: ModelStatus;
  onStatus: (status: ModelStatus) => void;
}) {
  const t = useT();
  const confirm = useConfirm();
  const [progress, setProgress] = useState<Extract<ModelEvent, { kind: 'install' }> | null>(null);
  const [problem, setProblem] = useState<ModelProblem | null>(null);
  const working = progress !== null || status.activity !== 'idle';

  useEffect(
    () =>
      bridge.onEvent((event) => {
        if (event.id !== 'install') return;
        if (event.kind === 'install') setProgress(event);
        if (event.kind === 'installed') {
          setProgress(null);
          setProblem(null);
          onStatus(event.status);
        }
        if (event.kind === 'install-failed') {
          setProgress(null);
          setProblem(event.problem);
          void bridge.status().then(onStatus);
        }
      }),
    [bridge, onStatus],
  );

  async function get() {
    const yes = await confirm(
      t('summary.getConfirm', {
        size: `${(status.bytes / GB).toFixed(1)} GB`,
        host: status.host ?? '',
      }),
      {
        confirmLabel: t('summary.getConfirmYes'),
        danger: false,
      },
    );
    if (!yes) return;
    setProblem(null);
    const result = await bridge.install();
    if (!result.ok) setProblem(result.problem);
  }

  async function open() {
    setProblem(null);
    const result = await bridge.openFromDisk();
    if (!result.ok && result.problem !== 'cancelled') setProblem(result.problem);
  }

  async function remove() {
    const yes = await confirm(t('summary.removeConfirm'), {
      confirmLabel: t('summary.removeConfirmYes'),
    });
    if (yes) onStatus(await bridge.remove());
  }

  const lowMemory = status.freeMemoryBytes < status.requiredMemoryBytes;
  const bar = progress ? { value: progress.done, max: progress.total } : null;
  const mb = (bytes: number) => String(Math.round(bytes / MB));

  return (
    <section className="card stack" aria-labelledby="summary-model">
      <h2 id="summary-model">{t('summary.modelHeading')}</h2>
      <p>{t('summary.modelWhat', { size: `${(status.bytes / GB).toFixed(1)} GB` })}</p>

      <p role="status">
        {status.damaged
          ? t('summary.problem.damaged')
          : status.installed
            ? t('summary.state.ready')
            : t('summary.problem.not-installed')}
      </p>
      {status.location ? (
        <p className="muted small">{t('summary.state.location', { path: status.location })}</p>
      ) : null}
      {lowMemory ? (
        <p className="status-down">
          {t('summary.memory.low', {
            free: (status.freeMemoryBytes / GB).toFixed(1),
            need: (status.requiredMemoryBytes / GB).toFixed(0),
          })}
        </p>
      ) : null}

      {progress && bar ? (
        <div className="stack">
          <progress
            value={bar.value}
            max={bar.max}
            aria-label={t(`summary.progress.${progress.phase}`, {
              part: progress.part ?? 1,
              parts: progress.parts ?? 1,
              done: mb(progress.done),
              total: mb(progress.total),
            })}
          />
          <p className="small" aria-live="polite">
            {t(`summary.progress.${progress.phase}`, {
              part: progress.part ?? 1,
              parts: progress.parts ?? 1,
              done: mb(progress.done),
              total: mb(progress.total),
            })}
          </p>
          <button
            type="button"
            className="button button--quiet"
            onClick={() => void bridge.cancel('install')}
          >
            {t('summary.cancel')}
          </button>
        </div>
      ) : null}

      {problem ? (
        <p className="status-down" role="alert">
          {t(`summary.problem.${problem}`)}
        </p>
      ) : null}

      <div className="row">
        <button
          type="button"
          className="button"
          disabled={working || status.downloadBlocked !== null}
          onClick={() => void get()}
        >
          <Icon name="download" /> {t('summary.get')}
        </button>
        <button
          type="button"
          className="button button--quiet"
          disabled={working}
          onClick={() => void open()}
        >
          <Icon name="upload" /> {t('summary.open')}
        </button>
        {status.installed ? (
          <button
            type="button"
            className="button button--quiet"
            disabled={working}
            onClick={() => void remove()}
          >
            <Icon name="trash" /> {t('summary.remove')}
          </button>
        ) : null}
      </div>
      {status.downloadBlocked !== null && !status.installed ? (
        <p className="muted small">{t('summary.getOff')}</p>
      ) : null}
    </section>
  );
}
