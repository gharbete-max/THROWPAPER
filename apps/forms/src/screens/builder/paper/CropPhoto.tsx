import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { cn } from '@tp/ui';
import { useT } from '../../../lib/i18n.js';
import { isUsable, type Corners, type Point } from './warp.js';

/**
 * Four handles on a photograph, for the author to put on the page's corners.
 *
 * What a scanner app finds automatically — and gets wrong on a dark table, at 8 MB of
 * computer vision — a person does in four drags. The corners start on the picture's own, so
 * doing nothing keeps the photograph as it is; `warp.ts` does the straightening on confirm.
 *
 * Handles are buttons: reachable from the keyboard, arrows move them (Shift moves ten times as
 * far), and the quadrilateral between them is drawn as SVG over the picture. Positions are
 * fractions of the image, like anchors, so the same corners are right at any pane width.
 */

const WHOLE: Corners = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

/** One arrow press, as a fraction of the picture. */
const NUDGE = 0.0025;

export function CropPhoto({
  file,
  corners,
  onChange,
}: {
  file: File;
  corners: Corners;
  onChange: (corners: Corners) => void;
}) {
  const t = useT();
  const surface = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);

  useEffect(() => {
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);

  function fraction(event: ReactPointerEvent): Point {
    const rect = surface.current!.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
    };
  }

  function move(index: number, to: Point) {
    const next = corners.map((c, i) => (i === index ? to : c)) as Corners;
    onChange(next);
  }

  const usable = isUsable(corners);
  const points = corners.map((c) => `${c.x * 100},${c.y * 100}`).join(' ');

  return (
    <div className="crop stack">
      <p className="small muted">{t('paper.crop')}</p>
      <div
        ref={surface}
        className="crop__surface"
        onPointerMove={(event) => {
          if (dragging !== null) move(dragging, fraction(event));
        }}
        onPointerUp={() => setDragging(null)}
        onPointerCancel={() => setDragging(null)}
      >
        {url && <img src={url} alt="" className="paper__image" draggable={false} />}
        <svg
          className={cn('crop__outline', !usable && 'crop__outline--bad')}
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden
        >
          <polygon points={points} />
        </svg>
        {corners.map((corner, index) => (
          <button
            key={index}
            type="button"
            className="crop__handle"
            style={{ left: `${corner.x * 100}%`, top: `${corner.y * 100}%` }}
            aria-label={t(`paper.corner.${index}`)}
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              event.preventDefault();
              event.currentTarget.setPointerCapture(event.pointerId);
              setDragging(index);
            }}
            onKeyDown={(event) => {
              const step = (event.shiftKey ? 10 : 1) * NUDGE;
              const delta: Record<string, [number, number]> = {
                ArrowLeft: [-step, 0],
                ArrowRight: [step, 0],
                ArrowUp: [0, -step],
                ArrowDown: [0, step],
              };
              const d = delta[event.key];
              if (!d) return;
              event.preventDefault();
              move(index, {
                x: Math.min(1, Math.max(0, corner.x + d[0])),
                y: Math.min(1, Math.max(0, corner.y + d[1])),
              });
            }}
          />
        ))}
      </div>
      <div className="row">
        {!usable && <span className="small status-down">{t('paper.cropNotAPage')}</span>}
        <button
          type="button"
          className="button button--quiet small"
          onClick={() => onChange(WHOLE)}
          disabled={corners.every((c, i) => c.x === WHOLE[i]!.x && c.y === WHOLE[i]!.y)}
        >
          {t('paper.cropReset')}
        </button>
      </div>
    </div>
  );
}

export { WHOLE as WHOLE_PICTURE };
