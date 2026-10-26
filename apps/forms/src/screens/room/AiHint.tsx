import { useState } from 'react';
import { Link } from 'react-router';
import { Icon } from '../../components/Icon.js';
import { useT } from '../../lib/i18n.js';

const DISMISSED = 'loppa.addonsHint.dismissed';

/**
 * One quiet line in the room of the desktop app: AI is optional, and where to set it up when you
 * want to. Not a modal, not a banner that returns: the person hides it once and it stays hidden on
 * this computer (a per-viewer convenience, kept in local storage, which may be missing or refuse
 * to answer, so every access is guarded and the line simply shows again).
 */
export function AiHint() {
  const t = useT();
  const [hidden, setHidden] = useState(() => {
    try {
      return window.localStorage.getItem(DISMISSED) === '1';
    } catch {
      return false;
    }
  });
  if (hidden) return null;
  return (
    <p className="room__hint small" data-ai-hint>
      <span>{t('addons.hint')}</span>
      <Link to="/ai-setup">{t('addons.title')}</Link>
      <button
        type="button"
        className="button button--quiet small"
        aria-label={t('addons.hint.dismiss')}
        onClick={() => {
          setHidden(true);
          try {
            window.localStorage.setItem(DISMISSED, '1');
          } catch {
            /* hidden for this visit only */
          }
        }}
      >
        <Icon name="close" />
      </button>
    </p>
  );
}
