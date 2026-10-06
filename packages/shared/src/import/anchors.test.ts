import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { answerBox, gridBoxes, optionBoxes, paperAnchor, type PageBox } from './anchors.js';
import type { Box, IrLine, LayoutDocument } from './ir/types.js';
import { parseLayoutDocument } from './ir/validate.js';
import { blankRuns, isBlankWord, isCheckboxWord, textHints } from './layout/hints.js';
import { pasteDocument } from './paste.js';
import { readLayout } from './pipeline.js';
import type { QuestionSegment } from './segment/types.js';

/**
 * The paper twin's boxes — `docs/plan/CONVERGENCE.md`, S12b, and `IMPORT-PIPELINE.md` stage 6:
 * where each question's answer, and each option's tick, is written on the page it was read from.
 */

const lines = (doc: LayoutDocument): IrLine[] =>
  doc.pages.flatMap((page) => page.blocks.flatMap((block) => block.lines));
const lineWith = (doc: LayoutDocument, text: string) =>
  lines(doc).find((line) => line.text.includes(text))!;
const questions = (doc: LayoutDocument) =>
  readLayout(doc).segments.segments.filter((s): s is QuestionSegment => s.kind === 'question');
const within = (inner: Box, outer: Box) =>
  inner.x0 >= outer.x0 && inner.x1 <= outer.x1 && inner.y0 >= outer.y0 && inner.y1 <= outer.y1;

describe('a question’s box', () => {
  it('is its blank run, on its own line', () => {
    const doc = pasteDocument('1. Namn: __________\n2. E-post: __________');
    const [namn, epost] = questions(doc);
    const blank = lineWith(doc, 'Namn').words.find((w) => isBlankWord(w.text))!;
    expect(answerBox(doc, namn!.lineIds, namn!.label)).toEqual({ pageNo: 1, box: blank.box });
    const other = lineWith(doc, 'E-post').words.find((w) => isBlankWord(w.text))!;
    expect(answerBox(doc, epost!.lineIds, epost!.label)?.box).toEqual(other.box);
  });

  it('is its own blank when two questions share a line, never the other’s', () => {
    const doc = pasteDocument('Namn: __________ Telefon: __________');
    const [namn, telefon] = questions(doc);
    expect(namn!.lineIds).toEqual(telefon!.lineIds);
    const blanks = lineWith(doc, 'Namn').words.filter((w) => isBlankWord(w.text));
    expect(answerBox(doc, namn!.lineIds, namn!.label)?.box).toEqual(blanks[0]!.box);
    expect(answerBox(doc, telefon!.lineIds, telefon!.label)?.box).toEqual(blanks[1]!.box);
  });

  it('is its dotted leader, in full stops or in ellipses', () => {
    for (const text of ['1. Namn ..........\n2. Ort ..........', '1. Namn: ……………\n2. Ort: ……………']) {
      const doc = pasteDocument(text);
      const [namn, ort] = questions(doc);
      for (const [q, label] of [
        [namn!, 'Namn'],
        [ort!, 'Ort'],
      ] as const) {
        const leader = lineWith(doc, label).words.at(-1)!;
        expect(isBlankWord(leader.text)).toBe(true);
        expect(answerBox(doc, q.lineIds, q.label)?.box, text).toEqual(leader.box);
      }
    }
  });

  it('is the blank part of a word the label is glued to', () => {
    const doc = pasteDocument('1. Adress:____________');
    const [adress] = questions(doc);
    const word = lineWith(doc, 'Adress').words.at(-1)!;
    const at = answerBox(doc, adress!.lineIds, adress!.label)!;
    expect(at.box.x1).toBe(word.box.x1);
    expect(at.box.x0).toBeGreaterThan(word.box.x0);
    expect(within(at.box, word.box)).toBe(true);
  });

  it('is the blank line under it, when the label has none of its own', () => {
    // With a colon, the line of blank under it is the question's (stage 4's J1).
    const doc = pasteDocument(
      '1. Beskriv din erfarenhet:\n________________________\n2. Namn: ____',
    );
    const [q] = questions(doc);
    const under = lineWith(doc, '____').words[0]!;
    expect(answerBox(doc, q!.lineIds, q!.label)?.box).toEqual(under.box);
  });

  it('is its checkboxes, when it is answered by ticking', () => {
    const doc = pasteDocument('1. Vilken dag kommer du? ☐ Fredag ☐ Lördag');
    const [q] = questions(doc);
    const boxes = lineWith(doc, 'Vilken').words.filter((w) => isCheckboxWord(w.text));
    const at = answerBox(doc, q!.lineIds, q!.label)!;
    expect(at.box.x0).toBe(boxes[0]!.box.x0);
    expect(at.box.x1).toBe(boxes[1]!.box.x1);
  });

  it('otherwise runs from the label to its column’s edge, on the label’s line', () => {
    const doc = pasteDocument('1. Question one\n2. Question two');
    const [one] = questions(doc);
    const line = lineWith(doc, 'Question one');
    const column = doc.pages[0]!.columns.find((c) => c.index === line.columnIndex)!;
    const at = answerBox(doc, one!.lineIds, one!.label)!;
    expect(at.box).toEqual({
      x0: line.words.at(-1)!.box.x1,
      y0: line.box.y0,
      x1: column.x1,
      y1: line.box.y1,
    });
  });

  it('is nothing for lines the layout does not have', () => {
    const doc = pasteDocument('1. Namn: ____');
    expect(answerBox(doc, ['no-such-line'], 'Namn')).toBeNull();
  });
});

describe('an option’s box', () => {
  it('is the checkbox before it, for each option in order', () => {
    const doc = pasteDocument('1. Vilken dag kommer du?\n☐ Fredag\n☐ Lördag\n☐ Söndag');
    const [q] = questions(doc);
    expect(q!.options).toEqual(['Fredag', 'Lördag', 'Söndag']);
    const boxes = lines(doc)
      .flatMap((line) => line.words)
      .filter((w) => isCheckboxWord(w.text))
      .map((w) => w.box);
    expect(optionBoxes(doc, q!.lineIds, q!.options).map((at) => at?.box)).toEqual(boxes);
  });

  it('is the checkbox after it when the page puts the box last', () => {
    const doc = pasteDocument('Fredag ☐\nLördag ☐');
    const found = optionBoxes(
      doc,
      lines(doc).map((line) => line.id),
      ['Fredag', 'Lördag'],
    );
    for (const [i, option] of ['Fredag', 'Lördag'].entries()) {
      const box = lineWith(doc, option).words.find((w) => isCheckboxWord(w.text))!.box;
      expect(found[i]?.box).toEqual(box);
    }
  });

  it('is nothing for an option with no box on the page', () => {
    const doc = pasteDocument('1. Namn: ____');
    const [q] = questions(doc);
    expect(optionBoxes(doc, q!.lineIds, ['Fredag'])).toEqual([null]);
  });
});

describe('a grid', () => {
  it('gives each row its checkboxes, in column order', () => {
    const path = new URL('../../../../fixtures/numbering/checkbox-grid.json', import.meta.url);
    const doc = parseLayoutDocument(JSON.parse(readFileSync(path, 'utf8')).input);
    const grid = readLayout(doc).segments.segments.find((s) => s.kind === 'grid');
    if (!grid || grid.kind !== 'grid') throw new Error('no grid read');
    const rows = gridBoxes(doc, grid.lineIds, grid.rows, grid.columns.length);
    expect(rows).toHaveLength(grid.rows.length);
    for (const [i, row] of rows.entries()) {
      const line = lineWith(doc, grid.rows[i]!);
      const ticks = line.words.filter((w) => isCheckboxWord(w.text)).map((w) => w.box);
      expect(row.options.map((at) => at?.box)).toEqual(ticks.slice(0, grid.columns.length));
      expect(row.row?.box.x0).toBe(ticks[0]!.x0);
    }
  });
});

describe('on every page read', () => {
  it('is within its page, for every question, option and grid row of every layout fixture', () => {
    const dir = new URL('../../../../fixtures/numbering/', import.meta.url);
    const inside = (at: PageBox | null, doc: LayoutDocument) => {
      if (at === null) return true;
      const { x0, y0, x1, y1 } = at.box;
      return (
        doc.pages.some((page) => page.pageNo === at.pageNo) &&
        x0 >= 0 &&
        y0 >= 0 &&
        x1 <= 10_000 &&
        y1 <= 10_000 &&
        x0 < x1 &&
        y0 < y1
      );
    };
    let placed = 0;
    for (const name of readdirSync(dir).filter((file) => file.endsWith('.json'))) {
      const fixture = JSON.parse(readFileSync(new URL(name, dir), 'utf8')) as {
        stage?: string;
        input?: unknown;
      };
      // A layout document: an expectation file has no input, and `reassemble`'s is a raw one.
      if (!['enumerate', 'segment', 'score'].includes(fixture.stage ?? '')) continue;
      const doc = parseLayoutDocument(fixture.input);
      for (const segment of readLayout(doc).segments.segments) {
        const boxes =
          segment.kind === 'question'
            ? [
                answerBox(doc, segment.lineIds, segment.label),
                ...optionBoxes(doc, segment.lineIds, segment.options),
              ]
            : segment.kind === 'grid'
              ? gridBoxes(doc, segment.lineIds, segment.rows, segment.columns.length).flatMap(
                  ({ row, options }) => [row, ...options],
                )
              : [];
        for (const at of boxes) {
          expect(inside(at, doc), `${name} ${JSON.stringify(at)}`).toBe(true);
          if (at) placed += 1;
        }
      }
    }
    // Not vacuous: the fixtures hold hundreds of questions.
    expect(placed).toBeGreaterThan(100);
  });
});

describe('a blank run within a word', () => {
  it('is found exactly where the line hints find one, and nowhere else', () => {
    const dir = new URL('../../../../fixtures/numbering/', import.meta.url);
    const words = [
      '____',
      '__',
      'Adress:____________',
      '....',
      '...',
      '……',
      '…',
      'a.b.c.d',
      '___x....',
      'Namn',
      ...readdirSync(dir)
        .filter((file) => file.endsWith('.json'))
        .flatMap((file) => {
          const fixture = JSON.parse(readFileSync(new URL(file, dir), 'utf8')) as {
            stage?: string;
            input?: unknown;
          };
          if (!['enumerate', 'segment', 'score'].includes(fixture.stage ?? '')) return [];
          return lines(parseLayoutDocument(fixture.input)).flatMap((line) =>
            line.words.map((word) => word.text),
          );
        }),
    ];
    for (const word of words) {
      expect(blankRuns(word).length > 0, word).toBe(textHints(word).blankRun);
    }
    expect(blankRuns('Adress:____________')).toEqual([{ start: 7, end: 19 }]);
    expect(blankRuns('___x....')).toEqual([
      { start: 0, end: 3 },
      { start: 4, end: 8 },
    ]);
  });
});

describe('as a fraction of the page', () => {
  it('counts pages across every source the form keeps, and divides by 10 000', () => {
    const at: PageBox = { pageNo: 2, box: { x0: 1000, y0: 2500, x1: 6000, y1: 3000 } };
    expect(paperAnchor(at, 0)).toEqual({ page: 1, x: 0.1, y: 0.25, w: 0.5, h: 0.05 });
    expect(paperAnchor(at, 3)).toEqual({ page: 4, x: 0.1, y: 0.25, w: 0.5, h: 0.05 });
  });
});
