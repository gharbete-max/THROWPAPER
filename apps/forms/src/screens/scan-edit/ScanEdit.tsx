import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { ApiError, client } from '../../lib/api.js';
import { useT } from '../../lib/i18n.js';
import { useToast } from '../../lib/toast.js';
import { useConfirm } from '../../components/Confirm.js';
import { browserPdfjs, type Pdfjs } from '../builder/paper/extract.js';

/**
 * Edit one page of the PDF the Scan screen has made: add text, cover a patch, or redact
 * (`docs/plan/NEXT.md` 1b). A lazy chunk, opened from Scan by one button on a page.
 *
 * Positions on screen are in the page as shown, in points from its top left. They are turned into
 * the PDF's own space only when sent, by pdf.js's own conversion, so a turned or cropped page is
 * right. Every box can be typed as numbers as well as drawn, so nothing needs a pointer.
 *
 * Add and cover change how the page looks (`POST /v1/pdf/edit`); a cover is paint, and the words
 * under it stay in the file. Redact draws the page here with the boxes burnt in and sends that
 * picture to replace the page (`POST /v1/pdf/redact`): nothing under a box is left, and the page is
 * no longer text.
 */

/** Shown size of the page, as a multiple of its size in points. */
const SHOW = 1.5;
/** The picture a redacted page becomes: this many pixels a point, fewer for a very large page. */
const BURN = 2;
const BURN_LONGEST_SIDE = 4000;
/** What the PDF is painted with: paper white for a cover, black for a redaction. These are PDF content, not interface colours. */
const PAPER = '#ffffff';
const INK = '#000000';

type Mode = 'text' | 'cover' | 'redact';

interface Item {
  id: number;
  mode: Mode;
  x: number;
  y: number;
  /** Text: the words and size. Boxes: the width and height, in `w` and `h`. */
  text?: string;
  size?: number;
  w?: number;
  h?: number;
  fill?: string;
}

interface Props {
  /** The PDF as the Scan screen has made it. */
  blob: Blob;
  /** The page to edit, from 0. */
  page: number;
  onCancel: () => void;
  /** The edited PDF, which replaces the Scan screen's pages. */
  onDone: (file: File) => void;
}

let nextId = 1;

export default function ScanEdit({ blob, page, onCancel, onDone }: Props) {
  const t = useT();
  const toast = useToast();
  const confirm = useConfirm();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [shown, setShown] = useState<{ width: number; height: number } | null>(null);
  const [mode, setMode] = useState<Mode>('text');
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState('');
  const [size, setSize] = useState(14);
  const [x, setX] = useState(36);
  const [y, setY] = useState(72);
  const [w, setW] = useState(120);
  const [h, setH] = useState(24);
  const [fill, setFill] = useState(PAPER);
  const drag = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const drawing = new AbortController();
    let close: (() => Promise<void>) | undefined;
    void (async () => {
      try {
        const pdfjs = await browserPdfjs();
        const doc = await pdfjs.getDocument({ data: await blob.arrayBuffer() }).promise;
        close = () => doc.loadingTask.destroy();
        const pdfPage = await doc.getPage(page + 1);
        if (drawing.signal.aborted || !canvas.current) return;
        const viewport = pdfPage.getViewport({ scale: SHOW });
        canvas.current.width = Math.round(viewport.width);
        canvas.current.height = Math.round(viewport.height);
        setShown({ width: viewport.width / SHOW, height: viewport.height / SHOW });
        await pdfPage.render({ canvas: canvas.current, viewport, intent: 'print' }).promise;
      } catch {
        if (!drawing.signal.aborted) toast.show(t('scan.error.unreadable'), 'error');
      }
    })();
    return () => {
      drawing.abort();
      void close?.();
    };
  }, [blob, page]); // eslint-disable-line react-hooks/exhaustive-deps

  const isBox = mode !== 'text';
  const round = (n: number) => Math.round(n * 10) / 10;

  /** Where on the page as shown (points from its top left) a pointer is. */
  function point(event: PointerEvent): { x: number; y: number } {
    const box = event.currentTarget.getBoundingClientRect();
    return {
      x: round(((event.clientX - box.left) / box.width) * shown!.width),
      y: round(((event.clientY - box.top) / box.height) * shown!.height),
    };
  }

  function onDown(event: PointerEvent) {
    if (!shown) return;
    const at = point(event);
    setX(at.x);
    setY(at.y);
    if (isBox) {
      drag.current = at;
      event.currentTarget.setPointerCapture(event.pointerId);
    }
  }

  function onMove(event: PointerEvent) {
    const from = drag.current;
    if (!from || !shown) return;
    const at = point(event);
    setX(Math.min(from.x, at.x));
    setY(Math.min(from.y, at.y));
    setW(round(Math.abs(at.x - from.x)));
    setH(round(Math.abs(at.y - from.y)));
  }

  const valid = mode === 'text' ? text.trim() !== '' && size >= 4 : w > 0 && h > 0;

  function add() {
    if (!valid) return;
    const item: Item =
      mode === 'text'
        ? { id: nextId++, mode, x, y, text, size }
        : { id: nextId++, mode, x, y, w, h, fill: mode === 'cover' ? fill : INK };
    setItems((current) => [...current, item]);
    if (mode === 'text') setText('');
  }

  /** The page as a picture, boxes burnt in. */
  async function burn(source: Blob, boxes: Item[], pdfjs: Pdfjs): Promise<Blob> {
    const doc = await pdfjs.getDocument({ data: await source.arrayBuffer() }).promise;
    try {
      const pdfPage = await doc.getPage(page + 1);
      const natural = pdfPage.getViewport({ scale: 1 });
      const scale = Math.min(BURN, BURN_LONGEST_SIDE / Math.max(natural.width, natural.height));
      const viewport = pdfPage.getViewport({ scale });
      const picture = globalThis.document.createElement('canvas');
      picture.width = Math.round(viewport.width);
      picture.height = Math.round(viewport.height);
      await pdfPage.render({ canvas: picture, viewport, intent: 'print' }).promise;
      const context = picture.getContext('2d')!;
      context.fillStyle = INK;
      for (const box of boxes) {
        context.fillRect(box.x * scale, box.y * scale, box.w! * scale, box.h! * scale);
      }
      return await new Promise<Blob>((resolve, reject) =>
        picture.toBlob(
          (png) => (png ? resolve(png) : reject(new Error('no picture'))),
          'image/png',
        ),
      );
    } finally {
      await doc.loadingTask.destroy();
    }
  }

  async function apply(acceptSignatureLoss = false) {
    const boxes = items.filter((item) => item.mode === 'redact');
    if (
      boxes.length > 0 &&
      !acceptSignatureLoss &&
      !(await confirm(t('scanEdit.redactConfirm', { n: page + 1 }), {
        confirmLabel: t('scanEdit.mode.redact'),
        danger: true,
      }))
    ) {
      return;
    }
    setBusy(true);
    try {
      const pdfjs = await browserPdfjs();
      let current = blob;
      const changes = items.filter((item) => item.mode !== 'redact');
      if (changes.length > 0) {
        // Corners as shown, turned into the PDF's own space by pdf.js.
        const doc = await pdfjs.getDocument({ data: await blob.arrayBuffer() }).promise;
        const viewport = (await doc.getPage(page + 1)).getViewport({ scale: 1 });
        const toPdf = (px: number, py: number) => viewport.convertToPdfPoint(px, py) as number[];
        await doc.loadingTask.destroy();
        current = await client.editPdf(
          blob,
          changes.map((item) => {
            const [px = 0, py = 0] = toPdf(item.x, item.y);
            if (item.mode === 'text') {
              return { page, x: px, y: py, text: item.text!, size: item.size! };
            }
            const [qx = 0, qy = 0] = toPdf(item.x + item.w!, item.y + item.h!);
            return {
              page,
              rect: {
                x: Math.min(px, qx),
                y: Math.min(py, qy),
                width: Math.abs(qx - px),
                height: Math.abs(qy - py),
              },
              fill: item.fill!,
            };
          }),
          acceptSignatureLoss,
        );
      }
      if (boxes.length > 0) {
        current = await client.redactPdf(
          current,
          [{ page, image: await burn(current, boxes, pdfjs) }],
          acceptSignatureLoss,
        );
      }
      onDone(new File([current], 'loppa.pdf', { type: 'application/pdf' }));
    } catch (error) {
      if (error instanceof ApiError && error.code === 'signed') {
        setBusy(false);
        if (
          await confirm(t('scan.signed'), { confirmLabel: t('scan.signedConfirm'), danger: true })
        ) {
          return apply(true);
        }
      } else {
        toast.show(errorText(error), 'error');
      }
    } finally {
      setBusy(false);
    }
  }

  function errorText(error: unknown): string {
    const code = error instanceof ApiError ? error.code : '';
    const fields = (error instanceof ApiError ? error.detail.fields : undefined) as
      { characters?: string[] } | undefined;
    const chars = (fields?.characters ?? []).join(' ');
    switch (code) {
      case 'unsupported-glyphs':
        return t('scanEdit.error.glyphs', { chars });
      case 'font-unavailable':
        return t('scanEdit.error.font', { chars });
      case 'bad-op':
        return t('scanEdit.error.bad');
      case 'cannot-redact-safely':
        return t('scanEdit.error.unsafe');
      case 'encrypted':
        return t('scan.error.encrypted');
      default:
        return t('scan.error.failed');
    }
  }

  const modes: Mode[] = ['text', 'cover', 'redact'];
  const pct = (value: number, of: number) => `${(value / of) * 100}%`;

  return (
    <section className="stack scan-edit" aria-label={t('scanEdit.heading', { n: page + 1 })}>
      <h2>{t('scanEdit.heading', { n: page + 1 })}</h2>
      <div className="scan-edit__layout">
        <div
          className="scan-edit__page"
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={() => (drag.current = null)}
          data-testid="scan-edit-page"
        >
          <canvas ref={canvas} className="scan-edit__canvas" />
          {shown
            ? items.map((item) => (
                <span
                  key={item.id}
                  className={`scan-edit__mark scan-edit__mark--${item.mode}`}
                  style={{
                    left: pct(item.x, shown.width),
                    top: pct(item.y, shown.height),
                    ...(item.mode === 'text'
                      ? { fontSize: `${(item.size ?? 14) * SHOW}px` }
                      : {
                          width: pct(item.w!, shown.width),
                          height: pct(item.h!, shown.height),
                          background: item.fill,
                        }),
                  }}
                >
                  {item.mode === 'text' ? item.text : null}
                </span>
              ))
            : null}
        </div>

        <div className="stack">
          <fieldset className="scan-edit__modes">
            <legend>{t('scanEdit.modeLabel')}</legend>
            {modes.map((value) => (
              <label key={value} className="field field--inline">
                <input
                  type="radio"
                  name="scan-edit-mode"
                  checked={mode === value}
                  onChange={() => setMode(value)}
                />
                <span>{t(`scanEdit.mode.${value}` as const)}</span>
              </label>
            ))}
          </fieldset>
          <p className="muted small">{t(isBox ? 'scanEdit.hint.box' : 'scanEdit.hint.text')}</p>
          {mode === 'cover' ? <p className="muted small">{t('scanEdit.coverNote')}</p> : null}
          {mode === 'redact' ? <p className="small">{t('scanEdit.redactNote')}</p> : null}

          {mode === 'text' ? (
            <>
              <label className="field">
                <span>{t('scanEdit.text')}</span>
                <input value={text} onChange={(event) => setText(event.target.value)} />
              </label>
              <Num label={t('scanEdit.size')} value={size} min={4} onChange={setSize} />
            </>
          ) : null}
          <Num label={t('scanEdit.x')} value={x} min={0} onChange={setX} />
          <Num label={t('scanEdit.y')} value={y} min={0} onChange={setY} />
          {isBox ? (
            <>
              <Num label={t('scanEdit.width')} value={w} min={1} onChange={setW} />
              <Num label={t('scanEdit.height')} value={h} min={1} onChange={setH} />
            </>
          ) : null}
          {mode === 'cover' ? (
            <label className="field">
              <span>{t('scanEdit.fill')}</span>
              <input type="color" value={fill} onChange={(event) => setFill(event.target.value)} />
            </label>
          ) : null}
          <button type="button" className="button" disabled={!valid} onClick={add}>
            {t('scanEdit.add')}
          </button>
        </div>
      </div>

      <h3>{t('scanEdit.pending')}</h3>
      {items.length === 0 ? (
        <p className="muted small">{t('scanEdit.none')}</p>
      ) : (
        <ul className="scan-edit__items">
          {items.map((item) => (
            <li key={item.id} className="row">
              <span>
                {item.mode === 'text'
                  ? t('scanEdit.item.text', { text: item.text ?? '' })
                  : t(`scanEdit.mode.${item.mode}` as const)}
              </span>
              <button
                type="button"
                className="button button--quiet"
                onClick={() => setItems((current) => current.filter((i) => i.id !== item.id))}
              >
                {t('scanEdit.remove')}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="row">
        <button
          type="button"
          className="button"
          disabled={busy || items.length === 0}
          onClick={() => void apply()}
        >
          {busy ? t('scanEdit.applying') : t('scanEdit.apply')}
        </button>
        <button type="button" className="button button--quiet" disabled={busy} onClick={onCancel}>
          {t('confirm.cancel')}
        </button>
      </div>
    </section>
  );
}

function Num({
  label,
  value,
  min,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="number"
        inputMode="decimal"
        min={min}
        step="any"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}
