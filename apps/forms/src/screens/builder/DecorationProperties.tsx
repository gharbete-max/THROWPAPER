import { SHAPE_KINDS, type Field } from '@tp/shared/forms';
import { useT } from '../../lib/i18n.js';
import { ColourChoice } from '../../components/ColourChoice.js';
import { DrawingPad } from '../../components/DrawingPad.js';
import { Slider } from '../../components/Slider.js';

/**
 * The property panel for a shape or a drawing.
 *
 * Split out of `FieldProperties` rather than added to it. That panel is a long chain of "does
 * this field type have this property", and decoration shares almost none of them — no label, no
 * help text, no placeholder, nothing required. Folding it in would have meant a dozen more
 * conditions that are false for every other field in the product.
 */
export function DecorationProperties({
  field,
  patch,
}: {
  field: Extract<Field, { type: 'shape' | 'drawing' }>;
  patch: (changes: Partial<Field>) => void;
}) {
  const t = useT();

  return (
    <div className="stack">
      {/*
        Said once, at the top: this collects nothing. An author who drops a rectangle between two
        questions can reasonably wonder whether it becomes a column in the export, and the answer
        is the reason decoration is built this way at all.
      */}
      <p className="small muted">{t('decoration.note')}</p>

      {/*
        The colour hint sits here rather than under each picker. A shape has two of them, and the
        same sentence twice in one panel reads as a mistake — it is a fact about how colours work
        in this product, not about this particular control.
      */}
      <p className="small muted">{t('field.colourHint')}</p>

      {field.type === 'shape' && (
        <>
          <label className="field">
            <span>{t('field.shapeKind')}</span>
            <select
              value={field.kind}
              onChange={(event) => patch({ kind: event.target.value } as Partial<Field>)}
            >
              {SHAPE_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {t(`field.shapeKind.${kind}`)}
                </option>
              ))}
            </select>
          </label>

          {/* A line has no inside, so offering a fill for one would be offering nothing. */}
          {(field.kind === 'rectangle' || field.kind === 'ellipse') && (
            <ColourChoice
              label={t('field.fill')}
              value={field.fill}
              allowNone
              onChange={(fill) => patch({ fill } as Partial<Field>)}
            />
          )}

          <ColourChoice
            label={t('field.stroke')}
            value={field.stroke}
            allowNone={field.kind === 'rectangle' || field.kind === 'ellipse'}
            onChange={(stroke) => patch({ stroke } as Partial<Field>)}
          />

          <Slider
            label={t('field.strokeWidth')}
            min={0}
            max={24}
            value={field.strokeWidth}
            onChange={(strokeWidth) => patch({ strokeWidth } as Partial<Field>)}
          />

          {field.kind === 'rectangle' && (
            <Slider
              label={t('field.radius')}
              min={0}
              max={64}
              value={field.radius}
              onChange={(radius) => patch({ radius } as Partial<Field>)}
            />
          )}

          <label className="field">
            <span>{t('field.shapeHeight')}</span>
            <input
              type="number"
              min={2}
              max={600}
              value={field.height}
              onChange={(event) =>
                // Clamped rather than trusted: the schema refuses anything outside this, and a
                // rejected save two screens later is a poor way to learn about a typo.
                patch({
                  height: Math.min(600, Math.max(2, Number(event.target.value) || 2)),
                } as Partial<Field>)
              }
            />
          </label>

          <label className="field field--inline">
            <input
              type="checkbox"
              checked={field.dashed}
              onChange={(event) => patch({ dashed: event.target.checked } as Partial<Field>)}
            />
            <span>{t('field.dashed')}</span>
          </label>
        </>
      )}

      {field.type === 'drawing' && (
        <>
          {/*
            The proportions of the drawing area, and it locks the moment there is a stroke.

            The paths are stored in this coordinate space, so changing it under an existing
            drawing would stretch what somebody drew — a signature that no longer looks like
            theirs, from a control that gave no hint it would do that. Choosing the shape first
            and locking it after is the honest version: nothing silently distorts, and clearing
            is an obvious way back.
          */}
          <label className="field">
            <span>{t('field.drawArea')}</span>
            <select
              value={areaOf(field)}
              disabled={field.paths.length > 0}
              onChange={(event) => {
                const area = DRAW_AREAS[event.target.value as DrawArea];
                patch({
                  viewBoxWidth: area.width,
                  viewBoxHeight: area.height,
                } as Partial<Field>);
              }}
            >
              {(Object.keys(DRAW_AREAS) as DrawArea[]).map((area) => (
                <option key={area} value={area}>
                  {t(`field.drawArea.${area}`)}
                </option>
              ))}
            </select>
            {field.paths.length > 0 && (
              <span className="small muted">{t('field.drawAreaLocked')}</span>
            )}
          </label>

          <ColourChoice
            label={t('field.stroke')}
            value={field.stroke}
            onChange={(stroke) => patch({ stroke } as Partial<Field>)}
          />

          <Slider
            label={t('field.strokeWidth')}
            min={1}
            max={24}
            value={field.strokeWidth}
            onChange={(strokeWidth) => patch({ strokeWidth } as Partial<Field>)}
          />

          <DrawingPad
            paths={field.paths}
            onChange={(paths) => patch({ paths } as Partial<Field>)}
            stroke={field.stroke}
            strokeWidth={field.strokeWidth}
            viewBoxWidth={field.viewBoxWidth}
            viewBoxHeight={field.viewBoxHeight}
            hint={t('draw.hint')}
          />
        </>
      )}
    </div>
  );
}

/**
 * The shapes a drawing area can take.
 *
 * Three presets rather than two number boxes. The numbers are a coordinate space — nobody thinks
 * "my doodle is 1000 units wide" — and what an author actually wants to say is whether they are
 * drawing a signature strip, a sketch or something upright.
 *
 * `wide` is the default in `field-defaults.ts`, so a drawing dropped on a form and never touched
 * lands here rather than on nothing.
 */
const DRAW_AREAS = {
  wide: { width: 1000, height: 300 },
  square: { width: 1000, height: 1000 },
  tall: { width: 600, height: 1000 },
} as const;

type DrawArea = keyof typeof DRAW_AREAS;

/** Which preset a drawing is on. An imported one that matches none reads as the closest ratio. */
function areaOf(field: Extract<Field, { type: 'drawing' }>): DrawArea {
  const ratio = field.viewBoxWidth / field.viewBoxHeight;
  let best: DrawArea = 'wide';
  let distance = Infinity;
  for (const [name, area] of Object.entries(DRAW_AREAS) as [
    DrawArea,
    { width: number; height: number },
  ][]) {
    const gap = Math.abs(area.width / area.height - ratio);
    if (gap < distance) {
      distance = gap;
      best = name;
    }
  }
  return best;
}
