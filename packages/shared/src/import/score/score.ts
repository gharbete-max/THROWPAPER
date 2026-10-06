import { sigmoidMille } from '../../interpret/sigmoid.js';
import { WEIGHTS } from '../classify/classify.js';
import type { ClassifyResult } from '../classify/types.js';
import { inputsSha256, type Decision, type StageResult } from '../debug.js';
import type { EnumerateResult } from '../enumerate/types.js';
import type { IrLine, LayoutDocument } from '../ir/types.js';
import { isBlankWord, isCheckboxWord } from '../layout/hints.js';
import type { Segment, SegmentResult } from '../segment/types.js';

/**
 * Stage 7, score and bucket — `docs/plan/IMPORT-PIPELINE.md` §7, which is the specification.
 *
 * Every decision the review screen shows gets a confidence in per mille and a bucket: `auto` (at
 * least 850: listed, accepted by default), `flag` (550–849: listed with its chips, "check this")
 * and `review` (below 550: "needs your eye", nothing assumed). A segment's own confidence is the
 * committed sigmoid of its named contributions (`classify/weights.json`, `score`); a question's
 * bucket is the lower of that and its answer kind's (stage 5); then the caps, which nothing
 * outweighs.
 *
 * The required decision has its own bucket and does not lower the question's: a form that marks
 * nothing required (most do not) would otherwise put every question it has in "check this" — and
 * "3 need your eye" would stop meaning anything. It is still never assumed: no hint is `unknown`
 * and at most `flag` (#26). (First written as a cap on the whole question.)
 */

/** Bumped when the stage's output changes on purpose (the debug artifact records it). */
export const SCORE_STAGE_VERSION = 2;

export type Bucket = 'auto' | 'flag' | 'review';
/** A confidence at or above this is `auto`; at or above `FLAG_AT`, `flag`; below, `review`. */
export const AUTO_AT = 850;
export const FLAG_AT = 550;
/** OCR word confidences below these cap the segment at `review`, and at `flag` (#20). */
export const OCR_REVIEW_BELOW = 60;
export const OCR_FLAG_BELOW = 85;

const RANK: Record<Bucket, number> = { review: 0, flag: 1, auto: 2 };
export const bucketOf = (confidence: number): Bucket =>
  confidence >= AUTO_AT ? 'auto' : confidence >= FLAG_AT ? 'flag' : 'review';
/** The stricter of two buckets. */
export const lower = (a: Bucket, b: Bucket): Bucket => (RANK[a] <= RANK[b] ? a : b);

export interface Judgement {
  /** Per mille. */
  confidence: number;
  bucket: Bucket;
}

/** A limit on a segment's bucket that no contribution can outweigh. */
export interface Cap {
  rule: 'ocr';
  bucketAtMost: Bucket;
  /** The lowest OCR word confidence in the segment's words (0–100). */
  lowest: number;
}

export interface ScoredSegment {
  segmentIndex: number;
  subject: string;
  kind: Segment['kind'];
  /** Is this what stage 4 says it is? */
  segment: Judgement;
  /** The answer kind stage 5 proposed; null for headings, instructions and meta. */
  answer: Judgement | null;
  /** Whether it must be answered; null for anything but a question. */
  required: Judgement | null;
  caps: Cap[];
  /** The lower of `segment` and `answer`, then the caps: what the review screen sorts by. */
  bucket: Bucket;
  /** The named contributions to `segment`, in millinats. */
  contributions: Record<string, number>;
}

export interface ScoreResult {
  /** One per segment, in segment order. */
  scored: ScoredSegment[];
  /** Questions, grids and tables, by bucket: "I read 14 questions. 3 need your eye." */
  counts: { questions: number; auto: number; flag: number; review: number };
}

const S = WEIGHTS.score;

export function score(
  doc: LayoutDocument,
  lists: EnumerateResult,
  segmented: SegmentResult,
  classified: ClassifyResult,
): StageResult<ScoreResult> {
  const lines = new Map<string, IrLine>(
    doc.pages.flatMap((page) =>
      page.blocks.flatMap((block) => block.lines.map((line) => [line.id, line] as const)),
    ),
  );
  const items = new Map(lists.items.map((item) => [item.id, item]));
  // A glued marker's word is its label's too (M10, M12): its confidence counts.
  const markerWords = new Map(
    lists.items.map((item) => [
      item.lineIds[0]!,
      item.marker.glued === undefined ? item.marker.wordCount : 0,
    ]),
  );
  const byIndex = new Map(classified.classified.map((c) => [c.segmentIndex, c]));
  const decisions: Decision[] = [];
  const scored: ScoredSegment[] = [];
  const counts = { questions: 0, auto: 0, flag: 0, review: 0 };
  const firsts = new Map<string, number>();

  segmented.segments.forEach((segment, segmentIndex) => {
    const first = segment.lineIds[0]!;
    const seen = firsts.get(first) ?? 0;
    firsts.set(first, seen + 1);
    const subject = seen === 0 ? first : `${first}#${seen + 1}`;
    const own = segment.lineIds.map((id) => lines.get(id)!);
    const contributions: Record<string, number> = {};
    const add = (name: string, value: number | undefined) => {
      if (value !== undefined && value !== 0) contributions[name] = value;
    };

    const asks = segment.kind === 'question' || segment.kind === 'grid' || segment.kind === 'table';
    if (asks) {
      add('bias', S.bias);
      const item = segment.itemId ? items.get(segment.itemId) : undefined;
      if (item) add('verdict', item.decidedBy === 'W1' ? S.verdict.W1 : S.verdict[item.verdict]);
      if (segment.kind === 'grid') add('grid', S.evidence.grid);
      if (segment.kind === 'table') add('table', S.evidence.table);
      if (segment.kind === 'question') {
        const blank =
          segment.answer === 'blank' || own.some((l) => l.hints.blankRun || l.hints.ruleBelow);
        const box = segment.answer === 'choice' || segment.answer === 'boolean';
        if (blank) add('blank', S.evidence.blank);
        if (box) add('checkbox', S.evidence.checkbox);
        if (own.some((l) => l.hints.endsWithColon)) add('colon', S.evidence.colon);
        if (/[?？](?:\s*[(（][^()（）]*[)）])?$/u.test(segment.label))
          add('questionMark', S.evidence.questionMark);
      }
      for (const flag of segment.flags) add(`flag:${flag}`, S.flags[flag]);
    } else if (segment.kind === 'instruction') {
      const long = [...segment.text].length > 120 || /[.!。！]$/u.test(segment.text);
      add(
        long ? 'instruction' : 'shortInstruction',
        long ? S.text.instruction : S.text.shortInstruction,
      );
    } else {
      add(segment.kind, S.text[segment.kind]);
    }
    const sum = Object.values(contributions).reduce((total, value) => total + value, 0);
    const own_ = { confidence: sigmoidMille(sum), bucket: bucketOf(sigmoidMille(sum)) };

    const c = byIndex.get(segmentIndex);
    const answer = c ? { confidence: c.confidence, bucket: bucketOf(c.confidence) } : null;
    const required =
      segment.kind === 'question' && c
        ? (() => {
            const confidence = sigmoidMille(
              c.required === 'unknown' ? S.required.none : S.required.hint,
            );
            // #26: no hint is at most `flag`, whatever the weights say.
            const bucket =
              c.required === 'unknown' ? lower(bucketOf(confidence), 'flag') : bucketOf(confidence);
            return { confidence, bucket };
          })()
        : null;

    // #20: OCR confidence caps the segment. Its words, not its marker, blanks or checkboxes.
    const caps: Cap[] = [];
    const confidences = own.flatMap((line) =>
      line.words
        .slice(markerWords.get(line.id) ?? 0)
        .filter((word) => !isBlankWord(word.text) && !isCheckboxWord(word.text))
        .map((word) => word.ocrConfidence)
        .filter((value): value is number => value !== null),
    );
    if (confidences.length > 0) {
      const lowest = Math.min(...confidences);
      if (lowest < OCR_REVIEW_BELOW) caps.push({ rule: 'ocr', bucketAtMost: 'review', lowest });
      else if (lowest < OCR_FLAG_BELOW) caps.push({ rule: 'ocr', bucketAtMost: 'flag', lowest });
    }

    let bucket = answer ? lower(own_.bucket, answer.bucket) : own_.bucket;
    for (const cap of caps) bucket = lower(bucket, cap.bucketAtMost);
    if (asks) {
      counts.questions += 1;
      counts[bucket] += 1;
    }

    scored.push({
      segmentIndex,
      subject,
      kind: segment.kind,
      segment: own_,
      answer,
      required,
      caps,
      bucket,
      contributions,
    });
    decisions.push({
      id: `score:${subject}`,
      rule: asks ? 'Q1' : 'Q2',
      subject: segment.lineIds,
      verdict: bucket,
      evidence: {
        ...contributions,
        sum,
        confidence: own_.confidence,
        ...(answer ? { answer: answer.confidence } : {}),
        ...(required ? { required: required.bucket } : {}),
        ...(caps.length ? { cap: `ocr ${caps[0]!.lowest}` } : {}),
      },
    });
  });

  return {
    output: { scored, counts },
    debug: {
      stage: 'score',
      stageVersion: SCORE_STAGE_VERSION,
      irVersion: 1,
      inputSha256: inputsSha256({ layout: doc, lists, segments: segmented, classified }),
      decisions,
    },
  };
}
