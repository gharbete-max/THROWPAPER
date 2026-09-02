import { useRef, useState } from 'react';
import { useT } from '../lib/i18n.js';
import { Icon } from './Icon.js';

/**
 * Signing: draw it, or type it.
 *
 * ## Typing is not a fallback
 *
 * Somebody using a keyboard, a screen reader, or a machine with no pointer cannot draw. A
 * signature field they cannot complete is a form they cannot submit — and a required one turns
 * the whole thing into a wall. So typing a name is offered as an equal way to sign, in the same
 * control, and it produces the same artefact: a PNG in the private store, addressed by the same
 * key. Nothing downstream knows or cares which way it was made.
 *
 * ## Why it uploads rather than storing the strokes
 *
 * Stroke coordinates in the submission would need their own renderer everywhere a signature is
 * ever shown — the grid, the export, a PDF — and would be unreadable in a CSV. Producing a PNG
 * and putting it through the upload route that already exists means private storage, access
 * control scoped to the submission, a download button and a filename all come for free.
 */
const WIDTH = 600;
const HEIGHT = 200;

export function SignaturePad({
  slug,
  fieldKey,
  value,
  onChange,
}: {
  slug: string;
  fieldKey: string;
  value: string;
  onChange: (key: string) => void;
}) {
  const t = useT();
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [dirty, setDirty] = useState(false);
  const [typed, setTyped] = useState('');
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'failed'>(
    value ? 'saved' : 'idle',
  );

  function context() {
    const element = canvas.current;
    if (!element) return null;
    const ctx = element.getContext('2d');
    if (!ctx) return null;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // Black rather than the brand colour: a signature is a mark on a document, not decoration,
    // and it has to stay legible wherever the image ends up.
    ctx.strokeStyle = '#111111';
    return ctx;
  }

  /** Canvas pixels from a pointer event, accounting for however the element is laid out. */
  function pointAt(event: React.PointerEvent<HTMLCanvasElement>) {
    const element = canvas.current!;
    const box = element.getBoundingClientRect();
    return {
      x: ((event.clientX - box.left) / box.width) * WIDTH,
      y: ((event.clientY - box.top) / box.height) * HEIGHT,
    };
  }

  function start(event: React.PointerEvent<HTMLCanvasElement>) {
    const ctx = context();
    if (!ctx) return;
    // Capture, so a stroke that leaves the box keeps going instead of stopping mid-letter.
    event.currentTarget.setPointerCapture(event.pointerId);
    drawing.current = true;
    const { x, y } = pointAt(event);
    ctx.beginPath();
    ctx.moveTo(x, y);
    setDirty(true);
  }

  function move(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const ctx = context();
    if (!ctx) return;
    const { x, y } = pointAt(event);
    ctx.lineTo(x, y);
    ctx.stroke();
  }

  function end() {
    drawing.current = false;
  }

  function clear() {
    const ctx = context();
    const element = canvas.current;
    if (ctx && element) ctx.clearRect(0, 0, element.width, element.height);
    setDirty(false);
    setTyped('');
    onChange('');
    setState('idle');
  }

  /** Renders the typed name onto the same canvas, so both routes produce one kind of artefact. */
  function drawTyped(name: string) {
    const ctx = context();
    const element = canvas.current;
    if (!ctx || !element) return;
    ctx.clearRect(0, 0, element.width, element.height);
    if (!name.trim()) {
      setDirty(false);
      return;
    }
    ctx.fillStyle = '#111111';
    ctx.font = 'italic 64px Georgia, "Times New Roman", serif';
    ctx.textBaseline = 'middle';
    ctx.fillText(name, 40, HEIGHT / 2, WIDTH - 80);
    setDirty(true);
  }

  async function save() {
    const element = canvas.current;
    if (!element || !dirty) return;
    setState('saving');

    const blob = await new Promise<Blob | null>((resolve) =>
      element.toBlob((result) => resolve(result), 'image/png'),
    );
    if (!blob) {
      setState('failed');
      return;
    }

    const body = new FormData();
    body.append('file', new File([blob], 'signature.png', { type: 'image/png' }));

    try {
      const response = await fetch(
        `/api/public/forms/${slug}/uploads?field=${encodeURIComponent(fieldKey)}`,
        { method: 'POST', body },
      );
      if (!response.ok) {
        setState('failed');
        return;
      }
      const stored = (await response.json()) as { key: string };
      onChange(stored.key);
      setState('saved');
    } catch {
      setState('failed');
    }
  }

  return (
    <div className="signature stack stack--tight">
      <canvas
        ref={canvas}
        className="signature__pad"
        width={WIDTH}
        height={HEIGHT}
        // `none`, or a drag on a phone scrolls the page instead of drawing.
        style={{ touchAction: 'none' }}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        aria-hidden="true"
      />

      <div className="row">
        <button type="button" className="button button--quiet small" onClick={clear}>
          <Icon name="close" className="icon--lead" />
          {t('signature.clear')}
        </button>
        <button
          type="button"
          className="button small"
          onClick={save}
          disabled={!dirty || state === 'saving'}
        >
          <Icon name="check" className="icon--lead" />
          {state === 'saving' ? t('signature.saving') : t('signature.apply')}
        </button>
        {state === 'saved' && <span className="small status-up">{t('signature.saved')}</span>}
        {state === 'failed' && <span className="small status-down">{t('signature.failed')}</span>}
      </div>

      {/* The keyboard route. Same control, same outcome — not a lesser option in a corner. */}
      <label className="field">
        <span className="small muted">{t('signature.typeInstead')}</span>
        <input
          value={typed}
          autoComplete="name"
          onChange={(event) => {
            setTyped(event.target.value);
            drawTyped(event.target.value);
            // Applying again is required either way, so a half-typed name is never submitted.
            if (state === 'saved') setState('idle');
          }}
        />
      </label>
    </div>
  );
}
