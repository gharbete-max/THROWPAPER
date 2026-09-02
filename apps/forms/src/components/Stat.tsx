import type { ReactNode } from 'react';

/**
 * One number worth reading at a glance, with its name underneath.
 *
 * Lifted out of the event report because every list in the product wants the same thing: a strip
 * of totals above the rows, so somebody arriving at a screen learns the shape of what is on it
 * before scrolling through it. Two of these that look almost alike is worse than one that looks
 * the same everywhere.
 *
 * The value is a `ReactNode` rather than a number: "3 of 250" and "—" are answers too, and a
 * component that only accepts numbers pushes every such case back into bespoke markup.
 */
export function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="stat">
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
    </div>
  );
}

/** The strip the stats sit in. Wraps rather than scrolls, so a narrow screen stacks them. */
export function Stats({ children }: { children: ReactNode }) {
  return <div className="row stats">{children}</div>;
}
