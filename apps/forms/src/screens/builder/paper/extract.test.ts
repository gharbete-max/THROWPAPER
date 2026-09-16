import { describe, expect, it } from 'vitest';
import { importAcroFields, type AcroField } from '@tp/shared/forms';
import { anchorFor, labelNear, mergeWidgets, type Widget } from './extract.js';
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
