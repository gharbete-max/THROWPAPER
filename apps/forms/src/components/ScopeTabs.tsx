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
export function ScopeTabs({
  scopes,
  current,
  onChange,
  label,
}: {
  scopes: readonly FormScope[];
  current: FormScope;
  onChange: (scope: FormScope) => void;
  label: string;
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
          {t(`scope.${scope}`)}
        </button>
      ))}
    </div>
  );
}
