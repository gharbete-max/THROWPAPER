import type { DecorationColour, Field } from '@tp/shared/forms';

/**
 * Shapes and freehand drawings on a form.
 *
 * Both are **decoration**: they collect nothing, so they are presentational field types, which is
 * what keeps the CSV export unchanged — `answerableFields` already excludes presentational types,
 * so a form covered in boxes and arrows exports exactly the columns a bare one does.
 *
 * Everything here is `aria-hidden`. A decorative shape has no accessible name because it says
 * nothing a reader needs, and announcing "graphic" twelve times on the way down a form is worse
 * than silence. Anything that carries meaning belongs in a text block, where it can be read aloud,
 * searched, and translated.
 */

/**
 * A decoration colour resolved to something CSS can paint.
 *
 * Token names become `var(--tp-colour-…)`, so a form built without touching a colour picker
 * follows the brand kit and restyling the organisation restyles its decorations with it. A hex
 * literal is the author's deliberate opt-out and is passed through as-is.
 *
 * `none` returns null rather than the string "none": a border with no colour is no border, and
 * `border-color: none` is simply invalid.
 */
function paint(colour: DecorationColour): string | null {
  if (colour === 'none') return null;
  return colour.startsWith('#') ? colour : `var(--tp-colour-${colour})`;
}

/**
 * Shapes are CSS boxes, not SVG.
 *
 * They were SVG first, on a `0 0 100 100` viewBox stretched to the row with
 * `preserveAspectRatio="none"`, and that stretch is the problem: `rx` scales with it, so a 4px
 * corner radius came out 11px wide and 3px tall on a full-width row, and the half-stroke inset
 * was off by the same factor. `vector-effect` fixes the stroke and nothing else.
 *
 * A rectangle with a border and a radius is what CSS is for, and it gets both exactly right at
 * any width. Only the arrowhead is a shape CSS has no primitive for, and that is a rotated corner.
 */
export function ShapeField({ field }: { field: Extract<Field, { type: 'shape' }> }) {
  const stroke = paint(field.stroke);
  const fill = paint(field.fill);
  const style = field.dashed ? 'dashed' : 'solid';

  if (field.kind === 'rectangle' || field.kind === 'ellipse') {
    return (
      <div
        className="decoration"
        aria-hidden="true"
        style={{
          blockSize: `${field.height}px`,
          background: fill ?? 'none',
          // `50%` on each corner is an ellipse, whatever the box's proportions.
          borderRadius: field.kind === 'ellipse' ? '50%' : `${field.radius}px`,
          ...(stroke && field.strokeWidth > 0
            ? { border: `${field.strokeWidth}px ${style} ${stroke}` }
            : {}),
        }}
      />
    );
  }

  // Line, divider and arrow: a rule across the row, vertically centred in whatever height it has.
  return (
    <div
      className="decoration decoration--rule"
      aria-hidden="true"
      style={{ blockSize: `${field.height}px` }}
    >
      <span
        className="decoration__line"
        style={{
          borderBlockStartWidth: `${field.strokeWidth}px`,
          borderBlockStartStyle: style,
          borderBlockStartColor: stroke ?? 'transparent',
        }}
      />
      {field.kind === 'arrow' && (
        <span
          className="decoration__head"
          style={{
            // A square with two sides drawn, turned 45° — the chevron every arrow ends in.
            inlineSize: `${field.strokeWidth * 3}px`,
            blockSize: `${field.strokeWidth * 3}px`,
            borderBlockStartWidth: `${field.strokeWidth}px`,
            borderInlineEndWidth: `${field.strokeWidth}px`,
            borderColor: stroke ?? 'transparent',
            // Half the head's own width, so the shaft runs into the chevron instead of stopping
            // at the empty corner of its bounding box.
            marginInlineStart: `${-field.strokeWidth * 1.5}px`,
          }}
        />
      )}
    </div>
  );
}

export function DrawingField({ field }: { field: Extract<Field, { type: 'drawing' }> }) {
  // Nothing drawn yet renders nothing, rather than an empty box that looks like a broken image.
  if (field.paths.length === 0) return null;
  const stroke = paint(field.stroke);

  return (
    <svg
      className="decoration decoration--drawing"
      viewBox={`0 0 ${field.viewBoxWidth} ${field.viewBoxHeight}`}
      /**
       * Aspect ratio preserved here, unlike a shape. A shape is a frame and may stretch; a drawing
       * is somebody's handwriting, and stretching handwriting is the one thing that makes it stop
       * looking like theirs.
       */
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
      focusable="false"
    >
      {field.paths.map((d, index) => (
        <path
          // The index is the identity: strokes are append-only and never reordered, so a stroke's
          // position in the array is stable for as long as it exists.
          key={index}
          d={d}
          fill="none"
          stroke={stroke ?? 'transparent'}
          strokeWidth={field.strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </svg>
  );
}
