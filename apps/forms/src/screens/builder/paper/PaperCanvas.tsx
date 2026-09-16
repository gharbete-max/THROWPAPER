import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { pickText } from '@tp/i18n';
import type { Field, FieldType, FormDefinition, PaperAnchor } from '@tp/shared/forms';
import { cn } from '@tp/ui';
import { client } from '../../../lib/api.js';
import { useT } from '../../../lib/i18n.js';
import { useSession } from '../../../lib/session.js';
import { Icon } from '../../../components/Icon.js';
import { hasLabel, newField } from '../field-defaults.js';
import { labelNear, openPdf, type PaperPdf } from './extract.js';

/**
 * The paper, with the questions drawn on it.
 *
 * Every page of every source, stacked, at the width of the pane. A field with an anchor is a box
 * on its page; dragging on empty paper draws a new one and asks what kind of answer it takes.
 * The field that comes out is the same `Field` the list view shows and `FieldProperties` edits —
 * this is a second way of looking at the same list, not a second list.
 *
 * ## Not pointer-only
 *
 * Each box is a button, so it can be reached and selected from the keyboard, and the arrow keys
 * move the selected one (Shift resizes). Drawing a fresh box does need a pointer; the palette
 * still adds a field without one, and it can then be placed with the arrows.
 */

/** The answers worth drawing a box for. Decorations and breaks have no place on a page. */
const DRAWABLE: readonly FieldType[] = [
  'short_text',
  'long_text',
  'number',
  'date',
  'single_select',
  'multi_select',
  'yes_no',
  'signature',
];

/** One arrow press, as a fraction of the page. Half a percent is about a millimetre on A4. */
const NUDGE = 0.005;

interface Props {
  formId: string;
  /**
   * Whether the draft on the server lists the paper yet.
   *
   * The read route only serves a key the saved draft names, and an import edits the draft in the
   * browser some hundreds of milliseconds before autosave sends it. Asking in that window is a
   * 404 that looks like a broken file, so the pages are not fetched until the save has landed.
   */
  saved: boolean;
  definition: FormDefinition;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onChange: (definition: FormDefinition) => void;
  renderEditor: (field: Field) => ReactNode;
}

type Page = { kind: 'pdf'; pdf: PaperPdf; index: number } | { kind: 'image'; url: string };

export function PaperCanvas({
  formId,
  saved,
  definition,
  selectedId,
  onSelect,
  onChange,
  renderEditor,
}: Props) {
  const t = useT();
  const { contentLocale: locale, locales } = useSession();
  const [pages, setPages] = useState<Page[]>([]);
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState<{ page: number; box: Omit<PaperAnchor, 'page'> } | null>(
    null,
  );
  const sources = definition.paper?.sources ?? [];
  const sourceKeys = sources.map((s) => s.key).join(',');
  /**
   * What is on screen and what it holds open — a ref, not state, because disposing it is a side
   * effect of the keys changing or the component leaving, never of a render.
   */
  const shown = useRef<{ keys: string; dispose: () => void } | null>(null);

  useEffect(() => {
    if (!saved || shown.current?.keys === sourceKeys) return;
    shown.current?.dispose();

    let cancelled = false;
    const opened: PaperPdf[] = [];
    const urls: string[] = [];
    shown.current = {
      keys: sourceKeys,
      dispose() {
        cancelled = true;
        for (const pdf of opened) void pdf.close();
        for (const url of urls) URL.revokeObjectURL(url);
      },
    };

    (async () => {
      const loaded: Page[] = [];
      for (const source of sources) {
        const blob = await client.paper(formId, source.key);
        if (source.key.endsWith('.pdf')) {
          const pdf = await openPdf(await blob.arrayBuffer(), loaded.length);
          opened.push(pdf);
          for (let index = 0; index < pdf.pageCount; index += 1)
            loaded.push({ kind: 'pdf', pdf, index });
        } else {
          const url = URL.createObjectURL(blob);
          urls.push(url);
          loaded.push({ kind: 'image', url });
        }
      }
      if (!cancelled) setPages(loaded);
    })().catch(() => {
      if (!cancelled) setFailed(true);
    });
    // The keys are the identity of the paper; the array is rebuilt on every edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formId, sourceKeys, saved]);

  useEffect(
    () => () => {
      shown.current?.dispose();
      // Cleared, not just disposed: StrictMode runs this and then mounts again, and a ref still
      // naming the keys would tell the second mount there is nothing to load.
      shown.current = null;
    },
    [],
  );

  const selected = definition.fields.find((field) => field.id === selectedId) ?? null;

  function update(field: Field) {
    onChange({
      ...definition,
      fields: definition.fields.map((existing) => (existing.id === field.id ? field : existing)),
    });
  }

  async function add(type: FieldType) {
    if (!pending) return;
    const field = newField(
      type,
      definition.fields.map((f) => f.key),
      locale,
    );
    const page = pages[pending.page];
    const suggested =
      page?.kind === 'pdf' ? labelNear(pending.box, await page.pdf.text(page.index)) : undefined;
    const placed: Field = {
      ...field,
      ...(suggested && hasLabel(field) ? { label: { [locale]: suggested } } : {}),
      paper: { page: pending.page, ...pending.box },
    };
    onChange({ ...definition, fields: [...definition.fields, placed] });
    onSelect(placed.id);
    setPending(null);
  }

  function nudge(field: Field, event: ReactKeyboardEvent) {
    if (!field.paper) return;
    const delta: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const step = delta[event.key];
    if (!step) return;
    event.preventDefault();
    const [dx, dy] = step;
    const box = event.shiftKey
      ? { ...field.paper, w: field.paper.w + dx * NUDGE, h: field.paper.h + dy * NUDGE }
      : { ...field.paper, x: field.paper.x + dx * NUDGE, y: field.paper.y + dy * NUDGE };
    update({ ...field, paper: clampAnchor(box) });
  }

  if (failed) return <p className="status-down small">{t('paper.notReadable')}</p>;

  return (
    <div className="paper stack">
      <p className="small muted">{t('paper.draw')}</p>
      {pages.map((page, index) => (
        <PaperPage
          key={index}
          page={page}
          index={index}
          fields={definition.fields.filter((field) => field.paper?.page === index)}
          selectedId={selectedId}
          onSelect={onSelect}
          onDraw={(box) => setPending({ page: index, box })}
          onMove={(field, box) => update({ ...field, paper: { page: index, ...box } })}
          onNudge={nudge}
          pending={pending?.page === index ? pending.box : null}
          picker={
            pending?.page === index ? (
              <div
                className="paper__picker card stack"
                role="dialog"
                aria-label={t('paper.pickType')}
              >
                <strong className="small">{t('paper.pickType')}</strong>
                <div className="builder__palette">
                  {DRAWABLE.map((type) => (
                    <button
                      key={type}
                      type="button"
                      className="button button--quiet small"
                      onClick={() => void add(type)}
                    >
                      <Icon name={type} />
                      {t(`fieldType.${type}`)}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className="button button--quiet small"
                  onClick={() => setPending(null)}
                >
                  {t('import.cancel')}
                </button>
              </div>
            ) : null
          }
          label={(field) =>
            hasLabel(field) ? pickText(locales, field.label, locale).value : field.key
          }
        />
      ))}
      {selected && <div className="card">{renderEditor(selected)}</div>}
    </div>
  );
}

function PaperPage({
  page,
  index,
  fields,
  selectedId,
  onSelect,
  onDraw,
  onMove,
  onNudge,
  pending,
  picker,
  label,
}: {
  page: Page;
  index: number;
  fields: Field[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onDraw: (box: Omit<PaperAnchor, 'page'>) => void;
  onMove: (field: Field, box: Omit<PaperAnchor, 'page'>) => void;
  onNudge: (field: Field, event: ReactKeyboardEvent) => void;
  pending: Omit<PaperAnchor, 'page'> | null;
  picker: ReactNode;
  label: (field: Field) => string;
}) {
  const t = useT();
  const surface = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);

  // Draw the PDF page at whatever width the pane is, and again when that changes.
  useEffect(() => {
    if (page.kind !== 'pdf' || !canvas.current || !surface.current) return;
    const element = canvas.current;
    let drawn = 0;
    const draw = (width: number) => {
      width = Math.round(width);
      if (width > 0 && width !== drawn) {
        drawn = width;
        void page.pdf.render(page.index, width, element);
      }
    };
    // Once now, from layout, rather than waiting for the observer: it reports during rendering,
    // and a tab in the background is not rendering.
    draw(surface.current.clientWidth);
    const observer = new ResizeObserver(([entry]) => draw(entry?.contentRect.width ?? 0));
    observer.observe(surface.current);
    return () => observer.disconnect();
  }, [page]);

  function fraction(event: ReactPointerEvent): { x: number; y: number } {
    const rect = surface.current!.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
    };
  }

  function start(event: ReactPointerEvent, drag: DistributiveOmit<Drag, 'from' | 'to'>) {
    if (event.button !== 0) return;
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    const at = fraction(event);
    setDrag({ ...drag, from: at, to: at } as Drag);
  }

  function move(event: ReactPointerEvent) {
    if (drag) setDrag({ ...drag, to: fraction(event) });
  }

  function end() {
    if (!drag) return;
    setDrag(null);
    const box = result(drag);
    if (drag.kind === 'draw') {
      // A click is a click; a box needs some size before it is a question.
      if (box.w > 0.01 && box.h > 0.005) onDraw(box);
      return;
    }
    onMove(drag.field, box);
  }

  const ghost = drag ? result(drag) : pending;

  return (
    <div className="paper__page stack">
      <span className="small muted">{t('paper.page', { n: index + 1 })}</span>
      <div
        ref={surface}
        className="paper__surface"
        onPointerDown={(event) => {
          if (
            event.target === surface.current ||
            event.target === canvas.current ||
            (event.target as HTMLElement).tagName === 'IMG'
          ) {
            onSelect(null);
            start(event, { kind: 'draw' });
          }
        }}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={() => setDrag(null)}
      >
        {page.kind === 'pdf' ? (
          <canvas ref={canvas} className="paper__image" />
        ) : (
          <img src={page.url} alt="" className="paper__image" draggable={false} />
        )}

        {fields.map((field) => {
          if (!field.paper) return null;
          const box =
            drag && drag.kind !== 'draw' && drag.field.id === field.id ? result(drag) : field.paper;
          const name = label(field);
          return (
            <button
              key={field.id}
              type="button"
              className={cn('paper__box', field.id === selectedId && 'paper__box--selected')}
              style={style(box)}
              title={name}
              aria-pressed={field.id === selectedId}
              onPointerDown={(event) => {
                onSelect(field.id);
                start(event, { kind: 'move', field, origin: field.paper! });
              }}
              onKeyDown={(event) => onNudge(field, event)}
            >
              <span className="paper__box-label">
                <Icon name={field.type} />
                {name}
              </span>
              <span
                className="paper__handle"
                onPointerDown={(event) => {
                  event.stopPropagation();
                  onSelect(field.id);
                  start(event, { kind: 'resize', field, origin: field.paper! });
                }}
              />
            </button>
          );
        })}

        {ghost && (drag?.kind === 'draw' || pending) && (
          <div className="paper__box paper__box--ghost" style={style(ghost)} aria-hidden />
        )}
        {picker}
      </div>
    </div>
  );
}

type Point = { x: number; y: number };
/** `Omit` over a union, member by member, rather than over their intersection. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type Drag =
  | { kind: 'draw'; from: Point; to: Point }
  | { kind: 'move' | 'resize'; field: Field; origin: PaperAnchor; from: Point; to: Point };

/** Where a drag has got to, as a box. */
export function result(drag: Drag): Omit<PaperAnchor, 'page'> {
  const dx = drag.to.x - drag.from.x;
  const dy = drag.to.y - drag.from.y;
  switch (drag.kind) {
    case 'draw':
      return clampAnchor({
        x: Math.min(drag.from.x, drag.to.x),
        y: Math.min(drag.from.y, drag.to.y),
        w: Math.abs(dx),
        h: Math.abs(dy),
      });
    case 'move':
      return clampAnchor({ ...drag.origin, x: drag.origin.x + dx, y: drag.origin.y + dy });
    case 'resize':
      return clampAnchor({ ...drag.origin, w: drag.origin.w + dx, h: drag.origin.h + dy });
  }
}

/** Kept on the page, and never smaller than a fingertip can find again. */
export function clampAnchor<A extends Omit<PaperAnchor, 'page'>>(box: A): A {
  const w = Math.min(1, Math.max(0.01, box.w));
  const h = Math.min(1, Math.max(0.005, box.h));
  return {
    ...box,
    w,
    h,
    x: Math.min(1 - w, Math.max(0, box.x)),
    y: Math.min(1 - h, Math.max(0, box.y)),
  };
}

function style(box: Omit<PaperAnchor, 'page'>) {
  return {
    left: `${box.x * 100}%`,
    top: `${box.y * 100}%`,
    width: `${box.w * 100}%`,
    height: `${box.h * 100}%`,
  };
}
