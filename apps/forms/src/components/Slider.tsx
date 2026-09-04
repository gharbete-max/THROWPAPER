/**
 * A labelled range with its value shown.
 *
 * Lived in `BrandKit.tsx` until the decoration panel needed the same thing. A slider with no
 * readout is the reason it is here at all: "line thickness" with the handle a third of the way
 * along tells an author nothing they can repeat on the next form.
 */
export function Slider({
  label,
  hint,
  min,
  max,
  step = 1,
  suffix = 'px',
  value,
  disabled = false,
  onChange,
}: {
  label: string;
  hint?: string | undefined;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  value: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <label className="field">
      <span className="row row--between">
        {label}
        <span className="small muted">
          {value}
          {suffix}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      {hint && <span className="small muted">{hint}</span>}
    </label>
  );
}
