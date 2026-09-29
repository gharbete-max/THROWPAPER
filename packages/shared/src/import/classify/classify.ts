import { z } from 'zod';
import { sigmoidMille } from '../../interpret/sigmoid.js';
import { inputsSha256, type Decision, type StageResult } from '../debug.js';
import type { LayoutDocument } from '../ir/types.js';
import { LAYOUT_LANGUAGES, type LayoutLanguage } from '../layout/lexicon.js';
import type { Segment, SegmentResult } from '../segment/types.js';
import { formatOf, languagesFor, wordsIn, type LabelWords } from './lexicon.js';
import {
  KINDS,
  SHAPE_FEATURES,
  WORD_FEATURES,
  type Chip,
  type Classification,
  type ClassifyResult,
  type ColumnKind,
  type Feature,
  type FormatProposal,
  type Kind,
  type RequiredReading,
} from './types.js';
import weights from './weights.json';

/**
 * Stage 5, classify: what each question's answer is likely to be — `docs/plan/IMPORT-PIPELINE.md`
 * §5, which is the specification. A scored feature model in integer millinats: each kind the
 * question's answer allows gets its bias plus the weight of every feature present, the best wins,
 * and its confidence is the committed sigmoid of its lead over the runner-up (ADR 0019). The
 * three features that weighed most are kept for the "why" chip. Nothing is applied: every result
 * is a proposal the review screen shows (stage 8), and the label is never touched.
 */

/**
 * Bumped when the stage's output changes on purpose (the debug artifact records it). 2 (S10): each
 * classification carries its three likeliest kinds, `alternatives`, the review screen's chips.
 */
export const CLASSIFY_STAGE_VERSION = 2;

const ALL_FEATURES: readonly Feature[] = [...WORD_FEATURES, ...SHAPE_FEATURES];
const kindSchema = z.enum(KINDS);
const featureSchema = z.enum(ALL_FEATURES as [Feature, ...Feature[]]);
const millinats = z.number().int();

const WeightsSchema = z
  .object({
    source: z.string().min(1),
    weightsVersion: z.literal(1),
    candidates: z
      .object({
        blank: z.array(kindSchema).min(1),
        unknown: z.array(kindSchema).min(1),
        boolean: z.array(kindSchema).min(1),
        choice: z.array(kindSchema).min(1),
        grid: z.array(kindSchema).min(1),
        table: z.array(kindSchema).min(1),
      })
      .strict(),
    kinds: z.record(
      kindSchema,
      z.object({ bias: millinats, features: z.record(featureSchema, millinats) }).strict(),
    ),
    score: z
      .object({
        bias: millinats,
        verdict: z.record(z.string(), millinats),
        evidence: z.record(z.string(), millinats),
        flags: z.record(z.string(), millinats),
        text: z.record(z.string(), millinats),
        required: z.object({ hint: millinats, none: millinats }).strict(),
      })
      .strict(),
  })
  .strict();

/** `classify/weights.json`, validated on load. */
export const WEIGHTS = WeightsSchema.parse(weights);
for (const kind of KINDS) {
  if (!WEIGHTS.kinds[kind]) throw new Error(`classify/weights.json: no weights for ${kind}`);
}

/** A date written as its format: ÅÅÅÅ-MM-DD, YYYY-MM-DD, DD/MM/YYYY, dd.mm.åååå, … */
const DATE_PATTERN =
  /(?<!\p{L})(?:(?:ÅÅÅÅ|YYYY|JJJJ|AAAA|VVVV|ГГГГ)[-./ ]?MM[-./ ]?(?:DD|TT|JJ|PP|ДД)|(?:DD|TT|JJ|PP|ДД)[-./ ]?MM[-./ ]?(?:ÅÅÅÅ|YYYY|JJJJ|AAAA|VVVV|ГГГГ))(?!\p{L})/iu;
/** A time of day: 18:00, or "kl." / "klo" with an hour. */
const TIME_PATTERN = /(?<!\d)\d{1,2}:\d{2}(?!\d)|(?<!\p{L})(?:kl|klo)\.?\s*\d{1,2}(?:[.:]\d{2})?/iu;

/** The label a segment asks, for reading its words. */
function labelOf(segment: Segment): string {
  switch (segment.kind) {
    case 'question':
      return segment.label;
    case 'grid':
    case 'table':
      return segment.label ?? '';
    default:
      return '';
  }
}

interface Scored {
  kind: Kind;
  confidence: number;
  margin: number;
  runnerUp: Kind | null;
  alternatives: Kind[];
  why: Feature[];
}

/** The best of the candidate kinds for these features, by the weights. */
function best(candidates: readonly Kind[], present: ReadonlySet<Feature>): Scored {
  const scored = candidates.map((kind, order) => {
    const { bias, features } = WEIGHTS.kinds[kind]!;
    const contributions = Object.entries(features)
      .filter(([feature]) => present.has(feature as Feature))
      .map(([feature, weight]) => ({ feature: feature as Feature, weight: weight! }));
    return {
      kind,
      order,
      score: bias + contributions.reduce((sum, c) => sum + c.weight, 0),
      contributions,
    };
  });
  scored.sort((a, b) => b.score - a.score || a.order - b.order);
  const [winner, runner] = scored;
  const margin = runner ? winner!.score - runner.score : winner!.score;
  return {
    kind: winner!.kind,
    confidence: sigmoidMille(margin),
    margin,
    runnerUp: runner?.kind ?? null,
    alternatives: scored.slice(0, 3).map((candidate) => candidate.kind),
    why: [...winner!.contributions]
      .sort((a, b) => b.weight - a.weight || (a.feature < b.feature ? -1 : 1))
      .slice(0, 3)
      .map((c) => c.feature),
  };
}

/** Numbers named by a max or min word right after it: "(max 8)", "högst 8", "at least 2" (#29). */
function chipsOf(words: LabelWords): Chip[] {
  const chips: Chip[] = [];
  for (const match of words.matches) {
    const name = match.feature === 'maxWords' ? 'max' : match.feature === 'minWords' ? 'min' : null;
    if (name) {
      const next = words.tokens[match.to];
      const value = next && /^\d{1,5}$/u.test(next.text) ? Number.parseInt(next.text, 10) : null;
      // A word several languages share ("max") is one chip.
      if (value !== null && !chips.some((chip) => chip.name === name && chip.value === value)) {
        chips.push({ name, value });
      }
    }
    if (match.feature === 'repeatableHint' && !chips.some((chip) => chip.name === 'repeatable')) {
      chips.push({ name: 'repeatable', value: null });
    }
  }
  return chips;
}

/**
 * Whether the label says it must be answered (#26): an asterisk, or a required word in any
 * language — or that it need not be. No hint is `unknown`, and stage 7 caps that decision.
 */
function requiredOf(label: string, words: LabelWords): [RequiredReading, string | null] {
  if (label.includes('*')) return ['yes', '*'];
  const said = words.matches.find((m) => m.feature === 'required' || m.feature === 'optional');
  if (!said) return ['unknown', null];
  return [said.feature === 'required' ? 'yes' : 'no', label.slice(said.start, said.end)];
}

/**
 * A personnummer or organisation-number format (#27): applied only when the document is in the
 * language whose word matched; offered as a chip when exactly one language's word matched and the
 * document's language is unknown or another; none when that is ambiguous.
 */
function formatFor(
  kind: Kind,
  words: LabelWords,
  locale: LayoutLanguage | null,
): FormatProposal | null {
  const feature =
    kind === 'personnummer' ? 'personnummerWord' : kind === 'orgnr' ? 'orgNrWord' : null;
  if (!feature) return null;
  const languages = [
    ...new Set(words.matches.filter((m) => m.feature === feature).map((m) => m.language)),
  ].filter((language) => formatOf(language, feature) !== null);
  if (locale && languages.includes(locale))
    return { name: formatOf(locale, feature)!, apply: true };
  if (languages.length === 1) return { name: formatOf(languages[0]!, feature)!, apply: false };
  return null;
}

export function classify(
  doc: LayoutDocument,
  segmented: SegmentResult,
): StageResult<ClassifyResult> {
  const locale = LAYOUT_LANGUAGES.find((language) => language === doc.locale) ?? null;
  const languages = languagesFor(locale);
  const lines = new Map(
    doc.pages.flatMap((page) =>
      page.blocks.flatMap((block) => block.lines.map((line) => [line.id, line] as const)),
    ),
  );
  const decisions: Decision[] = [];
  const classified: Classification[] = [];
  const firsts = new Map<string, number>();

  /** The words and patterns of a label, as features. */
  const wordFeatures = (label: string, words: LabelWords, present: Set<Feature>) => {
    for (const match of words.matches) present.add(match.feature);
    if (DATE_PATTERN.test(label)) present.add('datePattern');
    if (TIME_PATTERN.test(label)) present.add('timeSlotPattern');
  };

  segmented.segments.forEach((segment, segmentIndex) => {
    if (segment.kind !== 'question' && segment.kind !== 'grid' && segment.kind !== 'table') return;
    const first = segment.lineIds[0]!;
    const seen = firsts.get(first) ?? 0;
    firsts.set(first, seen + 1);
    const subject = seen === 0 ? first : `${first}#${seen + 1}`;

    const label = labelOf(segment);
    const words = wordsIn(label, languages);
    const present = new Set<Feature>();
    wordFeatures(label, words, present);
    let candidates: readonly Kind[];
    let columns: ColumnKind[] | null = null;
    if (segment.kind === 'question') {
      candidates = WEIGHTS.candidates[segment.answer];
      if (segment.answer === 'choice') present.add('answerChoice');
      if (segment.answer === 'boolean') {
        present.add('answerBoolean');
        present.add(segment.options.length === 2 ? 'booleanPair' : 'singleCheckbox');
      }
      const spaces = segment.lineIds.filter((id) => {
        const hints = lines.get(id)!.hints;
        return hints.blankRun || hints.ruleBelow;
      });
      if (segment.answer === 'blank' && spaces.length >= 2) present.add('multiLineBlank');
      if (segment.answer === 'unknown' && [...label].length > 120) present.add('longPromptNoBlank');
    } else if (segment.kind === 'grid') {
      candidates = WEIGHTS.candidates.grid;
      present.add(segment.columns.length >= 2 ? 'gridAlignment' : 'gridSingleColumn');
    } else {
      candidates = WEIGHTS.candidates.table;
      present.add('tableRows');
      columns = segment.columns.map((column) => {
        const own = new Set<Feature>();
        wordFeatures(column, wordsIn(column, languages), own);
        const read = best(WEIGHTS.candidates.blank, own);
        return { label: column, kind: read.kind, confidence: read.confidence };
      });
    }

    const read = best(candidates, present);
    const [required, requiredBy] = requiredOf(label, words);
    const format = formatFor(read.kind, words, locale);
    const features = [...present].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    classified.push({
      segmentIndex,
      subject,
      kind: read.kind,
      confidence: read.confidence,
      margin: read.margin,
      runnerUp: read.runnerUp,
      alternatives: read.alternatives,
      why: read.why,
      features,
      required,
      requiredBy,
      format,
      presentation: read.kind === 'consent' ? 'consent' : null,
      chips: chipsOf(words),
      columns,
    });
    decisions.push({
      id: `classify:${subject}`,
      rule: 'K1',
      subject: segment.lineIds,
      verdict: read.kind,
      evidence: {
        confidence: read.confidence,
        margin: read.margin,
        runnerUp: read.runnerUp ?? 'none',
        features: features.join(' '),
        required,
        ...(format ? { format: `${format.name}${format.apply ? '' : ' (chip)'}` } : {}),
      },
    });
  });

  return {
    output: { classified },
    debug: {
      stage: 'classify',
      stageVersion: CLASSIFY_STAGE_VERSION,
      irVersion: 1,
      inputSha256: inputsSha256({ layout: doc, segments: segmented }),
      decisions,
    },
  };
}
