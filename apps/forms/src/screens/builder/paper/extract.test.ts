import { describe, expect, it } from 'vitest';
import { importAcroFields, type AcroField } from '@tp/shared/forms';
import {
  anchorFor,
  fontLook,
  horizontalRules,
  labelNear,
  mergeWidgets,
  runWords,
  type Ops,
  type Widget,
} from './extract.js';
import { clampAnchor, result } from './PaperCanvas.js';

/** A4 in PDF points. */
const PAGE = { width: 595, height: 842 };
const anchor = (rect: number[]) => anchorFor(rect, PAGE);

function widget(over: Partial<Widget>): Widget {
  return { subtype: 'Widget', fieldType: 'Tx', fieldName: 'f', rect: [50, 700, 250, 720], ...over };
}

describe('reading the widgets on a page', () => {
  it('folds a radio group into one field with an option per button', () => {
    const fields: AcroField[] = [];
    mergeWidgets(
      fields,
      [
        widget({
          fieldType: 'Btn',
          fieldName: 'member',
          radioButton: true,
          buttonValue: 'yes',
          rect: [50, 100, 60, 110],
        }),
        widget({
          fieldType: 'Btn',
          fieldName: 'member',
          radioButton: true,
          buttonValue: 'no',
          rect: [150, 100, 160, 110],
        }),
        widget({ fieldType: 'Btn', fieldName: 'submit', pushButton: true }),
        widget({ fieldType: 'Tx', fieldName: 'name', alternativeText: 'Full name', maxLen: 40 }),
      ],
      3,
      anchor,
    );

    expect(fields.map((f) => [f.name, f.type])).toEqual([
      ['member', 'radio'],
      ['submit', 'button'],
      ['name', 'text'],
    ]);
    // Each button keeps its own box, so a tick can land on the one that was chosen.
    expect(fields[0]!.options?.map((o) => [o.value, o.label, o.paper?.page])).toEqual([
      ['yes', 'yes', 3],
      ['no', 'no', 3],
    ]);
    expect(fields[0]!.options?.[1]?.paper?.x).toBeCloseTo(150 / 595);
    // The group's anchor spans both buttons.
    expect(fields[0]!.paper?.page).toBe(3);
    expect(fields[0]!.paper?.x).toBeCloseTo(50 / 595);
    expect(fields[0]!.paper?.w).toBeCloseTo(110 / 595);
    expect(fields[2]).toMatchObject({ label: 'Full name', charLimit: 40, paper: { page: 3 } });

    // And the anchor survives the mapping into a form.
    const { definition, skipped } = importAcroFields(fields);
    expect(definition.fields.map((f) => f.paper?.page)).toEqual([3, 3]);
    expect(skipped).toEqual([{ name: 'submit', type: 'button', reason: 'no-answer' }]);
  });

  it('ignores anything that is not a form widget', () => {
    const fields: AcroField[] = [];
    mergeWidgets(fields, [widget({ subtype: 'Link' }), widget({ fieldType: null })], 0, anchor);
    expect(fields).toEqual([]);
  });
});

describe('anchors', () => {
  it('are fractions of the page whichever corner comes first', () => {
    expect(anchorFor([250, 720, 50, 700], PAGE)).toEqual(anchorFor([50, 700, 250, 720], PAGE));
    expect(anchorFor([0, 0, 595, 842], PAGE)).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });

  it('stay on the page when nudged or dragged past its edge', () => {
    expect(clampAnchor({ x: 0.95, y: 0.99, w: 0.2, h: 0.05 })).toEqual({
      x: 0.8,
      y: 0.95,
      w: 0.2,
      h: 0.05,
    });
    const origin = { page: 0, x: 0.1, y: 0.1, w: 0.2, h: 0.05 };
    const field = { id: 'a' } as never;
    const moved = result({
      kind: 'move',
      field,
      origin,
      from: { x: 0.5, y: 0.5 },
      to: { x: 0.6, y: 0.3 },
    });
    expect(moved.x).toBeCloseTo(0.2);
    expect(moved.y).toBe(0); // Dragged 0.2 up from 0.1: pinned to the top edge.
    const drawn = result({ kind: 'draw', from: { x: 0.6, y: 0.4 }, to: { x: 0.5, y: 0.5 } });
    expect(drawn.x).toBeCloseTo(0.5);
    expect(drawn.w).toBeCloseTo(0.1);
  });
});

describe('a label for a drawn box', () => {
  const runs = [
    { text: 'Name', x: 0.05, y: 0.1, w: 0.06, h: 0.02 },
    { text: 'Email', x: 0.05, y: 0.15, w: 0.07, h: 0.02 },
    { text: 'Comments', x: 0.05, y: 0.3, w: 0.1, h: 0.02 },
  ];

  it('is the printed text just left of the box, verbatim', () => {
    expect(labelNear({ x: 0.15, y: 0.148, w: 0.3, h: 0.025 }, runs)).toBe('Email');
  });

  it('or the text just above it', () => {
    expect(labelNear({ x: 0.05, y: 0.33, w: 0.5, h: 0.1 }, runs)).toBe('Comments');
  });

  it('and nothing at all when nothing is near', () => {
    expect(labelNear({ x: 0.5, y: 0.8, w: 0.2, h: 0.05 }, runs)).toBeUndefined();
  });
});

describe('the text layer as words (CAVEATS #58)', () => {
  const regular = { fontWeight: 400 as const, italic: false };

  it('splits a run at its spaces and shares its width out by character', () => {
    // "1. Namn" is 7 characters over 119 points: 17 a character.
    const words = runWords(
      { text: '1. Namn', x0: 59.5, x1: 178.5, baseline: 84.2, size: 11 },
      PAGE,
      regular,
    );
    expect(words.map((w) => [w.text, w.box.x0, w.box.x1])).toEqual([
      ['1.', 1000, 1571],
      ['Namn', 1857, 3000],
    ]);
    // 11 pt on A4 is 131 iu; the baseline at 84.2 of 842 points is 1000.
    expect(words[0]).toMatchObject({ baseline: 1000, fontSize: 131, source: 'text-layer' });
    expect(words[0]!.box).toMatchObject({ y0: 895, y1: 1026 });
  });

  it('keeps runs of spaces, tabs and a leading space out of the words, and drops nothing else', () => {
    const words = runWords(
      { text: ' a\t\tbc  d ', x0: 0, x1: 100, baseline: 100, size: 10 },
      PAGE,
      regular,
    );
    expect(words.map((w) => w.text)).toEqual(['a', 'bc', 'd']);
    expect(
      runWords({ text: '   ', x0: 0, x1: 10, baseline: 100, size: 10 }, PAGE, regular),
    ).toEqual([]);
  });

  it('reads bold from the font, by its flags or its name', () => {
    expect(fontLook({ name: 'ABCDEF+Calibri-Bold' }).fontWeight).toBe(700);
    expect(fontLook({ name: 'Arial-BlackItalic' })).toEqual({ fontWeight: 700, italic: true });
    expect(fontLook({ name: 'Helvetica', bold: true }).fontWeight).toBe(700);
    expect(fontLook({ name: 'Times-Roman' })).toEqual({ fontWeight: 400, italic: false });
    expect(fontLook(undefined).fontWeight).toBe(400);
  });
});

describe('printed rules from the drawing operations', () => {
  // pdf.js's codes, as far as this reads them; the real ones come from `OPS` at runtime.
  const OPS: Ops = {
    save: 10,
    restore: 11,
    transform: 12,
    constructPath: 91,
    paintFormXObjectBegin: 74,
    paintFormXObjectEnd: 75,
    stroke: 20,
    closeStroke: 21,
    fill: 22,
    eoFill: 23,
    fillStroke: 24,
    eoFillStroke: 25,
    closeFillStroke: 26,
    closeEOFillStroke: 27,
  };
  // A4 at scale 1: y flipped, as pdf.js's viewport transform does it.
  const VIEWPORT = [1, 0, 0, -1, 0, 842];
  const path = (paint: number, ...segments: number[]) => [
    paint,
    [Float32Array.from(segments)],
    null,
  ];
  const rulesOf = (fnArray: number[], argsArray: unknown[]) =>
    horizontalRules({ fnArray, argsArray }, OPS, VIEWPORT, PAGE);

  it('finds a stroked answer line and the edges of a filled box, in iu', () => {
    const line = path(OPS.stroke, 0, 100, 742, 1, 400, 742);
    const box = path(OPS.fill, 0, 100, 500, 1, 400, 500, 1, 400, 520, 1, 100, 520, 4);
    expect(rulesOf([OPS.constructPath, OPS.constructPath], [line, box])).toEqual([
      { x0: 1681, y0: 1188, x1: 6723, y1: 1188 },
      { x0: 1681, y0: 4062, x1: 6723, y1: 4062 },
      { x0: 1681, y0: 3824, x1: 6723, y1: 3824 },
    ]);
  });

  it('ignores a path that is not painted, a short or slanted segment, and curves', () => {
    const clip = path(99, 0, 100, 742, 1, 400, 742);
    const short = path(OPS.stroke, 0, 100, 742, 1, 120, 742);
    const slanted = path(OPS.stroke, 0, 100, 742, 1, 400, 700);
    const curve = path(OPS.stroke, 0, 100, 742, 2, 200, 742, 300, 742, 400, 742);
    const f = OPS.constructPath;
    expect(rulesOf([f, f, f, f], [clip, short, slanted, curve])).toEqual([]);
  });

  it('follows the transformation matrix, and restores it', () => {
    const scaled = [OPS.save, OPS.transform, OPS.constructPath, OPS.restore, OPS.constructPath];
    const line = path(OPS.stroke, 0, 50, 421, 1, 200, 421);
    const rules = rulesOf(scaled, [null, [2, 0, 0, 1, 0, 0], line, null, line]);
    expect(rules.map((r) => [r.x0, r.x1])).toEqual([
      [1681, 6723],
      [840, 3361],
    ]);
  });
});
