import { lazy, Suspense, useState } from 'react';
import type { PageRange } from '@tp/shared/summary';
import { Icon } from '../../../components/Icon.js';
import { aiBridge } from '../../../lib/ai-bridge.js';
import { useT } from '../../../lib/i18n.js';

// The panel and the bridge calls load only when somebody asks to proofread.
const ProofreadPanel = lazy(() => import('./ProofreadPanel.js'));

/**
 * The "Proofread" button under a text (a summary, or what the AI reader read) and the panel it
 * opens. Nothing at all where the desktop shell's bridge is absent, as with the reply helper.
 */
export function ProofreadSection({
  text,
  source = '',
  pages = [],
}: {
  text: string;
  source?: string;
  pages?: PageRange[];
}) {
  const t = useT();
  const bridge = aiBridge();
  const [open, setOpen] = useState(false);
  if (!bridge || text.trim() === '') return null;
  return (
    <div className="stack stack--tight">
      <div className="row">
        <button
          type="button"
          className="button button--quiet"
          aria-expanded={open}
          aria-controls="proofread-region"
          onClick={() => setOpen((value) => !value)}
        >
          <Icon name="edit" /> {t('proof.open')}
        </button>
      </div>
      {open ? (
        <div id="proofread-region">
          <Suspense fallback={<p role="status">{t('summary.step.loading')}</p>}>
            <ProofreadPanel bridge={bridge} text={text} source={source} pages={pages} />
          </Suspense>
        </div>
      ) : null}
    </div>
  );
}
