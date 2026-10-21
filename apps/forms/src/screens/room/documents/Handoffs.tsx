import { useT } from '../../../lib/i18n.js';
import { Icon } from '../../../components/Icon.js';

/**
 * The hand-offs a finished scan or PDF adds to Sign and Send: Summarise (only where this edition
 * has the summary model) and Fill in (only for a PDF that has fields of its own). A hand-off that
 * is not available is not drawn, rather than drawn and refused.
 */
export function Handoffs({
  busy,
  onSummarise,
  onFill,
}: {
  busy: boolean;
  onSummarise: (() => void) | null;
  onFill: (() => void) | null;
}) {
  const t = useT();
  return (
    <>
      {onSummarise ? (
        <button
          type="button"
          className="button button--quiet"
          disabled={busy}
          data-testid="handoff-summarise"
          onClick={onSummarise}
        >
          <Icon name="long_text" /> {t('docs.summarise')}
        </button>
      ) : null}
      {onFill ? (
        <button
          type="button"
          className="button button--quiet"
          disabled={busy}
          data-testid="handoff-fill"
          onClick={onFill}
        >
          <Icon name="forms" /> {t('docs.fill')}
        </button>
      ) : null}
    </>
  );
}
