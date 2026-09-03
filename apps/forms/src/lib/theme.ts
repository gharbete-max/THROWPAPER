/**
 * Light, dark, or whatever the machine says.
 *
 * ## Three states, not a boolean
 *
 * A toggle with two positions cannot express "follow my system", which is what most people
 * actually want and what every operating system now offers. Worse, a two-state toggle stored as
 * `dark: false` is indistinguishable from "never asked" — so a user whose laptop is in dark mode
 * gets a light app and no way to say "no, follow the system again".
 *
 * So the stored value is `system | light | dark`, and `system` is the default and is stored as the
 * *absence* of an attribute. `compile-web.ts` emits the matching selectors: the media query paints
 * dark unless `data-theme="light"` overrides it, and `data-theme="dark"` paints dark regardless.
 * That pair is what makes the choice work in both directions.
 *
 * ## Applied before React
 *
 * `apply()` is called from `main.tsx` at module scope, before the first render. Setting the
 * attribute inside a component means the page paints light, then flips — the flash of the wrong
 * theme that makes a dark mode feel bolted on.
 */
export type ThemeChoice = 'system' | 'light' | 'dark';

export const THEME_CHOICES: readonly ThemeChoice[] = ['system', 'light', 'dark'];

const KEY = 'tp.theme';

export function storedTheme(): ThemeChoice {
  try {
    const value = localStorage.getItem(KEY);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    // Private browsing, or storage switched off. A theme is not worth an exception.
    return 'system';
  }
}

export function applyTheme(choice: ThemeChoice): void {
  const root = document.documentElement;
  if (choice === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', choice);

  /**
   * `color-scheme` is what makes the *browser's* own furniture follow: scrollbars, the caret, a
   * date picker's calendar, the spinner on a number input. Without it a dark page keeps a white
   * dropdown and a bright scrollbar, which is the single clearest sign of a dark mode that was
   * painted rather than declared.
   */
  root.style.colorScheme = choice === 'system' ? 'light dark' : choice;

  try {
    if (choice === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch {
    // Nothing to do: the choice still applies to this page, it just will not be remembered.
  }
}

/** Called once from `main.tsx`, before React renders anything. */
export function initTheme(): ThemeChoice {
  const choice = storedTheme();
  applyTheme(choice);
  return choice;
}
