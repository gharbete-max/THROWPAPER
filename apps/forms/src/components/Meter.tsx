/**
 * How full something is — registrations against capacity.
 *
 * A number tells you 187 of 250; a bar tells you "nearly full" without doing the division. Both,
 * because the bar alone is imprecise and the number alone is work.
 *
 * Built from a `<div>` rather than `<meter>`: the native element's fill colour is not reachable
 * from CSS in every engine, and CLAUDE.md rule 4 means the fill must come from the Brand Kit
 * rather than from whatever green the browser picked.
 */
export function Meter({ value, max, label }: { value: number; max: number; label: string }) {
  // A capacity of nought would divide by zero, and an over-subscribed event must not paint past
  // the end of its own track.
  const ratio = max > 0 ? Math.min(1, value / max) : 0;
  const full = max > 0 && value >= max;

  return (
    <div
      className={full ? 'meter meter--full' : 'meter'}
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-label={label}
    >
      <div className="meter__fill" style={{ inlineSize: `${ratio * 100}%` }} />
    </div>
  );
}
