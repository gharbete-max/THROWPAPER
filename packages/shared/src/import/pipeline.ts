import { classify } from './classify/classify.js';
import type { ClassifyResult } from './classify/types.js';
import type { StageDebug } from './debug.js';
import { enumerate } from './enumerate/enumerate.js';
import type { EnumerateResult } from './enumerate/types.js';
import { fieldsFirst, type FieldsResult, type FormFieldBox } from './fields.js';
import type { LayoutDocument } from './ir/types.js';
import { score, type ScoreResult } from './score/score.js';
import { segment } from './segment/segment.js';
import type { SegmentResult } from './segment/types.js';

/**
 * Stages 3 to 7 on a layout document, as the paper door's worker, the corpus test and the
 * fixtures run them — `IMPORT-PIPELINE.md`, "Shape". Stage 6's template guess and paper twin are
 * S12's; of stage 6, only a PDF's own form fields run here (#54).
 */
export interface LayoutReading {
  lists: EnumerateResult;
  segments: SegmentResult;
  classified: ClassifyResult;
  scored: ScoreResult;
  /** Null unless the document has form fields. */
  fields: FieldsResult | null;
  /** One artifact per stage that ran, in order. */
  debug: StageDebug[];
}

export function readLayout(
  layout: LayoutDocument,
  options: { fields?: readonly FormFieldBox[] } = {},
): LayoutReading {
  const listed = enumerate(layout);
  const segmented = segment(layout, listed.output);
  const kinds = classify(layout, segmented.output);
  const scored = score(layout, listed.output, segmented.output, kinds.output);
  const debug = [listed.debug, segmented.debug, kinds.debug, scored.debug];
  let fields: FieldsResult | null = null;
  if (options.fields && options.fields.length > 0) {
    const mapped = fieldsFirst(layout, segmented.output, kinds.output, options.fields);
    fields = mapped.output;
    debug.push(mapped.debug);
  }
  return {
    lists: listed.output,
    segments: segmented.output,
    classified: kinds.output,
    scored: scored.output,
    fields,
    debug,
  };
}
