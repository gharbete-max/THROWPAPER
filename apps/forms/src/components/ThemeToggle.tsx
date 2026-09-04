import { useState } from 'react';
import { useT } from '../lib/i18n.js';
import { applyTheme, storedTheme, THEME_CHOICES, type ThemeChoice } from '../lib/theme.js';
import { Icon } from './Icon.js';

/**
 * Light, dark, or follow the machine.
 *
 * A segmented control rather than the usual sun/moon button. That button is a two-state toggle
 * wearing an icon, and it cannot say "follow my system" — so the third state either does not exist
 * or is hidden behind a long press nobody finds. Three segments say what the states are and which
 * one is on, in one glance, and it is the same control on a phone as on a laptop.
 *
 * State is read once at mount rather than held in a context: nothing else in the app needs to know
 * the theme, because the theme is an attribute on `<html>` and the CSS does the rest.
 */
export function ThemeToggle() {
  const t = useT();
  const [choice, setChoice] = useState<ThemeChoice>(storedTheme);

  function choose(next: ThemeChoice) {
    applyTheme(next);
    setChoice(next);
  }

  return (
    <div className="segmented" role="group" aria-label={t('appearance.label')}>
      {THEME_CHOICES.map((option) => (
        <button
          key={option}
          type="button"
          className={`segmented__option${option === choice ? ' segmented__option--on' : ''}`}
          // Pressed rather than a radio group: these act immediately and there is no form to submit.
          aria-pressed={option === choice}
          title={t(`appearance.${option}`)}
          onClick={() => choose(option)}
        >
          <Icon name={`theme-${option}`} />
          {/* The word is for a screen reader and for anyone who does not read the icon. */}
          <span className="visually-hidden">{t(`appearance.${option}`)}</span>
        </button>
      ))}
    </div>
  );
}
