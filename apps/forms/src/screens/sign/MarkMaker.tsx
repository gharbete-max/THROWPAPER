import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useT } from '../../lib/i18n.js';
import { inkBounds, saveMark, type MarkSlot, type SavedMark } from '../../lib/sign-marks.js';

/**
 * Makes a signature or initials: typed, drawn with a pointer, or written in pen mode (pressure, undo). Typing is an equal way, not a
 * fallback — somebody on a keyboard or a screen reader cannot draw (see `SignaturePad`).
 *
 * The result is a transparent PNG cropped to its ink, so the mark's proportions are its own and a
 * short name is not a long strip of nothing. It is saved on this computer only (`sign-marks.ts`)
 * and handed back; nothing here reaches a server.
 */
const SIZE = { signature: { width: 600, height: 200 }, initials: { width: 300, height: 200 } };
/** The ink of a mark on paper. PDF content, not interface colour: it must read on white. */
const INK = '#111111';
const PAD = 6;

/** One point of a pen stroke; `w` is the line width there, from the pen's pressure. */
interface Pt {
  x: number;
  y: number;
  w: number;
}

export function MarkMaker({
  slot,
  onSaved,
  onCancel,
}: {
  slot: MarkSlot;
  /** `kept` is false when this browser would not store it: it is still good for this document. */
  onSaved: (mark: SavedMark, kept: boolean) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const { width, height } = SIZE[slot];
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [how, setHow] = useState<'typed' | 'drawn' | 'pen'>('typed');
  // Pen mode keeps its strokes, so one can be undone and the width of each follows the pressure.
  const strokes = useRef<Pt[][]>([]);
  const [thickness, setThickness] = useState(4);
  const [text, setText] = useState('');
  const [inked, setInked] = useState(false);

  function context() {
    const ctx = canvas.current?.getContext('2d');
    if (!ctx) return null;
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = INK;
    return ctx;
  }

  function at(event: PointerEvent<HTMLCanvasElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    return {
      x: ((event.clientX - box.left) / box.width) * width,
      y: ((event.clientY - box.top) / box.height) * height,
    };
  }

  function clear() {
    const ctx = context();
    if (ctx) ctx.clearRect(0, 0, width, height);
    strokes.current = [];
    setInked(false);
  }

  /** Paints every pen stroke again: segments of the pressure's width, round at both ends. */
  function repaint() {
    const ctx = context();
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    for (const stroke of strokes.current) {
      stroke.forEach((point, index) => {
        const from = stroke[index - 1] ?? point;
        ctx.lineWidth = (from.w + point.w) / 2;
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        // A single point is a dot.
        ctx.lineTo(point.x + (index === 0 ? 0.01 : 0), point.y);
        ctx.stroke();
      });
    }
    setInked(strokes.current.length > 0);
  }

  /** A mouse reports 0.5 while pressed, a pen its real pressure; either gives a visible line. */
  function pen(event: PointerEvent<HTMLCanvasElement>, last?: Pt): Pt {
    const { x, y } = at(event);
    const w = thickness * (0.4 + 1.2 * (event.pressure || 0.5));
    // Half-way to the new point: the smoothing that takes the shake out of a hand-held line.
    return last
      ? { x: last.x + (x - last.x) * 0.5, y: last.y + (y - last.y) * 0.5, w }
      : { x, y, w };
  }

  /** The typed words in the page's own font (a token), italic like handwriting. */
  function typeOnto(ctx: CanvasRenderingContext2D) {
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = INK;
    ctx.font = `italic ${slot === 'signature' ? 84 : 110}px ${getComputedStyle(document.body).fontFamily}`;
    ctx.textBaseline = 'middle';
    ctx.fillText(text.trim(), 20, height / 2, width - 40);
  }

  function save() {
    const ctx = context();
    const element = canvas.current;
    if (!ctx || !element) return;
    if (how === 'typed') {
      if (!text.trim()) return;
      typeOnto(ctx);
    }
    const found = inkBounds(ctx.getImageData(0, 0, width, height).data, width, height, PAD);
    if (!found) return;
    const crop = document.createElement('canvas');
    crop.width = found.width;
    crop.height = found.height;
    crop
      .getContext('2d')!
      .drawImage(
        element,
        found.x,
        found.y,
        found.width,
        found.height,
        0,
        0,
        found.width,
        found.height,
      );
    const mark: SavedMark = {
      png: crop.toDataURL('image/png'),
      width: found.width,
      height: found.height,
    };
    onSaved(mark, saveMark(slot, mark));
  }

  const ready = how === 'typed' ? text.trim() !== '' : inked;
  // Enter in the text box saves the mark; it must not submit the form this sits inside.
  const onEnter = (event: KeyboardEvent) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (ready) save();
  };

  return (
    <div className="stack stack--tight sign-place__maker">
      <div className="row" role="radiogroup" aria-label={t(`signPlace.${slot}`)}>
        {(['typed', 'drawn', 'pen'] as const).map((choice) => (
          <button
            key={choice}
            type="button"
            role="radio"
            aria-checked={how === choice}
            className={how === choice ? 'button' : 'button button--quiet'}
            onClick={() => {
              setHow(choice);
              strokes.current = [];
              setInked(false);
            }}
          >
            {t(`signPlace.${choice}`)}
          </button>
        ))}
      </div>
      {how === 'typed' ? (
        <label className="stack stack--tight">
          <span>{t('signPlace.typedLabel')}</span>
          <input
            className="input"
            value={text}
            maxLength={60}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={onEnter}
          />
        </label>
      ) : (
        <>
          <canvas
            ref={canvas}
            className="sign-place__pad"
            width={width}
            height={height}
            role="img"
            aria-label={t('signPlace.drawArea')}
            // Otherwise a phone scrolls the page instead of drawing.
            style={{ touchAction: 'none', aspectRatio: `${width} / ${height}` }}
            onPointerDown={(event) => {
              const ctx = context();
              if (!ctx) return;
              event.currentTarget.setPointerCapture(event.pointerId);
              drawing.current = true;
              if (how === 'pen') {
                strokes.current.push([pen(event)]);
                repaint();
                return;
              }
              const { x, y } = at(event);
              ctx.beginPath();
              ctx.moveTo(x, y);
              // A tap leaves a dot.
              ctx.lineTo(x + 0.01, y);
              ctx.stroke();
              setInked(true);
            }}
            onPointerMove={(event) => {
              if (!drawing.current) return;
              if (how === 'pen') {
                const stroke = strokes.current.at(-1);
                if (stroke) stroke.push(pen(event, stroke.at(-1)));
                repaint();
                return;
              }
              const ctx = context();
              if (!ctx) return;
              const { x, y } = at(event);
              ctx.lineTo(x, y);
              ctx.stroke();
            }}
            onPointerUp={() => (drawing.current = false)}
            onPointerCancel={() => (drawing.current = false)}
          />
          <div>
            {how === 'pen' && (
              <>
                <button
                  type="button"
                  className="button button--quiet small"
                  disabled={!inked}
                  onClick={() => {
                    strokes.current.pop();
                    repaint();
                  }}
                >
                  {t('signPlace.undo')}
                </button>{' '}
                <label className="small">
                  {t('signPlace.thickness')}{' '}
                  <input
                    type="range"
                    min={2}
                    max={10}
                    value={thickness}
                    onChange={(event) => setThickness(Number(event.target.value))}
                  />
                </label>{' '}
              </>
            )}
            <button type="button" className="button button--quiet small" onClick={clear}>
              {t('signPlace.clear')}
            </button>
          </div>
        </>
      )}
      {/* The typed route draws on this canvas only at the moment of saving. */}
      {how === 'typed' ? (
        <canvas ref={canvas} width={width} height={height} hidden aria-hidden="true" />
      ) : null}
      <div className="row">
        <button type="button" className="button" disabled={!ready} onClick={save}>
          {t('signPlace.save')}
        </button>
        <button type="button" className="button button--quiet" onClick={onCancel}>
          {t('confirm.cancel')}
        </button>
      </div>
    </div>
  );
}
