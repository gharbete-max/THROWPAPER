import { useEffect, useId, useRef, useState } from 'react';
import { localeLabel } from '@tp/i18n';
import { useT } from '../lib/i18n.js';
import { Flag } from './Flag.js';
import { Icon } from './Icon.js';

/**
 * Choosing a language, by flag.
 *
 * ## Why not a `<select>`
 *
 * This was a native `<select>` of locale codes. A `<select>` cannot contain an image — an
 * `<option>` renders text and nothing else, in every browser — so the moment the choice is a flag
 * the control has to be built. That is a real cost: a native select gets keyboard behaviour,
 * screen-reader announcement and the platform's own touch picker for free, and all of it has to
 * be put back by hand.
 *
 * So it is a proper listbox: `aria-expanded` on the button, `role="listbox"` and `role="option"`
 * on the list, arrow keys and Home/End to move, Enter or Space to choose, Escape to close, and
 * focus returned to the button afterwards. Clicking away closes it. The flag is decorative — the
 * accessible name of every row is the language's own name for itself.
 *
 * ## Two shapes, one control
 *
 * `variant="bar"` is the site's own language, in the top bar: flag plus endonym, because there
 * are twelve and a flag alone is a guess.
 *
 * `variant="corner"` is the switcher on a public form, where the reader is choosing between two
 * or three and space is tight. Flags only, with the name as the accessible label and the title —
 * which is why a flag is never the *only* thing carrying the meaning.
 */
export function LanguagePicker({
  locales,
  current,
  onChange,
  variant = 'bar',
}: {
  locales: readonly string[];
  current: string;
  onChange: (locale: string) => void;
  variant?: 'bar' | 'corner';
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(() => Math.max(0, locales.indexOf(current)));
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const listId = useId();

  // Clicking anywhere else closes it. `pointerdown` rather than `click` so it closes on the way
  // down, before the thing underneath reacts — otherwise the first tap outside is swallowed.
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);

  useEffect(() => {
    if (open) setActive(Math.max(0, locales.indexOf(current)));
  }, [open, locales, current]);

  function choose(locale: string) {
    onChange(locale);
    setOpen(false);
    button.current?.focus();
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'Escape') {
      setOpen(false);
      button.current?.focus();
      return;
    }
    if (!open && (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      setOpen(true);
      return;
    }
    if (!open) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((index) => (index + 1) % locales.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((index) => (index - 1 + locales.length) % locales.length);
    } else if (event.key === 'Home') {
      event.preventDefault();
      setActive(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      setActive(locales.length - 1);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const chosen = locales[active];
      if (chosen) choose(chosen);
    }
  }

  // Nothing to choose between. A picker with one option is a control that can only disappoint.
  if (locales.length < 2) return null;

  return (
    <div className={`langpicker langpicker--${variant}`} ref={root} onKeyDown={onKeyDown}>
      <button
        ref={button}
        type="button"
        className="langpicker__button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={`${t('app.language')}: ${localeLabel(current)}`}
        onClick={() => setOpen((was) => !was)}
      >
        <Flag locale={current} />
        {variant === 'bar' && <span className="langpicker__name">{localeLabel(current)}</span>}
        <Icon name="arrow-down" className="langpicker__chevron" />
      </button>

      {open && (
        <ul className="langpicker__list" role="listbox" id={listId} aria-label={t('app.language')}>
          {locales.map((locale, index) => (
            <li key={locale}>
              <button
                type="button"
                role="option"
                aria-selected={locale === current}
                className={index === active ? 'langpicker__option is-active' : 'langpicker__option'}
                // Hover moves the highlight, so the mouse and the keyboard agree about which row
                // Enter would take.
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(locale)}
              >
                <Flag locale={locale} />
                <span>{localeLabel(locale)}</span>
                {locale === current && <Icon name="check" className="langpicker__tick" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
