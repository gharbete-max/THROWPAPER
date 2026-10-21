import type { AiGraphics } from '@tp/shared/ai';
import { useT } from '../../../lib/i18n.js';

interface Props {
  graphics: AiGraphics;
  /** A download or a check is under way. */
  working: boolean;
  onToggle(on: boolean): void;
  onClear(): void;
}

/**
 * "Use the graphics card (faster, optional)" (ADR 0025, docs/plan/VISION-TUNING.md §5): off until
 * the person turns it on. Turning it on without the program asks first (the panel's confirmation);
 * a card that failed is said so plainly, the processor is used meanwhile, and one button tries the
 * card again. Where no such build exists the setting is not shown; on macOS it says "not yet".
 */
export default function GraphicsSetting({ graphics, working, onToggle, onClear }: Props) {
  const t = useT();
  if (graphics.support === 'none') return null;
  const later = graphics.support === 'later';
  return (
    <div className="stack graphics" data-graphics>
      <label className="model__head">
        <input
          type="checkbox"
          checked={graphics.enabled}
          disabled={working || later}
          aria-describedby="ai-graphics-note"
          onChange={(event) => onToggle(event.target.checked)}
        />
        <strong>{t('ai.graphics.label')}</strong>
      </label>
      <p id="ai-graphics-note" className="muted small">
        {t(later ? 'ai.graphics.later' : 'ai.graphics.note')}
        {!later && !graphics.present
          ? ` ${t('ai.graphics.missing', { folder: graphics.folder })}`
          : ''}
      </p>
      {graphics.failure ? (
        <p className="status-warning small" role="status">
          {t('ai.graphics.failure')}{' '}
          <button type="button" className="button button--quiet" onClick={onClear}>
            {t('ai.graphics.tryAgain')}
          </button>
        </p>
      ) : null}
      {graphics.ranOn ? (
        <p className="muted small" aria-live="polite">
          {graphics.ranOn === 'graphics' && graphics.device
            ? t('ai.graphics.on.device', { device: graphics.device })
            : t(`ai.graphics.on.${graphics.ranOn}`)}
        </p>
      ) : null}
    </div>
  );
}
