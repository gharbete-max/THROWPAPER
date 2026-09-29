import type { ClassifyResult, Kind } from './classify/types.js';
import { inputsSha256, type Decision, type StageResult } from './debug.js';
import type { Box, IrLine, LayoutDocument } from './ir/types.js';
import type { SegmentResult } from './segment/types.js';

/**
 * A PDF's own form fields beat its text — `CAVEATS.md` #54, `IMPORT-PIPELINE.md` §1 ("A PDF with
 * AcroForm fields") and §6.
 *
 * A fillable PDF says where its answers go and what they are; its printed text only says what they
 * are called. So each field is a question at confidence 1000, and a question read from the text
 * that sits where a field is — on its line, or just above it — is that field's label, not a
 * second question. Text fills only what a field lacks: a field with no name of its own (`/TU`)
 * takes the label printed beside it, verbatim; one with neither is asked about. Headings,
 * instructions and questions no field sits on stay as stage 4 read them.
 */

export const FIELDS_STAGE_VERSION = 1;

/** A form field with its widget on the page, in layout units (the paper door converts them). */
export interface FormFieldBox {
  name: string;
  /** The field's own label (`/TU`), verbatim, or null. */
  label: string | null;
  type: 'text' | 'checkbox' | 'radio' | 'choice' | 'signature';
  multiline: boolean;
  multiSelect: boolean;
  /** 1-based, as `IrPage.pageNo`. */
  pageNo: number;
  box: Box;
}

export interface FieldReading {
  name: string;
  /** Verbatim: the field's own, or the text printed beside it; null when neither exists. */
  label: string | null;
  labelFrom: 'field' | 'text' | null;
  kind: Kind;
  /** 1000: the document says so. A field with no label at all is still asked about. */
  confidence: number;
  bucket: 'auto' | 'review';
  /** Indices of stage 4 segments that are this field's label. */
  covers: number[];
}

export interface FieldsResult {
  fields: FieldReading[];
  /** Every segment index some field covers, ascending. */
  covered: number[];
}

/** The kind a field's type says; a text field's kind is refined by its printed label's, if any. */
function kindOf(field: FormFieldBox, printed: Kind | null): Kind {
  switch (field.type) {
    case 'checkbox':
      return 'yes_no';
    case 'radio':
      return 'single_select';
    case 'choice':
      return field.multiSelect ? 'multi_select' : 'single_select';
    case 'signature':
      return 'signature';
    default:
      if (field.multiline) return 'long_text';
      return printed &&
        !['yes_no', 'consent', 'single_select', 'multi_select', 'grid', 'repeating_group'].includes(
          printed,
        )
        ? printed
        : 'short_text';
  }
}

/**
 * Whether a widget belongs to a line of text: on the line (their heights overlap) and not left of
 * where it starts, or directly under it (within two of its ems) and overlapping it across.
 */
function beside(widget: Box, line: IrLine): boolean {
  const onLine = widget.y0 < line.box.y1 && line.box.y0 < widget.y1 && widget.x0 >= line.box.x0;
  const under =
    widget.y0 >= line.box.y1 &&
    widget.y0 - line.box.y1 <= 2 * line.fontSize &&
    widget.x0 < line.box.x1 &&
    line.box.x0 < widget.x1;
  return onLine || under;
}

export function fieldsFirst(
  doc: LayoutDocument,
  segmented: SegmentResult,
  classified: ClassifyResult,
  fields: readonly FormFieldBox[],
): StageResult<FieldsResult> {
  const lines = new Map<string, IrLine>(
    doc.pages.flatMap((page) =>
      page.blocks.flatMap((block) => block.lines.map((line) => [line.id, line] as const)),
    ),
  );
  const kinds = new Map(classified.classified.map((c) => [c.segmentIndex, c.kind]));
  const taken = new Set<number>();
  const decisions: Decision[] = [];
  const readings: FieldReading[] = [];

  for (const field of fields) {
    const covers = segmented.segments.flatMap((segment, index) =>
      segment.kind === 'question' &&
      !taken.has(index) &&
      segment.lineIds.some((id) => {
        const line = lines.get(id)!;
        return line.pageNo === field.pageNo && beside(field.box, line);
      })
        ? [index]
        : [],
    );
    // The nearest printed label is the first in reading order; a field names one question.
    const own = covers.slice(0, 1);
    for (const index of own) taken.add(index);
    const printed = own.length ? segmented.segments[own[0]!]! : null;
    const printedLabel = printed?.kind === 'question' ? printed.label : null;
    const label = field.label ?? printedLabel;
    const reading: FieldReading = {
      name: field.name,
      label,
      labelFrom: field.label !== null ? 'field' : printedLabel !== null ? 'text' : null,
      kind: kindOf(field, own.length ? (kinds.get(own[0]!) ?? null) : null),
      confidence: 1000,
      bucket: label === null ? 'review' : 'auto',
      covers: own,
    };
    readings.push(reading);
    decisions.push({
      id: `map:${field.name}`,
      rule: 'A1',
      subject: printed ? printed.lineIds : [],
      verdict: reading.kind,
      evidence: { labelFrom: reading.labelFrom ?? 'none', covers: own.length, page: field.pageNo },
    });
  }

  return {
    output: { fields: readings, covered: [...taken].sort((a, b) => a - b) },
    debug: {
      stage: 'map',
      stageVersion: FIELDS_STAGE_VERSION,
      irVersion: 1,
      inputSha256: inputsSha256({ layout: doc, segments: segmented, fields }),
      decisions,
    },
  };
}
