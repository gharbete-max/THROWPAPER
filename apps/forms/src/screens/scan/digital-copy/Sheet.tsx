import { isUncertain, type DigitalCopy } from '@tp/shared/import';

/**
 * What a digital copy is made of, as the review shows it: a sheet of white paper, lines in black,
 * every word as text at its place. These two are the document's own colours, not the interface's
 * (the same as `scan-edit`): a page copy is white with black ink whatever theme it is looked at in.
 *
 * Only here, not in the saved copy, a word the reader was unsure of has a dashed underline, and the
 * word being fixed has a frame. Both are drawn with shapes, so neither depends on colour.
 */
export const PAPER = '#ffffff';
export const INK = '#000000';

interface Props {
  copy: DigitalCopy;
  label: string;
  selected: number | null;
  /** The accessible name of a word; the uncertain ones say so. */
  nameOf: (index: number) => string;
  onSelect: (index: number) => void;
}

export function Sheet({ copy, label, selected, nameOf, onSelect }: Props) {
  return (
    <svg
      className="copy__svg"
      viewBox={`0 0 ${copy.widthPt} ${copy.heightPt}`}
      role="group"
      aria-label={label}
      data-testid="copy-sheet"
    >
      <rect width={copy.widthPt} height={copy.heightPt} fill={PAPER} />
      <g stroke={INK} strokeLinecap="square" fill="none">
        {copy.lines.map((line, index) => (
          <line
            key={index}
            data-testid="copy-line"
            x1={line.x1}
            y1={line.y1}
            x2={line.x2}
            y2={line.y2}
            strokeWidth={line.width}
          />
        ))}
      </g>
      <g fill={INK} style={{ fontFamily: 'var(--tp-type-body-font)' }}>
        {copy.words.map((word, index) => {
          const unsure = isUncertain(word);
          return (
            <g key={index}>
              {index === selected ? (
                <rect
                  className="copy__selected"
                  x={word.x - 2}
                  y={word.y - word.size}
                  width={Math.max(1, word.w) + 4}
                  height={word.size * 1.3}
                  fill="none"
                />
              ) : null}
              {unsure ? (
                <line
                  className="copy__doubt"
                  x1={word.x}
                  y1={word.y + 2}
                  x2={word.x + Math.max(1, word.w)}
                  y2={word.y + 2}
                />
              ) : null}
              <text
                className="copy__word"
                data-testid="copy-word"
                data-unsure={unsure ? 'true' : undefined}
                x={word.x}
                y={word.y}
                fontSize={word.size}
                textLength={Math.max(1, word.w)}
                lengthAdjust="spacingAndGlyphs"
                role="button"
                // Only the uncertain words are in the tab order; the buttons beside the sheet step
                // through every word, so a page of hundreds is not hundreds of tab stops.
                tabIndex={unsure ? 0 : -1}
                aria-label={nameOf(index)}
                aria-pressed={index === selected}
                onClick={() => onSelect(index)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onSelect(index);
                  }
                }}
              >
                {word.text}
              </text>
            </g>
          );
        })}
      </g>
    </svg>
  );
}
