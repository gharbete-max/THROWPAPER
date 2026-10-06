import { describe, expect, it } from 'vitest';
import { canonicalJson } from './debug.js';
import type { FormFieldBox } from './fields.js';
import type { IrLine, LayoutDocument } from './ir/types.js';
import { pasteDocument } from './paste.js';
import { readLayout } from './pipeline.js';
import { AUTO_AT, bucketOf, FLAG_AT } from './score/score.js';

/**
 * Stages 3–7 together (`IMPORT-PIPELINE.md` §5–§7), and a PDF's own form fields over its text
 * (`CAVEATS.md` #54).
 */

const lineOf = (doc: LayoutDocument, text: string): IrLine =>
  doc.pages[0]!.blocks.flatMap((block) => block.lines).find((line) => line.text === text)!;

/** A widget on a line, to the right of its label. */
const widgetBeside = (line: IrLine) => ({
  x0: line.box.x1 + 200,
  y0: line.box.y0,
  x1: line.box.x1 + 3000,
  y1: line.box.y1,
});

describe('stage 7, score and bucket', () => {
  it('buckets at 850 and 550', () => {
    expect([
      bucketOf(AUTO_AT),
      bucketOf(AUTO_AT - 1),
      bucketOf(FLAG_AT),
      bucketOf(FLAG_AT - 1),
    ]).toEqual(['auto', 'flag', 'flag', 'review']);
  });

  it('counts questions by bucket: "I read 4 questions."', () => {
    const read = readLayout(
      pasteDocument('1. Namn: ____\n2. E-post: ____\n3. Question three\nHar du allergier? ☐'),
    );
    // "Question three": a question for certain, its answer's kind a guess — "check this".
    expect(read.scored.counts).toEqual({ questions: 4, auto: 3, flag: 1, review: 0 });
  });

  it('#26: no required hint is its own decision, at most flag — and never lowers the question', () => {
    const read = readLayout(pasteDocument('1. Namn: ____\n2. E-post *: ____'));
    const [name, email] = read.scored.scored;
    expect(name!.required).toMatchObject({ bucket: 'flag' });
    expect(name!.bucket).toBe('auto');
    expect(email!.required).toMatchObject({ bucket: 'auto' });
  });

  it('#20: an OCR word below 60 caps at review, below 85 at flag; the text is never changed', () => {
    const doc = pasteDocument('1. Namn: ____\n2. Adress: ____\n3. Telefon: ____');
    const lines = doc.pages[0]!.blocks.flatMap((block) => block.lines);
    const ocr = [96, 70, 41];
    const scanned: LayoutDocument = {
      ...doc,
      source: { ...doc.source, kind: 'image' },
      pages: doc.pages.map((page) => ({
        ...page,
        blocks: page.blocks.map((block) => ({
          ...block,
          lines: block.lines.map((line) => {
            const least = ocr[lines.indexOf(line)]!;
            return {
              ...line,
              source: 'ocr' as const,
              ocrConfidence: least,
              words: line.words.map((word, i) => ({
                ...word,
                ocrConfidence: i === 1 ? least : 99,
              })),
            };
          }),
        })),
      })),
    };
    const read = readLayout(scanned);
    expect(read.scored.scored.map((s) => s.bucket)).toEqual(['auto', 'flag', 'review']);
    expect(read.scored.counts).toEqual({ questions: 3, auto: 1, flag: 1, review: 1 });
    expect(read.scored.scored.map((s) => s.caps.map((cap) => cap.lowest))).toEqual([
      [],
      [70],
      [41],
    ]);
    expect(read.segments.segments.map((s) => (s.kind === 'question' ? s.label : ''))).toEqual([
      'Namn',
      'Adress',
      'Telefon',
    ]);
  });

  it('#146, #147: a glued marker’s word is its label’s too, and "？" asks as "?" does', () => {
    const doc = pasteDocument('1．姓名：＿＿＿＿\n2．是否需要发票？');
    // A scan that read the first word, marker and label in one, at 41.
    const scanned: LayoutDocument = {
      ...doc,
      source: { ...doc.source, kind: 'image' },
      pages: doc.pages.map((page) => ({
        ...page,
        blocks: page.blocks.map((block) => ({
          ...block,
          lines: block.lines.map((line) => ({
            ...line,
            source: 'ocr' as const,
            ocrConfidence: line.text.startsWith('1') ? 41 : 99,
            words: line.words.map((word) => ({
              ...word,
              ocrConfidence: line.text.startsWith('1') ? 41 : 99,
            })),
          })),
        })),
      })),
    };
    const [name, invoice] = readLayout(scanned).scored.scored;
    expect(name!.caps).toEqual([{ rule: 'ocr', bucketAtMost: 'review', lowest: 41 }]);
    expect(invoice!.contributions.questionMark).toBeGreaterThan(0);
    // "。" ends a sentence as "." does: a short one is text to read, not "is this a question?".
    const [thanks] = readLayout(pasteDocument('ご協力ありがとうございました。')).scored.scored;
    expect(Object.keys(thanks!.contributions)).toEqual(['instruction']);
  });

  it('runs every stage once, in order, and gives the same bytes twice', () => {
    const doc = pasteDocument('Anmälan\n\n1. Namn: ____\n2. Kommer du? ☐ Ja ☐ Nej\nTack!');
    const once = readLayout(doc);
    expect(once.debug.map((d) => d.stage)).toEqual(['enumerate', 'segment', 'classify', 'score']);
    expect(once.fields).toBeNull();
    expect(canonicalJson(readLayout(structuredClone(doc)))).toBe(canonicalJson(once));
  });
});

describe("#54: a PDF's own form fields beat its text", () => {
  const doc = pasteDocument('PERSONUPPGIFTER\n\nNamn:\nE-post:\nTelefon: ______');
  const field = (name: string, label: string | null, beside: string): FormFieldBox => ({
    name,
    label,
    type: 'text',
    multiline: false,
    multiSelect: false,
    pageNo: 1,
    box: widgetBeside(lineOf(doc, beside)),
  });

  it('is a question at confidence 1000, and the text beside it is its label, not a second question', () => {
    const read = readLayout(doc, { fields: [field('name', 'Namn', 'Namn:')] });
    expect(read.fields!.fields).toEqual([
      {
        name: 'name',
        label: 'Namn',
        labelFrom: 'field',
        kind: 'short_text',
        confidence: 1000,
        bucket: 'auto',
        covers: [1],
      },
    ]);
    expect(read.fields!.covered).toEqual([1]);
    // The heading and the questions no field sits on stay as the text read them.
    expect(read.segments.segments[0]).toMatchObject({ kind: 'heading', text: 'PERSONUPPGIFTER' });
    expect(read.debug.map((d) => d.stage)).toEqual([
      'enumerate',
      'segment',
      'classify',
      'score',
      'map',
    ]);
  });

  it('takes the printed label, verbatim, only when the field has none — and its kind from it', () => {
    const read = readLayout(doc, { fields: [field('f1_02[0]', null, 'E-post:')] });
    expect(read.fields!.fields[0]).toMatchObject({
      label: 'E-post',
      labelFrom: 'text',
      kind: 'email',
      bucket: 'auto',
    });
  });

  it('asks about a field with no label and no text beside it', () => {
    const lonely: FormFieldBox = {
      ...field('f9', null, 'Namn:'),
      box: { x0: 8000, y0: 9000, x1: 9000, y1: 9200 },
    };
    const read = readLayout(doc, { fields: [lonely] });
    expect(read.fields!.fields[0]).toMatchObject({
      label: null,
      labelFrom: null,
      bucket: 'review',
      covers: [],
    });
  });

  it("keeps the field's own type: a checkbox is yes/no whatever the text says", () => {
    const box: FormFieldBox = { ...field('tel', 'Telefon', 'Telefon: ______'), type: 'checkbox' };
    expect(readLayout(doc, { fields: [box] }).fields!.fields[0]!.kind).toBe('yes_no');
  });
});
