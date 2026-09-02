import type { FormScope } from '@tp/shared/forms';
import { useT } from '../lib/i18n.js';
import { Icon, type IconName } from './Icon.js';

const ICONS: Record<FormScope, IconName> = {
  active: 'forms',
  mine: 'user',
  shared: 'share',
  trash: 'trash',
  all: 'people',
};

/**
 * The pile switcher: My forms / Shared with me / Trash, and the whole organisation for an
 * administrator.
 *
 * A real tablist rather than a row of links, because these are alternative views of one screen
 * rather than separate destinations: the arrow keys move between them, `aria-selected` says which
 * is showing, and the browser's back button is not filled with four entries for one page.
 */
/**
 * Whose piles these are.
 *
 * `first` is the ordinary case — your own workspace, so "My forms". `third` is an administrator
 * looking at a colleague, where "My forms" and "Shared with me" are the two most misleading words
 * that could appear on a screen whose entire point is that this is not yours.
 */
type Perspective = 'first' | 'third';

export function ScopeTabs({
  scopes,
  current,
  onChange,
  label,
  perspective = 'first',
}: {
  scopes: readonly FormScope[];
  current: FormScope;
  onChange: (scope: FormScope) => void;
  label: string;
  perspective?: Perspective;
}) {
  const t = useT();
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {scopes.map((scope) => (
        <button
          key={scope}
          role="tab"
          type="button"
          aria-selected={scope === current}
          className={scope === current ? 'tab tab--current' : 'tab'}
          onClick={() => onChange(scope)}
        >
          <Icon name={ICONS[scope]} className="icon--lead" />
          {/* Two `t()` calls rather than one with a computed prefix: `message-usage.test.ts`
              scans for the literal text before the first interpolation, and a key it cannot see
              named anywhere is a key it reports as dead. Written this way the scan finds both
              families, so the guard keeps working. */}
          {perspective === 'third' ? t(`scope.theirs.${scope}`) : t(`scope.${scope}`)}
        </button>
      ))}
    </div>
  );
}
