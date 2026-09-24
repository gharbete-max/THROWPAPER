import { useRef, useState } from 'react';
import { pathFrom, type PadPoint } from '@tp/shared/forms';
import type { Translator } from '@tp/i18n';

/** The pad's own units. The stored paths are in these, whatever size the pad is shown at. */
export const PAD = { width: 600, height: 200 } as const;

/**
 * A signature pad: pointer strokes into SVG paths in the grammar `@tp/shared/forms` validates —
 * the same function Forms' signature field draws with, so a mark means the same in both products.
 * Geometry only: no timing, no pressure (ADR 0009 — those would make it biometric data).
 */
export function DrawPad({
  paths,
  onChange,
  t,
}: {
  paths: string[];
  onChange: (paths: string[]) => void;
  t: Translator;
}) {
  const surface = useRef<SVGSVGElement | null>(null);
  const points = useRef<PadPoint[]>([]);
  const [live, setLive] = useState('');

  function at(event: { clientX: number; clientY: number }): PadPoint | null {
    const box = surface.current?.getBoundingClientRect();
    if (!box || box.width === 0 || box.height === 0) return null;
    return {
      x: ((event.clientX - box.left) / box.width) * PAD.width,
      y: ((event.clientY - box.top) / box.height) * PAD.height,
    };
  }

  function start(event: React.PointerEvent<SVGSVGElement>) {
    if (event.button !== 0) return;
    const point = at(event);
    if (!point) return;
    // Captured, so a stroke that leaves the pad still ends when the finger lifts.
    event.currentTarget.setPointerCapture(event.pointerId);
    points.current = [point];
    setLive(pathFrom(points.current));
  }

  function move(event: React.PointerEvent<SVGSVGElement>) {
    if (points.current.length === 0) return;
    const point = at(event);
    const previous = points.current[points.current.length - 1];
    if (!point || (previous && Math.hypot(point.x - previous.x, point.y - previous.y) < 1.5)) {
      return;
    }
    points.current = [...points.current, point];
    setLive(pathFrom(points.current));
  }

  function end() {
    if (points.current.length === 0) return;
    const d = pathFrom(points.current);
    points.current = [];
    setLive('');
    if (d) onChange([...paths, d]);
  }

  return (
    <div className="pad">
      <svg
        ref={surface}
        className="pad__surface"
        viewBox={`0 0 ${PAD.width} ${PAD.height}`}
        preserveAspectRatio="none"
        // Otherwise a phone scrolls the page instead of drawing.
        style={{ touchAction: 'none', aspectRatio: `${PAD.width} / ${PAD.height}` }}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        role="img"
        aria-label={t('sign.drawArea')}
        data-testid="sign-pad"
      >
        {[...paths, live].filter(Boolean).map((d, index) => (
          <path key={index} d={d} className="pad__stroke" />
        ))}
      </svg>
      <div className="row row--between">
        <span className="small muted">{t('sign.drawHint')}</span>
        <span className="row">
          <button
            type="button"
            className="button button--quiet"
            disabled={paths.length === 0}
            onClick={() => onChange(paths.slice(0, -1))}
          >
            {t('sign.undo')}
          </button>
          <button
            type="button"
            className="button button--quiet"
            disabled={paths.length === 0}
            onClick={() => onChange([])}
          >
            {t('sign.clear')}
          </button>
        </span>
      </div>
    </div>
  );
}
