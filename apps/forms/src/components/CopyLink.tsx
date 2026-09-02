import { useEffect, useState } from 'react';
import { useT } from '../lib/i18n.js';
import { Icon } from './Icon.js';

/**
 * Copies a form's public address to the clipboard.
 *
 * Sharing a form is the point of building one, and the address was previously grey text you had to
 * select by hand. The button copies the **absolute** URL, because a path pasted into an email is
 * not a link anybody can follow.
 *
 * `navigator.clipboard` needs a secure context and can be refused outright, so a failure says so
 * rather than pretending: a button that reports success and copied nothing is worse than one that
 * admits it could not.
 */
export function CopyLink({ path }: { path: string }) {
  const t = useT();
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');

  // The confirmation is a moment, not a mode.
  useEffect(() => {
    if (state === 'idle') return;
    const timer = setTimeout(() => setState('idle'), 2000);
    return () => clearTimeout(timer);
  }, [state]);

  async function copy() {
    const absolute = new URL(path, window.location.origin).toString();
    try {
      await navigator.clipboard.writeText(absolute);
      setState('copied');
    } catch {
      setState('failed');
    }
  }

  return (
    <button
      type="button"
      className="button button--quiet small"
      onClick={copy}
      aria-label={t('forms.copyLink')}
    >
      <Icon name={state === 'copied' ? 'check' : 'copy'} className="icon--lead" />
      {state === 'copied'
        ? t('forms.copied')
        : state === 'failed'
          ? t('forms.copyFailed')
          : t('forms.copyLink')}
    </button>
  );
}
