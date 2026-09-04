import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useT } from '../lib/i18n.js';
import { useSession } from '../lib/session.js';
import { Icon, type IconName } from './Icon.js';

/**
 * Go anywhere from anywhere.
 *
 * The work in this product is spread across eight screens, and every path between two of them
 * currently runs through the top bar. A palette is the one addition that makes a keyboard user
 * faster than a mouse user, which is the whole point of having one.
 *
 * ## Filtering is subsequence, not substring
 *
 * "fr" should find "Forms" and "rsp" should find "Responses". A substring match finds neither, and
 * an operator who tries a shorthand once and gets nothing does not try again.
 *
 * ## What it does not do
 *
 * No actions yet — only navigation. A palette that can delete a form is a palette that needs
 * confirmation flows and undo inside itself, and CLAUDE.md rule 7 means nothing here may send or
 * delete without a confirmation step. Navigation is safe by construction.
 */
interface Command {
  id: string;
  label: string;
  icon: IconName;
  to: string;
}

/** Whether every character of `query` appears in `text`, in order. Case- and accent-insensitive. */
export function matches(query: string, text: string): boolean {
  const needle = fold(query);
  if (!needle) return true;
  const haystack = fold(text);
  let at = 0;
  for (const character of needle) {
    at = haystack.indexOf(character, at);
    if (at === -1) return false;
    at += 1;
  }
  return true;
}

/**
 * Lowercased and stripped of diacritics.
 *
 * Twelve interface languages means the labels being searched are Swedish, Russian and Japanese as
 * often as English. Typing "sprak" has to find "Språk", or the palette is a feature for the
 * English build only.
 */
function fold(value: string): string {
  return value
    .toLocaleLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
}

export function CommandPalette() {
  const t = useT();
  const navigate = useNavigate();
  const { user } = useSession();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement | null>(null);
  /** What had focus before the palette opened, so closing it puts focus back. */
  const opener = useRef<Element | null>(null);

  const commands = useMemo<Command[]>(() => {
    const list: Command[] = [
      { id: 'events', label: t('nav.events'), icon: 'events', to: '/events' },
      { id: 'forms', label: t('nav.forms'), icon: 'forms', to: '/forms' },
      { id: 'inbox', label: t('nav.inbox'), icon: 'inbox', to: '/responses' },
      { id: 'brand', label: t('nav.brand'), icon: 'brand', to: '/brand' },
    ];
    // Same rule as the top bar: support work only appears for the people who do it.
    if (user?.role === 'admin') {
      list.push({ id: 'users', label: t('nav.users'), icon: 'people', to: '/users' });
    }
    return list;
  }, [t, user?.role]);

  const found = useMemo(
    () => commands.filter((command) => matches(query, command.label)),
    [commands, query],
  );

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      // metaKey for macOS, ctrlKey everywhere else — the same physical gesture on both.
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        opener.current = document.activeElement;
        setOpen((current) => !current);
        setQuery('');
        setActive(0);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (open) input.current?.focus();
    // Focus goes back where it came from, or a keyboard user is returned to the top of the page.
    else if (opener.current instanceof HTMLElement) opener.current.focus();
  }, [open]);

  if (!open) return null;

  function go(command: Command | undefined) {
    if (!command) return;
    setOpen(false);
    navigate(command.to);
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'Escape') return setOpen(false);
    if (event.key === 'Enter') {
      event.preventDefault();
      return go(found[active]);
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      // Wraps, so holding one arrow reaches everything without knowing which end you are at.
      setActive((current) => (found.length ? (current + step + found.length) % found.length : 0));
    }
  }

  return (
    <div
      className="palette__backdrop"
      // A click on the backdrop closes; a click inside must not, so this checks the target is the
      // backdrop itself rather than something that bubbled from within the dialog.
      onClick={(event) => event.target === event.currentTarget && setOpen(false)}
    >
      <div className="palette" role="dialog" aria-modal="true" aria-label={t('palette.title')}>
        <input
          ref={input}
          className="palette__input"
          value={query}
          placeholder={t('palette.placeholder')}
          aria-label={t('palette.title')}
          onChange={(event) => {
            setQuery(event.target.value);
            // The highlight goes back to the top on every keystroke, or Enter takes you somewhere
            // that was the fourth result for the previous query.
            setActive(0);
          }}
          onKeyDown={onKeyDown}
        />

        {found.length === 0 ? (
          <p className="palette__empty">{t('palette.empty')}</p>
        ) : (
          <ul className="palette__list">
            {found.map((command, index) => (
              <li key={command.id}>
                <button
                  type="button"
                  className={`palette__option${index === active ? ' palette__option--active' : ''}`}
                  onClick={() => go(command)}
                >
                  <Icon name={command.icon} />
                  {command.label}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
