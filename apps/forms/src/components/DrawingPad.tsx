import { useRef, useState } from 'react';
import type { DecorationColour } from '@tp/shared/forms';
import { useT } from '../lib/i18n.js';

/**
 * Freehand drawing, captured as SVG paths.
 *
 * Paths rather than a bitmap, because a decoration has to survive being printed, scaled to a
 * phone, and rendered into a PDF at whatever size the page gives it. A canvas screenshot would
 * be crisp on the machine it was drawn on and fuzzy everywhere else.
 *
 * The same capture drives the signature field's pad, which is why the smoothing and the pointer
 * handling live here rather than in either screen.
 */

interface Point {
  x: number;
  y: number;
}

/**
 * Points to a path, smoothed through the midpoints.
 *
 * Joining raw samples with `L` gives visible corners wherever the pointer reported a position,
 * which on a slow device is every few millimetres — handwriting comes out looking like a
 * seismograph. Curving through the midpoint of each pair is the standard fix: it costs one
 * quadratic per sample and the result reads as a hand.
 */
export function pathFrom(points: readonly Point[]): string {
  const first = points[0];
  if (!first) return '';
  // A tap is a dot. Without this it would be an empty path and the mark would simply not appear.
  if (points.length === 1) return `M ${round(first.x)} ${round(first.y)} l 0.01 0`;

  let d = `M ${round(first.x)} ${round(first.y)}`;
  for (let index = 1; index < points.length - 1; index += 1) {
    const point = points[index];
    const next = points[index + 1];
    if (!point || !next) continue;
    const midX = (point.x + next.x) / 2;
    const midY = (point.y + next.y) / 2;
    d += ` Q ${round(point.x)} ${round(point.y)} ${round(midX)} ${round(midY)}`;
  }
  const last = points[points.length - 1];
  if (last) d += ` L ${round(last.x)} ${round(last.y)}`;
  return d;
}

/** Two decimals is finer than any screen resolves, and keeps a long drawing out of the megabytes. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}

interface Props {
  paths: readonly string[];
  onChange: (paths: string[]) => void;
  stroke: DecorationColour;
  strokeWidth: number;
  viewBoxWidth: number;
  viewBoxHeight: number;
  /** Shown under the pad. Omitted where the surrounding label already says what to do. */
  hint?: string;
}

export function DrawingPad({
  paths,
  onChange,
  stroke,
  strokeWidth,
  viewBoxWidth,
  viewBoxHeight,
  hint,
}: Props) {
  const t = useT();
  const surface = useRef<SVGSVGElement | null>(null);
  const points = useRef<Point[]>([]);
  const [live, setLive] = useState<string>('');

  const colour =
    stroke === 'none' ? 'none' : stroke.startsWith('#') ? stroke : `var(--tp-colour-${stroke})`;

  /**
   * Client coordinates into the viewBox.
   *
   * `preserveAspectRatio="none"` on the pad means the mapping is a plain per-axis scale — what
   * you draw lands under the pointer at whatever size the panel happens to be, and the stored
   * path is in viewBox units so it renders the same on the form.
   */
  function at(event: { clientX: number; clientY: number }): Point | null {
    const box = surface.current?.getBoundingClientRect();
    if (!box || box.width === 0 || box.height === 0) return null;
    return {
      x: ((event.clientX - box.left) / box.width) * viewBoxWidth,
      y: ((event.clientY - box.top) / box.height) * viewBoxHeight,
    };
  }

  function start(event: React.PointerEvent<SVGSVGElement>) {
    // Secondary buttons and the right mouse button are not drawing gestures.
    if (event.button !== 0) return;
    const point = at(event);
    if (!point) return;
    /**
     * Capture on the element, so a stroke that leaves the pad keeps drawing and, more
     * importantly, still *ends* when the finger lifts outside it. Without capture, letting go
     * past the edge leaves the pad believing a stroke is still in progress.
     */
    event.currentTarget.setPointerCapture(event.pointerId);
    points.current = [point];
    setLive(pathFrom(points.current));
  }

  function move(event: React.PointerEvent<SVGSVGElement>) {
    if (points.current.length === 0) return;
    const point = at(event);
    if (!point) return;
    const previous = points.current[points.current.length - 1];
    // Samples closer together than this add nothing but file size.
    if (previous && Math.hypot(point.x - previous.x, point.y - previous.y) < 1.5) return;
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
    <div className="stack pad">
      <svg
        ref={surface}
        className="pad__surface"
        viewBox={`0 0 ${viewBoxWidth} ${viewBoxHeight}`}
        preserveAspectRatio="none"
        // Without this the browser pans and zooms the page instead of drawing, which is the
        // single thing that makes a drawing pad feel broken on a phone.
        style={{ touchAction: 'none', aspectRatio: `${viewBoxWidth} / ${viewBoxHeight}` }}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        // A cancelled pointer — a system gesture, a call arriving — ends the stroke rather than
        // stranding it, so the next tap does not continue a line from ten minutes ago.
        onPointerCancel={end}
        role="img"
        aria-label={t('draw.title')}
      >
        {[...paths, live].filter(Boolean).map((d, index) => (
          <path
            key={index}
            d={d}
            fill="none"
            stroke={colour}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
      </svg>

      <div className="row row--between">
        <span className="small muted">
          {paths.length === 0 ? t('draw.empty') : t('draw.strokes', { count: paths.length })}
        </span>
        <div className="row">
          <button
            type="button"
            className="button button--quiet small"
            disabled={paths.length === 0}
            onClick={() => onChange(paths.slice(0, -1))}
          >
            {t('draw.undoStroke')}
          </button>
          <button
            type="button"
            className="button button--quiet small"
            disabled={paths.length === 0}
            onClick={() => onChange([])}
          >
            {t('draw.clear')}
          </button>
        </div>
      </div>

      {hint && <span className="small muted">{hint}</span>}
    </div>
  );
}
