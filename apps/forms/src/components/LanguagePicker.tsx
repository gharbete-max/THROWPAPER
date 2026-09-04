import { useEffect, useId, useRef, useState } from 'react';
import { localeLabel, type Translator } from '@tp/i18n';
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
 *
 * ## Why the translator is a prop
 *
 * It used to call `useT()`, which is bound to the *session's* interface language. On a public
 * form that is the wrong one: the page is rendered in the form's language, and the switcher
 * sitting in its corner would announce itself in whatever the visitor's browser had negotiated
 * for the app. One control labelled in two languages at once. The caller already has the right
 * translator, so it hands it over — and this component stops depending on there being a session
 * at all.
 */
export function LanguagePicker({
  locales,
  current,
  onChange,
  t,
  variant = 'bar',
}: {
  locales: readonly string[];
  current: string;
  onChange: (locale: string) => void;
  /** The caller's translator — see above. Never `useT()` from in here. */
  t: Translator;
  variant?: 'bar' | 'corner';
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(() => Math.max(0, locales.indexOf(current)));
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const listId = useId();
  const optionId = (index: number) => `${listId}-option-${index}`;

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

  /**
   * Keep the highlighted row on screen.
   *
   * The list is a scroller — twelve languages is taller than a phone, so `.langpicker__list` caps
   * its height. Without this, arrowing past the last visible row moves a highlight nobody can
   * see: the list sits still and the next Enter takes a language the reader was never shown.
   * `block: 'nearest'` scrolls only when the row is actually out of view, so the list does not
   * jump under a mouse user whose hover just moved the highlight.
   */
  useEffect(() => {
    if (!open) return;
    list.current?.querySelector(`#${CSS.escape(optionId(active))}`)?.scrollIntoView({
      block: 'nearest',
    });
  }, [open, active, listId]);

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
        /*
         * Focus never leaves this button, so the highlighted row has to be named here or a screen
         * reader is told nothing at all as the arrow keys move. This is the half of the listbox
         * pattern that makes the other half — a roving `active` index — audible.
         */
        aria-activedescendant={open ? optionId(active) : undefined}
        aria-label={`${t('app.language')}: ${localeLabel(current)}`}
        onClick={() => setOpen((was) => !was)}
      >
        <Flag locale={current} />
        {variant === 'bar' && <span className="langpicker__name">{localeLabel(current)}</span>}
        <Icon name="arrow-down" className="langpicker__chevron" />
      </button>

      {open && (
        <ul
          className="langpicker__list"
          role="listbox"
          id={listId}
          ref={list}
          aria-label={t('app.language')}
        >
          {/*
            `role="none"` on the item: a listbox owns options, and an `li`'s implicit `listitem`
            role sitting between the two breaks that relationship — some screen readers then stop
            reporting the set size, or stop exposing the rows as a choosable set at all.
          */}
          {locales.map((locale, index) => (
            <li key={locale} role="none">
              <button
                type="button"
                role="option"
                id={optionId(index)}
                /*
                 * Out of the tab order on purpose. These were focusable, and Tabbing to one then
                 * pressing Enter fired the wrapper's key handler, which chooses `locales[active]`
                 * — the *highlighted* row, not the focused one — while `preventDefault()`
                 * suppressed the button's own click. You pressed Enter on Svenska and got English.
                 * A listbox keeps focus on the trigger and moves `aria-activedescendant` instead.
                 */
                tabIndex={-1}
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
