import { DECORATION_TOKENS, type DecorationColour } from '@tp/shared/forms';
import { useT } from '../lib/i18n.js';

/**
 * Picking a colour for a decoration: brand tokens first, a literal second.
 *
 * The order is the argument. Every swatch on the left is a *name* — "primary", "border" — so a
 * form built by clicking through this one follows the brand kit, and an organisation that
 * restyles itself restyles its forms with it. The colour well on the right is the deliberate
 * opt-out: it produces a hex literal, which is frozen at the moment it was chosen and will not
 * follow anything.
 *
 * `none` is offered only where the absence of a colour is meaningful — an unfilled shape — which
 * is why it is a prop rather than always present. A drawing with no stroke colour is invisible,
 * and offering that would be offering a way to lose work.
 */
export function ColourChoice({
  label,
  value,
  allowNone,
  onChange,
}: {
  label: string;
  value: DecorationColour;
  allowNone?: boolean;
  onChange: (value: DecorationColour) => void;
}) {
  const t = useT();
  const tokens = DECORATION_TOKENS.filter((token) => allowNone || token !== 'none');
  const custom = value.startsWith('#');

  return (
    <div className="field">
      <span>{label}</span>
      <div className="swatches" role="group" aria-label={label}>
        {tokens.map((token) => (
          <button
            key={token}
            type="button"
            className={`swatch${value === token ? ' swatch--on' : ''}${
              token === 'none' ? ' swatch--none' : ''
            }`}
            /**
             * `aria-pressed` rather than a radio group.
             *
             * These are buttons that change the thing beside them immediately, with no submit
             * step, and a radio group would promise a form field that does not exist. Pressed
             * state is what a screen reader needs to know which colour is on.
             */
            aria-pressed={value === token}
            // The name is the accessible label; the colour is decoration on a control, so the
            // swatch itself carries no text and the title repeats the name for a mouse.
            title={token === 'none' ? t('field.colour.none') : t(`brand.colour.${token}`)}
            aria-label={token === 'none' ? t('field.colour.none') : t(`brand.colour.${token}`)}
            style={token === 'none' ? undefined : { background: `var(--tp-colour-${token})` }}
            onClick={() => onChange(token)}
          />
        ))}

        {/*
          A native colour well, because every platform already has a good one and a hand-built
          picker would be worse on a phone than the operating system's own.
        */}
        <label className={`swatch swatch--custom${custom ? ' swatch--on' : ''}`}>
          <span className="visually-hidden">{t('field.colour.custom')}</span>
          <input
            type="color"
            value={custom ? value.slice(0, 7) : '#000000'}
            onChange={(event) => onChange(event.target.value as DecorationColour)}
          />
        </label>
      </div>
    </div>
  );
}
