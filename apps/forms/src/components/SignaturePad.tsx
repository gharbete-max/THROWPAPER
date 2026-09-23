import { useRef, useState } from 'react';
import { embedSignatureVector, type SignatureVector } from '@tp/shared/forms';
import { useT } from '../lib/i18n.js';
import { pathFrom } from './DrawingPad.js';
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
 * key. Nothing downstream needs to know which way it was made.
 *
 * ## Why it uploads rather than storing the strokes in the answer
 *
 * Stroke coordinates in the submission would need their own renderer everywhere a signature is
 * ever shown — the grid, the export, a PDF — and would be unreadable in a CSV. Producing a PNG
 * and putting it through the upload route that already exists means private storage, access
 * control scoped to the submission, a download button and a filename all come for free.
 *
 * ## But the strokes travel inside the PNG
 *
 * A sealed document wants the mark as vector (`docs/adr/0009-where-signing-lives.md`), so the
 * outlines are written into the PNG itself as a text chunk — see `signature-vector.ts` in
 * `@tp/shared/forms` for why there and not beside it. Points only, rounded: **no timing and no
 * pressure are ever recorded**, because those would make a signature biometric data. A typed
 * signature carries its text instead. A name typed and then drawn over is sent as the picture
 * alone, rather than as a vector that describes only half of what the person saw.
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
  /** Each stroke's points in canvas pixels, for the vector. Positions only — never when. */
  const strokes = useRef<{ x: number; y: number }[][]>([]);
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
    strokes.current.push([{ x, y }]);
    setDirty(true);
  }

  function move(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const ctx = context();
    if (!ctx) return;
    const { x, y } = pointAt(event);
    ctx.lineTo(x, y);
    ctx.stroke();
    strokes.current[strokes.current.length - 1]?.push({ x, y });
  }

  function end() {
    drawing.current = false;
  }

  function clear() {
    const ctx = context();
    const element = canvas.current;
    if (ctx && element) ctx.clearRect(0, 0, element.width, element.height);
    strokes.current = [];
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
    // Typing replaces the canvas, and with it anything drawn.
    strokes.current = [];
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

  /** What the canvas shows, as vector — or nothing when it is a mixture of both routes. */
  function vector(): SignatureVector | null {
    const drawn = strokes.current.filter((stroke) => stroke.length > 0);
    const name = typed.trim();
    if (drawn.length > 0 && !name) {
      return { v: 1, kind: 'drawn', width: WIDTH, height: HEIGHT, paths: drawn.map(pathFrom) };
    }
    if (name && drawn.length === 0) {
      return { v: 1, kind: 'typed', width: WIDTH, height: HEIGHT, text: name };
    }
    return null;
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

    const bytes = withVector(new Uint8Array(await blob.arrayBuffer()), vector());
    const body = new FormData();
    body.append('file', new File([bytes], 'signature.png', { type: 'image/png' }));

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

/**
 * The PNG with its strokes, or the PNG alone if they cannot be written.
 *
 * Never fails the signature: the picture is what the respondent saw and approved, and a vector
 * that could not be attached (an unusually long scribble past the size cap, say) is a lesser
 * document, not a reason to make somebody sign again.
 */
function withVector(
  png: Uint8Array<ArrayBuffer>,
  vector: SignatureVector | null,
): Uint8Array<ArrayBuffer> {
  if (!vector) return png;
  try {
    return embedSignatureVector(png, vector);
  } catch {
    return png;
  }
}
