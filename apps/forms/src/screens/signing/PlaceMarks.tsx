import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { ApiError, client } from '../../lib/api.js';
import { useT } from '../../lib/i18n.js';
import { useToast } from '../../lib/toast.js';
import { useConfirm } from '../../components/Confirm.js';
import { browserPdfjs } from '../builder/paper/extract.js';
import {
  arrowDelta,
  clampToPage,
  dateSize,
  formatStampDate,
  nudge,
  onEveryPage,
  resizeDate,
  resizePicture,
  seenSize,
  toOps,
  type MarkKind,
  type PageGeometry,
  type Placement,
} from '../../lib/sign-placement.js';
import {
  forgetMark,
  loadMarks,
  type MarkSlot,
  type SavedMark,
  type SavedMarks,
} from '../../lib/sign-marks.js';
import { MarkMaker } from './MarkMaker.js';

/**
 * Place a signature, initials and a date on a PDF the person is about to sign on this computer.
 *
 * The marks are put on the document itself (`POST /v1/pdf/edit`) before it goes for signing, so
 * the sealed file and its audit page are exactly what they were: the document "as sent" simply
 * carries the marks. Positions are kept in the page as seen, in points from its top left
 * (`sign-placement.ts`), and every mark can be dragged, moved with the arrow keys, or typed as
 * numbers. The date is the day the marks are applied, never typed.
 */
const SHOW = 1.5;
const THUMB = 0.22;
const MAX_THUMBS = 60;
const SIGNATURE_WIDTH = 150;
const INITIALS_WIDTH = 60;
const DEFAULT_DATE_SIZE = 12;

type Pdf = Awaited<ReturnType<Awaited<ReturnType<typeof browserPdfjs>>['getDocument']>['promise']>;

function pngBlob(dataUrl: string): Blob {
  const binary = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: 'image/png' });
}

export default function PlaceMarks({
  file,
  locale,
  onCancel,
  onDone,
}: {
  file: File;
  locale: string;
  onCancel: () => void;
  /** The document with the marks on it, which replaces the one chosen. */
  onDone: (file: File) => void;
}) {
  const t = useT();
  const toast = useToast();
  const confirm = useConfirm();
  const [pdf, setPdf] = useState<Pdf | null>(null);
  const [pages, setPages] = useState<PageGeometry[]>([]);
  const [failed, setFailed] = useState(false);
  const [page, setPage] = useState(0);
  const [saved, setSaved] = useState<SavedMarks>(() => loadMarks());
  const [making, setMaking] = useState<MarkSlot | null>(null);
  const [kept, setKept] = useState(true);
  const [placements, setPlacements] = useState<Placement[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const nextId = useRef(1);
  const focusId = useRef<number | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const thumbs = useRef(new Map<number, HTMLCanvasElement>());
  const surface = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; x: number; y: number; from: Placement } | null>(null);
  // Today, in the reader's language: what the date mark shows now and what is stamped on apply.
  const today = formatStampDate(new Date(), locale);

  // Open the document once.
  useEffect(() => {
    let cancelled = false;
    let opened: Pdf | null = null;
    void (async () => {
      try {
        const pdfjs = await browserPdfjs();
        opened = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
        const geometry: PageGeometry[] = [];
        for (let n = 1; n <= opened.numPages; n += 1) {
          const p = await opened.getPage(n);
          geometry.push({ view: p.view as unknown as PageGeometry['view'], rotate: p.rotate });
        }
        if (cancelled) return;
        setPages(geometry);
        setPdf(opened);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      void opened?.loadingTask.destroy();
    };
  }, [file]);

  // Draw the page being worked on.
  useEffect(() => {
    if (!pdf || !canvas.current) return;
    let live = true;
    void (async () => {
      const p = await pdf.getPage(page + 1);
      const viewport = p.getViewport({ scale: SHOW });
      const target = canvas.current;
      if (!live || !target) return;
      target.width = Math.round(viewport.width);
      target.height = Math.round(viewport.height);
      await p.render({ canvas: target, viewport, intent: 'print' }).promise;
    })().catch(() => undefined);
    return () => {
      live = false;
    };
  }, [pdf, page]);

  // Draw every page small, for the strip.
  useEffect(() => {
    if (!pdf) return;
    let live = true;
    void (async () => {
      for (let n = 1; n <= Math.min(pdf.numPages, MAX_THUMBS); n += 1) {
        const p = await pdf.getPage(n);
        const viewport = p.getViewport({ scale: THUMB });
        const target = thumbs.current.get(n - 1);
        if (!live) return;
        if (!target) continue;
        target.width = Math.round(viewport.width);
        target.height = Math.round(viewport.height);
        await p.render({ canvas: target, viewport, intent: 'print' }).promise;
      }
    })().catch(() => undefined);
    return () => {
      live = false;
    };
  }, [pdf]);

  // A mark just added takes the keyboard focus, so the arrow keys work at once.
  useEffect(() => {
    const id = focusId.current;
    if (id === null) return;
    focusId.current = null;
    surface.current?.querySelector<HTMLElement>(`[data-mark="${id}"]`)?.focus();
  }, [placements]);

  if (failed)
    return (
      <p className="error" role="alert">
        {t('signPlace.unreadable')}
      </p>
    );
  if (!pdf)
    return (
      <p className="muted" role="status">
        {t('signPlace.loading')}
      </p>
    );

  const geometry = pages[page]!;
  const shown = seenSize(geometry);
  const label = (kind: MarkKind) => t(`signPlace.${kind}`);
  const current = placements.find((p) => p.id === selected) ?? null;
  const pictureOf = (kind: MarkKind): SavedMark | undefined =>
    kind === 'date' ? undefined : saved[kind];

  function update(
    id: number,
    change: (mark: Placement, size: { width: number; height: number }) => Placement,
  ) {
    setPlacements((all) =>
      all.map((mark) => (mark.id === id ? change(mark, seenSize(pages[mark.page]!)) : mark)),
    );
  }

  function create(kind: MarkKind, onPage: number): Placement {
    const size = seenSize(pages[onPage]!);
    const picture = pictureOf(kind);
    const id = nextId.current++;
    if (kind === 'date') {
      const base = { id, page: onPage, kind, x: size.width * 0.1, y: size.height * 0.9 };
      return resizeDate({ ...base, width: 0, height: 0 }, today, DEFAULT_DATE_SIZE, size);
    }
    const width = kind === 'signature' ? SIGNATURE_WIDTH : INITIALS_WIDTH;
    const aspect = picture ? picture.width / picture.height : 3;
    const base =
      kind === 'signature'
        ? { x: size.width * 0.1, y: size.height * 0.78 }
        : { x: size.width * 0.8, y: size.height * 0.9 };
    return resizePicture(
      { id, page: onPage, kind, ...base, width, height: width / aspect },
      width,
      aspect,
      size,
    );
  }

  function add(kind: MarkKind) {
    const mark = create(kind, page);
    focusId.current = mark.id;
    setPlacements((all) => [...all, mark]);
    setSelected(mark.id);
  }

  function initialsEverywhere() {
    const template = current?.kind === 'initials' ? current : create('initials', page);
    const marks = onEveryPage(template, pages, () => nextId.current++);
    setPlacements((all) => [...all.filter((mark) => mark.kind !== 'initials'), ...marks]);
    setSelected(marks[page]?.id ?? null);
    focusId.current = marks[page]?.id ?? null;
  }

  function onKey(event: KeyboardEvent, mark: Placement) {
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      setPlacements((all) => all.filter((m) => m.id !== mark.id));
      setSelected(null);
      return;
    }
    const delta = arrowDelta(event.key, event.shiftKey);
    if (!delta) return;
    event.preventDefault();
    update(mark.id, (m, size) => nudge(m, delta.x, delta.y, size));
  }

  function pointAt(event: ReactPointerEvent) {
    const box = surface.current!.getBoundingClientRect();
    return {
      x: ((event.clientX - box.left) / box.width) * shown.width,
      y: ((event.clientY - box.top) / box.height) * shown.height,
    };
  }

  function startDrag(event: ReactPointerEvent, mark: Placement) {
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { id: mark.id, ...pointAt(event), from: mark };
    setSelected(mark.id);
  }

  function moveDrag(event: ReactPointerEvent) {
    const d = drag.current;
    if (!d) return;
    const at = pointAt(event);
    update(d.id, (m, size) =>
      clampToPage({ ...m, x: d.from.x + at.x - d.x, y: d.from.y + at.y - d.y }, size),
    );
  }

  async function apply(acceptSignatureLoss = false): Promise<void> {
    const stamped = formatStampDate(new Date(), locale);
    if (!acceptSignatureLoss) {
      const ok = await confirm(
        t('signPlace.confirm', {
          count: placements.length,
          pages: [...new Set(placements.map((m) => m.page + 1))].join(', '),
          date: stamped,
        }),
        { danger: false, confirmLabel: t('signPlace.confirmYes') },
      );
      if (!ok) return;
    }
    setBusy(true);
    try {
      const images: Record<string, Blob> = {};
      for (const kind of ['signature', 'initials'] as const) {
        const picture = saved[kind];
        if (picture && placements.some((m) => m.kind === kind)) images[kind] = pngBlob(picture.png);
      }
      const edited = await client.editPdf(
        file,
        toOps(placements, pages, stamped),
        acceptSignatureLoss,
        images,
      );
      toast.show(t('signPlace.done'), 'success');
      onDone(new File([edited], file.name, { type: 'application/pdf' }));
    } catch (error) {
      if (error instanceof ApiError && error.code === 'signed') {
        setBusy(false);
        if (
          await confirm(t('scan.signed'), { confirmLabel: t('scan.signedConfirm'), danger: true })
        ) {
          return apply(true);
        }
      } else {
        toast.show(
          error instanceof ApiError && error.code === 'encrypted'
            ? t('scan.error.encrypted')
            : t('signPlace.failed'),
          'error',
        );
      }
    } finally {
      setBusy(false);
    }
  }

  async function forget(slot: MarkSlot) {
    const ok = await confirm(t('signPlace.forgetConfirm', { what: label(slot) }), {
      confirmLabel: t('signPlace.forget'),
    });
    if (!ok) return;
    forgetMark(slot);
    setSaved((all) => {
      const { [slot]: _gone, ...rest } = all;
      return rest;
    });
    setPlacements((all) => all.filter((m) => m.kind !== slot));
  }

  const pct = (value: number, of: number) => `${(value / of) * 100}%`;
  const countOn = (n: number) => placements.filter((m) => m.page === n).length;

  function markBody(mark: Placement) {
    const picture = pictureOf(mark.kind);
    return picture ? <img src={picture.png} alt="" draggable={false} /> : <span>{today}</span>;
  }

  return (
    // Enter in a number box must not submit the form this sits inside.
    <section
      className="stack sign-place"
      aria-label={t('signPlace.heading')}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && (event.target as HTMLElement).tagName === 'INPUT') {
          event.preventDefault();
        }
      }}
    >
      <h2>{t('signPlace.heading')}</h2>
      <p className="small muted">{t('signPlace.intro')}</p>

      <fieldset className="stack stack--tight">
        <legend>{t('signPlace.marksHeading')}</legend>
        {(['signature', 'initials'] as const).map((slot) => (
          <div key={slot} className="stack stack--tight">
            <div className="row">
              <strong>{label(slot)}</strong>
              {saved[slot] ? (
                <img className="sign-place__sample" src={saved[slot].png} alt="" />
              ) : null}
              <span className="small muted">
                {saved[slot] ? t('signPlace.saved') : t('signPlace.notSaved')}
              </span>
              <button
                type="button"
                className="button button--quiet small"
                aria-label={`${saved[slot] ? t('signPlace.replace') : t('signPlace.create')}: ${label(slot)}`}
                onClick={() => setMaking(slot)}
              >
                {saved[slot] ? t('signPlace.replace') : t('signPlace.create')}
              </button>
              {saved[slot] ? (
                <button
                  type="button"
                  className="button button--quiet small"
                  aria-label={`${t('signPlace.forget')}: ${label(slot)}`}
                  onClick={() => void forget(slot)}
                >
                  {t('signPlace.forget')}
                </button>
              ) : null}
            </div>
            {making === slot ? (
              <MarkMaker
                slot={slot}
                onCancel={() => setMaking(null)}
                onSaved={(mark, stored) => {
                  setSaved((all) => ({ ...all, [slot]: mark }));
                  setKept(stored);
                  setMaking(null);
                }}
              />
            ) : null}
          </div>
        ))}
        {!kept ? (
          <p className="small" role="status">
            {t('signPlace.storageFailed')}
          </p>
        ) : null}
      </fieldset>

      <div className="sign-place__layout">
        <div className="stack stack--tight">
          <div
            ref={surface}
            className="sign-place__page"
            role="group"
            aria-label={t('signPlace.previewLabel', { n: page + 1 })}
            data-testid="sign-place-page"
            style={
              {
                aspectRatio: `${shown.width} / ${shown.height}`,
                '--sp-width': shown.width,
              } as React.CSSProperties
            }
          >
            <canvas ref={canvas} className="sign-place__canvas" />
            {placements
              .filter((mark) => mark.page === page)
              .map((mark) => (
                <button
                  key={mark.id}
                  type="button"
                  data-mark={mark.id}
                  data-kind={mark.kind}
                  aria-pressed={selected === mark.id}
                  aria-label={t('signPlace.markLabel', {
                    what: label(mark.kind),
                    n: mark.page + 1,
                  })}
                  aria-describedby="sign-place-hint"
                  className={`sign-place__mark sign-place__mark--${mark.kind}`}
                  style={
                    {
                      left: pct(mark.x, shown.width),
                      top: pct(mark.y, shown.height),
                      width: pct(mark.width, shown.width),
                      height: pct(mark.height, shown.height),
                      '--sp-size': dateSize(mark),
                    } as React.CSSProperties
                  }
                  onFocus={() => setSelected(mark.id)}
                  onKeyDown={(event) => onKey(event, mark)}
                  onPointerDown={(event) => startDrag(event, mark)}
                  onPointerMove={moveDrag}
                  onPointerUp={() => (drag.current = null)}
                  onPointerCancel={() => (drag.current = null)}
                >
                  {markBody(mark)}
                </button>
              ))}
          </div>
          <p id="sign-place-hint" className="small muted">
            {t('signPlace.hint')}
          </p>
        </div>

        <div className="stack">
          <label className="field">
            <span>{t('signPlace.pageLabel')}</span>
            <select
              className="input"
              aria-label={t('signPlace.pageLabel')}
              value={page}
              onChange={(event) => setPage(Number(event.target.value))}
            >
              {pages.map((_, n) => (
                <option key={n} value={n}>
                  {t('signPlace.stripPage', { n: n + 1 })}
                </option>
              ))}
            </select>
          </label>
          <div className="stack stack--tight">
            {(['signature', 'initials', 'date'] as const).map((kind) => (
              <button
                key={kind}
                type="button"
                className="button button--quiet"
                disabled={kind !== 'date' && !saved[kind]}
                onClick={() => add(kind)}
              >
                {t('signPlace.add', { what: label(kind) })}
              </button>
            ))}
            <button
              type="button"
              className="button button--quiet"
              disabled={!saved.initials}
              onClick={initialsEverywhere}
            >
              {t('signPlace.everyPage')}
            </button>
          </div>
          <p className="small muted">{t('signPlace.dateNote', { date: today })}</p>

          {current ? (
            <fieldset className="stack stack--tight">
              <legend>
                {t('signPlace.markLabel', { what: label(current.kind), n: current.page + 1 })}
              </legend>
              <Num
                label={t('signPlace.x')}
                value={current.x}
                onChange={(v) => update(current.id, (m, size) => clampToPage({ ...m, x: v }, size))}
              />
              <Num
                label={t('signPlace.y')}
                value={current.y}
                onChange={(v) => update(current.id, (m, size) => clampToPage({ ...m, y: v }, size))}
              />
              {current.kind === 'date' ? (
                <Num
                  label={t('signPlace.size')}
                  value={dateSize(current)}
                  onChange={(v) => update(current.id, (m, size) => resizeDate(m, today, v, size))}
                />
              ) : (
                <Num
                  label={t('signPlace.width')}
                  value={current.width}
                  onChange={(v) =>
                    update(current.id, (m, size) => resizePicture(m, v, m.width / m.height, size))
                  }
                />
              )}
              <div>
                <button
                  type="button"
                  className="button button--quiet small"
                  onClick={() => {
                    setPlacements((all) => all.filter((m) => m.id !== current.id));
                    setSelected(null);
                  }}
                >
                  {t('signPlace.remove')}
                </button>
              </div>
            </fieldset>
          ) : null}

          <h3>{t('signPlace.listHeading')}</h3>
          {placements.length === 0 ? (
            <p className="small muted">{t('signPlace.none')}</p>
          ) : (
            <ul className="sign-place__list">
              {placements.map((mark) => (
                <li key={mark.id}>
                  <button
                    type="button"
                    className="button button--quiet small"
                    aria-pressed={selected === mark.id}
                    onClick={() => {
                      setSelected(mark.id);
                      setPage(mark.page);
                    }}
                  >
                    {t('signPlace.select')}:{' '}
                    {t('signPlace.markLabel', { what: label(mark.kind), n: mark.page + 1 })}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <section className="stack stack--tight" aria-label={t('signPlace.stripHeading')}>
        <h3>{t('signPlace.stripHeading')}</h3>
        <ol className="sign-place__strip" data-testid="sign-place-strip">
          {pages.map((geom, n) => {
            const size = seenSize(geom);
            const count = countOn(n);
            return (
              <li
                key={n}
                className={
                  count > 0 ? 'sign-place__thumb sign-place__thumb--marked' : 'sign-place__thumb'
                }
              >
                <button
                  type="button"
                  className="sign-place__thumbbutton"
                  aria-current={n === page ? 'page' : undefined}
                  aria-label={`${t('signPlace.stripPage', { n: n + 1 })}. ${t('signPlace.stripMarks', { count })}`}
                  data-marks={count}
                  onClick={() => setPage(n)}
                >
                  <span
                    className="sign-place__thumbpage"
                    style={{ aspectRatio: `${size.width} / ${size.height}` }}
                  >
                    {n < MAX_THUMBS ? (
                      <canvas
                        ref={(el) => {
                          if (el) thumbs.current.set(n, el);
                        }}
                      />
                    ) : null}
                    {placements
                      .filter((mark) => mark.page === n)
                      .map((mark) => (
                        <i
                          key={mark.id}
                          className="sign-place__thumbmark"
                          style={{
                            left: pct(mark.x, size.width),
                            top: pct(mark.y, size.height),
                            width: pct(mark.width, size.width),
                            height: pct(mark.height, size.height),
                          }}
                        />
                      ))}
                  </span>
                  <span className="small">
                    {t('signPlace.stripPage', { n: n + 1 })} ·{' '}
                    {t('signPlace.stripMarks', { count })}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </section>

      <div className="row">
        <button
          type="button"
          className="button"
          disabled={busy || placements.length === 0}
          onClick={() => void apply()}
        >
          {busy ? t('signPlace.applying') : t('signPlace.apply')}
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
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="number"
        inputMode="decimal"
        step="any"
        value={value}
        onChange={(event) => {
          const n = Number(event.target.value);
          if (Number.isFinite(n)) onChange(n);
        }}
      />
    </label>
  );
}
