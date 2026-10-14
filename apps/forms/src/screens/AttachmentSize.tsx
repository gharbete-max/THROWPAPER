import { useState } from 'react';
import { client } from '../lib/api.js';
import { useT } from '../lib/i18n.js';
import {
  ATTACHMENT_WARN_BYTES,
  canShrink,
  formatMegabytes,
  isHeavy,
} from '../lib/attachment-size.js';

/**
 * On the confirmation: a large attachment is said so, with "Make smaller" for a PDF. The file is
 * written again on the server (leftovers dropped, objects packed) and the smaller one takes the
 * place of the original here; nothing is stored there and nothing is sent by this button.
 */
export function AttachmentSize({
  file,
  onReplace,
}: {
  file: File;
  onReplace: (file: File) => void;
}) {
  const t = useT();
  const [state, setState] = useState<
    | { kind: 'idle' }
    | { kind: 'working' }
    | { kind: 'done'; before: number }
    | { kind: 'none' }
    | { kind: 'failed' }
  >({ kind: 'idle' });

  async function shrink() {
    setState({ kind: 'working' });
    try {
      const smaller = await client.shrinkPdf(file);
      if (smaller.size < file.size) {
        onReplace(new File([smaller], file.name, { type: 'application/pdf' }));
        setState({ kind: 'done', before: file.size });
      } else setState({ kind: 'none' });
    } catch {
      setState({ kind: 'failed' });
    }
  }

  const heavy = isHeavy(file.size);
  if (!heavy && state.kind !== 'done') return null;

  return (
    <div className="stack stack--tight" data-testid="attachment-size">
      {heavy && (
        <p className="status-warning small" role="status">
          {t('attach.warn', {
            size: formatMegabytes(file.size),
            limit: formatMegabytes(ATTACHMENT_WARN_BYTES),
          })}
        </p>
      )}
      {state.kind === 'done' && (
        <p className="small" role="status" data-testid="attachment-shrunk">
          {t('attach.shrunk', {
            before: formatMegabytes(state.before),
            after: formatMegabytes(file.size),
          })}
        </p>
      )}
      {state.kind === 'none' && <p className="small">{t('attach.noGain')}</p>}
      {state.kind === 'failed' && (
        <p className="status-down small" role="alert">
          {t('attach.failed')}
        </p>
      )}
      {heavy && canShrink(file) && (
        <div className="row">
          <button
            type="button"
            className="button button--quiet"
            disabled={state.kind === 'working'}
            onClick={() => void shrink()}
          >
            {state.kind === 'working' ? t('attach.shrinking') : t('attach.shrink')}
          </button>
        </div>
      )}
    </div>
  );
}
