import { useEffect, useMemo, useRef, useState } from 'react';
import type { IrLine, LayoutDocument } from '@tp/shared/import';
import { useT } from '../../../lib/i18n.js';
import type { PaperPdf } from '../paper/extract.js';
import type { ReviewItem } from './review.js';

/**
 * The document, as it was read — `IMPORT-PIPELINE.md` §8, "the document on the left, with every
 * read span highlighted by bucket". A PDF is its own pages, each line a box over the page where it
 * was printed; a Word file or a paste, which have no pages to show, are their lines in reading
 * order. Pressing a line selects the item it was read into, and the selected item's lines are
 * marked here: the link is `lineIds`, both ways.
 *
 * The lines are buttons for the pointer only (`tabIndex={-1}`): by keyboard, the items on the
 * right are the way through, one stop per item rather than one per line.
 */
export function SourcePane({
  layout,
  pdf,
  items,
  selectedId,
  onSelect,
}: {
  layout: LayoutDocument;
  pdf: PaperPdf | null;
  items: readonly ReviewItem[];
  selectedId: string | null;
  onSelect: (itemId: string) => void;
}) {
  const t = useT();
  const pane = useRef<HTMLDivElement>(null);
  // A line in two items (two questions read from one line) belongs to the first, as `itemOfLine`.
  const itemOf = useMemo(() => {
    const map = new Map<string, ReviewItem>();
    for (const item of items) {
      for (const line of item.lineIds) if (!map.has(line)) map.set(line, item);
    }
    return map;
  }, [items]);

  // The selected item's first line into view, however it was selected.
  useEffect(() => {
    const item = items.find((candidate) => candidate.id === selectedId);
    const first = item?.lineIds[0];
    if (!first || !pane.current) return;
    pane.current
      .querySelector<HTMLElement>(`[data-line="${CSS.escape(first)}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [selectedId, items]);

  const lineButton = (line: IrLine, style?: React.CSSProperties) => {
    const item = itemOf.get(line.id);
    const state = !item ? 'none' : item.decided ? 'settled' : item.bucket;
    const selected = item !== undefined && item.id === selectedId;
    return (
      <button
        key={line.id}
        type="button"
        tabIndex={-1}
        data-line={line.id}
        className={`review-line review-line--${state}${selected ? ' review-line--selected' : ''}`}
        style={style}
        disabled={!item}
        onClick={() => item && onSelect(item.id)}
      >
        {pdf ? <span className="visually-hidden">{line.text}</span> : line.text}
      </button>
    );
  };

  return (
    <section className="review-source" aria-label={t('review.source')} ref={pane}>
      {layout.pages.map((page, index) =>
        pdf ? (
          <PdfPage key={page.pageNo} pdf={pdf} index={index}>
            {page.blocks.flatMap((block) =>
              block.lines.map((line) =>
                lineButton(line, {
                  left: `${line.box.x0 / 100}%`,
                  top: `${line.box.y0 / 100}%`,
                  width: `${(line.box.x1 - line.box.x0) / 100}%`,
                  height: `${(line.box.y1 - line.box.y0) / 100}%`,
                }),
              ),
            )}
          </PdfPage>
        ) : (
          <div key={page.pageNo} className="review-source__text">
            {page.blocks.map((block) => (
              <div key={block.id} className="review-source__block">
                {block.lines.map((line) => lineButton(line))}
              </div>
            ))}
          </div>
        ),
      )}
    </section>
  );
}

/** One PDF page, drawn at the width it is given, with the lines laid over it. */
function PdfPage({
  pdf,
  index,
  children,
}: {
  pdf: PaperPdf;
  index: number;
  children: React.ReactNode;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const measure = () => setWidth(Math.round(element.clientWidth));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (width === 0 || !canvas.current) return;
    // A new width cancels the drawing still under way, before this one starts on the same canvas.
    // A page still drawing when its document is closed (another one read, or the screen left)
    // fails its render: nothing is waiting for that picture any more.
    const drawing = new AbortController();
    pdf.render(index, width, canvas.current, drawing.signal).catch(() => {});
    return () => drawing.abort();
  }, [pdf, index, width]);

  return (
    <div className="review-page" ref={frame}>
      <canvas ref={canvas} className="review-page__image" aria-hidden="true" />
      <div className="review-page__lines">{children}</div>
    </div>
  );
}
