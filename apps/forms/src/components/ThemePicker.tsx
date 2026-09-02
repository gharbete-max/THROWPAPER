import { THEME_PRESETS, type TokenSet } from '@tp/tokens';
import { useT } from '../lib/i18n.js';

/**
 * A gallery of ready-made looks.
 *
 * The brand editor used to open on eleven colour pickers and three sliders. That is a design
 * brief, not a setting: what actually happens is somebody changes the primary colour, leaves the
 * rest, and ends up with the shipped theme wearing one unfamiliar blue. Starting from a whole
 * coherent look and adjusting it is the way every tool in this market works, and it is the way
 * that produces a form somebody would be happy to send out.
 *
 * ## Why the swatch is a miniature form
 *
 * A row of colour circles always looks fine — that is what colour circles do. The question being
 * asked is "would I send this to four hundred people", and only something shaped like the form
 * answers it. Each card is a label, an input and a button, drawn with that theme's own tokens.
 *
 * Applying a preset replaces the **whole** token set except the logo, which belongs to the
 * organisation rather than to a theme. Merging instead would leave a warm palette with one cold
 * border in it and no way to tell where that border came from.
 */
export function ThemePicker({
  current,
  disabled,
  onApply,
}: {
  current: TokenSet;
  disabled?: boolean;
  onApply: (tokens: TokenSet) => void;
}) {
  const t = useT();

  /**
   * Which theme is showing, if any.
   *
   * Compared on the values that define a look rather than on the whole object: keeping a logo, or
   * nudging one slider, should not make the gallery claim nothing is selected.
   */
  const selected = THEME_PRESETS.find(
    (theme) =>
      JSON.stringify(theme.tokens.colour) === JSON.stringify(current.colour) &&
      theme.tokens.radius === current.radius &&
      theme.tokens.buttonStyle === current.buttonStyle,
  )?.id;

  return (
    <div className="stack">
      <h2 className="small">{t('brand.themes')}</h2>
      <p className="small muted">{t('brand.themesHint')}</p>

      <div className="themes">
        {THEME_PRESETS.map((theme) => (
          <button
            key={theme.id}
            type="button"
            disabled={disabled}
            className={theme.id === selected ? 'theme theme--current' : 'theme'}
            // The name is on the card, so this only has to say what pressing it does.
            aria-pressed={theme.id === selected}
            onClick={() =>
              onApply({
                ...theme.tokens,
                // The organisation's marks survive a change of theme.
                logoLight: current.logoLight,
                logoDark: current.logoDark,
                favicon: current.favicon,
              })
            }
          >
            <span
              className="theme__sample"
              style={{
                background: theme.tokens.colour.background,
                borderColor: theme.tokens.colour.border,
                borderRadius: theme.tokens.radius,
              }}
            >
              <span className="theme__label" style={{ color: theme.tokens.colour.text }}>
                {t('brand.themeSampleLabel')}
              </span>
              <span
                className="theme__input"
                style={{
                  background: theme.tokens.colour.surface,
                  borderColor: theme.tokens.colour.border,
                  borderRadius: theme.tokens.radius,
                }}
              />
              <span
                className="theme__button"
                style={{
                  background:
                    theme.tokens.buttonStyle === 'solid'
                      ? theme.tokens.colour.primary
                      : theme.tokens.colour.background,
                  color:
                    theme.tokens.buttonStyle === 'solid'
                      ? theme.tokens.colour.background
                      : theme.tokens.colour.primary,
                  borderColor: theme.tokens.colour.primary,
                  borderRadius: theme.tokens.radius,
                }}
              >
                {t('brand.themeSampleButton')}
              </span>
            </span>

            <span className="small">{t(`theme.${theme.id}`)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
