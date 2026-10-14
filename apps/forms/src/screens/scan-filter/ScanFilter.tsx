import { useEffect, useRef, useState } from 'react';
import { useT } from '../../lib/i18n.js';
import { estimateSkew } from './deskew.js';
import { DEFAULT_STRENGTH, FILTERS, suggestFilter, type FilterId } from './image-filters.js';
import { originalOf, remember } from './originals.js';
import { make, openBitmap, paint, pixelsOf, process } from './render.js';
import { Slider } from '../../components/Slider.js';

const THUMB_SIDE = 160;
const PREVIEW_SIDE = 560;

interface Ready {
  bitmap: ImageBitmap;
  suggested: FilterId;
  /** Degrees to turn the page clockwise to level it; 0 when it is level or there is nothing to go by. */
  skew: number;
}

/**
 * The filters for one photographed page (lazy: the first time the person asks for them). The page
 * is drawn in each filter beside the others and large in the chosen one, so what is kept is always
 * what was seen; Apply makes the full-size picture once and hands it back as the page's file.
 * "Clean document" is preselected, and marked as suggested, only when the page looks like text on
 * paper; either way nothing changes until Apply.
 */
export default function ScanFilter({
  number,
  file,
  onApply,
  onClose,
}: {
  number: number;
  file: File;
  onApply: (made: File) => void;
  onClose: () => void;
}) {
  const t = useT();
  const original = originalOf(file);
  const [ready, setReady] = useState<Ready | null>(null);
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState<FilterId>('original');
  const [strength, setStrength] = useState(DEFAULT_STRENGTH);
  const [straighten, setStraighten] = useState(false);
  const [thumbs, setThumbs] = useState<Partial<Record<FilterId, string>>>({});
  const [busy, setBusy] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const preview = useRef<HTMLCanvasElement>(null);
  const small = useRef<ReturnType<typeof pixelsOf> | null>(null);
  const large = useRef<ReturnType<typeof pixelsOf> | null>(null);

  useEffect(() => panel.current?.focus(), []);

  // Open the photograph, find whether it is text on paper and how far it is tilted.
  useEffect(() => {
    let cancelled = false;
    let opened: ImageBitmap | null = null;
    openBitmap(original).then(
      (bitmap) => {
        if (cancelled) return bitmap.close();
        opened = bitmap;
        small.current = pixelsOf(bitmap, THUMB_SIDE);
        large.current = pixelsOf(bitmap, PREVIEW_SIDE);
        const suggested = suggestFilter(large.current);
        setReady({ bitmap, suggested, skew: estimateSkew(large.current).angle });
        setFilter(suggested);
      },
      () => !cancelled && setFailed(true),
    );
    return () => {
      cancelled = true;
      opened?.close();
    };
  }, [original]);

  // What each choice would look like, and the chosen one large.
  useEffect(() => {
    if (!ready || !small.current || !large.current) return;
    const turn = straighten ? ready.skew : 0;
    const canvas = document.createElement('canvas');
    const next: Partial<Record<FilterId, string>> = {};
    for (const id of FILTERS) {
      paint(process(small.current, { filter: id, strength, straighten: turn }), canvas);
      next[id] = canvas.toDataURL('image/png');
    }
    setThumbs(next);
    if (preview.current) {
      paint(process(large.current, { filter, strength, straighten: turn }), preview.current);
    }
  }, [ready, filter, strength, straighten]);

  async function apply() {
    if (!ready) return;
    const turn = straighten ? ready.skew : 0;
    // Original, as it was taken: the photograph itself goes back, not a copy of it.
    if (filter === 'original' && turn === 0) return onApply(original);
    setBusy(true);
    try {
      const made = await make(ready.bitmap, { filter, strength, straighten: turn }, original.name);
      remember(made, original);
      onApply(made);
    } catch {
      setFailed(true);
      setBusy(false);
    }
  }

  const labels: Record<FilterId, string> = {
    original: t('scan.filter.original'),
    enhanced: t('scan.filter.enhanced'),
    grey: t('scan.filter.grey'),
    bw: t('scan.filter.bw'),
    clean: t('scan.filter.clean'),
  };

  return (
    <div
      ref={panel}
      tabIndex={-1}
      className="scan-filter stack"
      role="region"
      aria-label={t('scan.filter.legend', { n: number })}
      onKeyDown={(event) => event.key === 'Escape' && onClose()}
    >
      {failed ? (
        <p className="status-warning" role="alert">
          {t('scan.filter.failed')}
        </p>
      ) : null}
      {ready ? (
        <>
          <div className="scan-filter__body">
            <canvas
              ref={preview}
              className="scan-filter__preview"
              role="img"
              aria-label={t('scan.filter.preview', { n: number })}
            />
            <div className="stack">
              <fieldset className="scan-filter__choices">
                <legend className="small">{t('scan.filter.legend', { n: number })}</legend>
                {FILTERS.map((id) => (
                  <label key={id} className="scan-filter__choice">
                    <input
                      type="radio"
                      name={`scan-filter-${number}`}
                      checked={filter === id}
                      onChange={() => setFilter(id)}
                    />
                    {thumbs[id] ? <img src={thumbs[id]} alt="" /> : null}
                    <span>
                      {labels[id]}
                      {id === ready.suggested && id !== 'original' ? (
                        <span className="small muted"> · {t('scan.filter.suggested')}</span>
                      ) : null}
                    </span>
                  </label>
                ))}
              </fieldset>
              {ready.suggested === 'clean' ? (
                <p className="small muted">{t('scan.filter.suggestion')}</p>
              ) : null}
              <Slider
                label={t('scan.filter.strength')}
                min={0}
                max={100}
                step={5}
                suffix="%"
                disabled={filter === 'original'}
                value={Math.round(strength * 100)}
                onChange={(value) => setStrength(value / 100)}
              />
              {ready.skew !== 0 ? (
                <label className="row">
                  <input
                    type="checkbox"
                    checked={straighten}
                    onChange={(event) => setStraighten(event.target.checked)}
                  />
                  {t('scan.filter.straighten', { degrees: Math.abs(ready.skew).toFixed(1) })}
                </label>
              ) : null}
            </div>
          </div>
        </>
      ) : failed ? null : (
        <p role="status" className="muted small">
          {t('scan.filter.working')}
        </p>
      )}
      <div className="row">
        <button
          type="button"
          className="button"
          disabled={!ready || busy}
          onClick={() => void apply()}
        >
          {busy ? t('scan.filter.working') : t('scan.filter.apply')}
        </button>
        {original !== file ? (
          <button type="button" className="button button--quiet" onClick={() => onApply(original)}>
            {t('scan.filter.restore')}
          </button>
        ) : null}
        <button type="button" className="button button--quiet" onClick={onClose}>
          {t('confirm.cancel')}
        </button>
      </div>
    </div>
  );
}
