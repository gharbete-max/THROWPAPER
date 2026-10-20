import { lazy, Suspense, useState } from 'react';
import { aiBridge } from '../../lib/ai-bridge.js';
import { useT } from '../../lib/i18n.js';
import { Icon } from '../../components/Icon.js';
import type { EmailAbout } from '../../lib/email-about-handoff.js';

// The panel, the model's word lists and the bridge calls load only when somebody asks for help.
const ReplyPanel = lazy(() => import('./ReplyPanel.js'));

/**
 * The button under a message box that opens the reply helper (docs/plan/AI-SYSTEM.md D6), and
 * nothing at all where the desktop shell's bridge is absent: the hosted edition and a browser
 * never see it. `message` is what the box holds now, `onInsert` replaces it; the screen stays in
 * charge of sending, which this never does.
 */
export function ReplyHelp({
  message,
  onInsert,
  about = null,
}: {
  message: string;
  onInsert: (text: string) => void;
  /** Something a part handed over to write an email about (a summary, review comments): opens on it. */
  about?: EmailAbout | null;
}) {
  const t = useT();
  const bridge = aiBridge();
  const [open, setOpen] = useState(about !== null);
  if (!bridge) return null;
  return (
    <div className="stack stack--tight">
      <div className="row">
        <button
          type="button"
          className="button button--quiet"
          aria-expanded={open}
          aria-controls="reply-panel"
          onClick={() => setOpen((value) => !value)}
        >
          <Icon name="email" className="icon--lead" />
          {t('reply.open')}
        </button>
      </div>
      {open ? (
        <div id="reply-panel">
          <Suspense fallback={<p role="status">{t('summary.step.loading')}</p>}>
            <ReplyPanel bridge={bridge} message={message} onInsert={onInsert} about={about} />
          </Suspense>
        </div>
      ) : null}
    </div>
  );
}
