import type { AiBridge, AiModelStatus, AiStatus } from '@tp/shared/ai';
import { Icon } from '../../components/Icon.js';
import { useT } from '../../lib/i18n.js';

const GB = 1000 ** 3;

interface Props {
  status: AiStatus;
  bridge: AiBridge;
  /** A download or a check is under way: nothing else is started. */
  working: boolean;
  onStatus(status: AiStatus): void;
  onGet(model: AiModelStatus): void;
  onOpen(model: AiModelStatus): void;
  onRemove(model: AiModelStatus): void;
}

/**
 * The models Loppa can use, best first, as one choice (ADR 0025): a radio for the model tasks go
 * to, enabled only for one that is installed, and for each its size, memory, licence, a plain
 * note on quality and the buttons to get, open from disk or remove it. "Recommended" is a hint
 * from the computer's memory; pressing nothing downloads nothing. AI is optional, and the first
 * thing on the list says so.
 */
export default function ModelTiers({
  status,
  bridge,
  working,
  onStatus,
  onGet,
  onOpen,
  onRemove,
}: Props) {
  const t = useT();
  const gb = (bytes: number) => (bytes / GB).toFixed(1);

  return (
    <fieldset className="stack" disabled={working}>
      <legend className="muted small">{t('ai.models.optional')}</legend>
      <ul className="stack" role="list">
        {status.models.map((model) => {
          const installed = model.state === 'installed' || model.state === 'busy';
          const broken = model.support.state === 'not-working-yet';
          return (
            <li key={model.id} className="stack" data-model={model.id}>
              <label className="row">
                <input
                  type="radio"
                  name="ai-model"
                  checked={model.selected}
                  disabled={!installed || broken}
                  onChange={() => void bridge.select(model.id).then(onStatus)}
                />
                <strong>{model.name}</strong>
                <span className="badge">{t(`ai.models.tier.${model.tier}`)}</span>
                {model.recommended ? (
                  <span className="badge badge--quiet">{t('ai.models.recommended')}</span>
                ) : null}
                <span className={model.state === 'damaged' ? 'badge badge--warning' : 'badge'}>
                  {t(`ai.models.state.${model.state}`)}
                </span>
                {model.selected && installed ? (
                  <span className="badge">{t('ai.models.chosen')}</span>
                ) : null}
              </label>
              <p className="muted small">{t(`ai.models.quality.${model.tier}`)}</p>
              <p className="muted small">
                {t('ai.models.size', { size: gb(model.bytes) })} ·{' '}
                {t(model.requiredMemoryVerified ? 'ai.models.ram' : 'ai.models.ramEstimate', {
                  size: gb(model.requiredMemoryBytes),
                })}{' '}
                · {t('ai.models.licence', { licence: model.licence })}
                {model.resident ? ` · ${t('ai.models.loaded')}` : ''}
              </p>
              {broken ? (
                <p className="status-warning small">{t('ai.models.notWorking')}</p>
              ) : model.support.state === 'untested' ? (
                <p className="muted small">{t('ai.models.untested')}</p>
              ) : null}
              <details className="small">
                <summary>{t('ai.models.evidence')}</summary>
                <p className="muted">{model.support.evidence}</p>
                <ul role="list">
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
              </details>
              {model.available ? (
                <div className="row">
                  {!model.evaluationOnly ? (
                    <button
                      type="button"
                      className="button"
                      disabled={working || model.downloadBlocked !== null || installed || broken}
                      onClick={() => onGet(model)}
                    >
                      <Icon name="download" /> {t('ai.models.get')}
                    </button>
                  ) : null}
                  {installed && !model.selected && !broken ? (
                    <button
                      type="button"
                      className="button"
                      onClick={() => void bridge.select(model.id).then(onStatus)}
                    >
                      {t('ai.models.use')}
                    </button>
                  ) : null}
                  <button type="button" className="button" onClick={() => onOpen(model)}>
                    <Icon name="upload" /> {t('ai.models.open')}
                  </button>
                  {model.files.some((file) => file.path !== null) ? (
                    <button
                      type="button"
                      className="button button--quiet"
                      onClick={() => onRemove(model)}
                    >
                      <Icon name="trash" /> {t('ai.models.remove')}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      {status.models[0] ? (
        <p className="muted small">{t('ai.models.folder', { path: status.models[0].folder })}</p>
      ) : null}
    </fieldset>
  );
}
