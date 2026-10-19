import { mustQuote } from '../import/quoted/quoted.js';
import { digitCheck } from './check.js';
import { SUMMARY_LOCALES, type SummaryLocale } from './languages.js';
import { REPLY_TONES, type ReplyTone } from './reply.js';

/**
 * Proofreading and the emails built on it (docs/plan/AI-SYSTEM.md D6, ADR 0025): the pure parts.
 *
 * The model reads a text and answers with a LIST of issues. Nothing it says is trusted until it has
 * been checked here: a span that is not in the text word for word is dropped (and counted), a fix
 * that brings in a number the span and the source never had is dropped, and a text that is a
 * contract, consent, declaration or clinical form (`mustQuote`) is held to spelling only, so no
 * legal or clinical wording is ever suggested (CLAUDE.md rule 8). Accepted fixes are applied to a
 * COPY of the text and never to the original.
 *
 * No model runs here. The prompts are in `apps/desktop/src/ai/text/prompts.ts`.
 */

export const PROOFREAD_KINDS = ['spelling', 'grammar', 'wording', 'factual-doubt'] as const;
export type ProofreadKind = (typeof PROOFREAD_KINDS)[number];

/** Characters, so a limit means the same in every script. */
export const PROOFREAD_LIMITS = {
  text: 20_000,
  source: 20_000,
  issues: 30,
  material: 12_000,
  recipient: 120,
  notes: 2_000,
} as const;

/** What the model is asked for, as a grammar, so it can only answer with this shape. */
export const PROOFREAD_SCHEMA = {
  type: 'object',
  properties: {
    issues: {
      type: 'array',
      maxItems: 12,
      items: {
        type: 'object',
        properties: {
          span: { type: 'string', minLength: 1, maxLength: 160 },
          kind: { type: 'string', enum: [...PROOFREAD_KINDS] },
          fix: { type: 'string', maxLength: 200 },
        },
        required: ['span', 'kind', 'fix'],
        additionalProperties: false,
      },
    },
  },
  required: ['issues'],
  additionalProperties: false,
} as const;

/** `text` is what is checked; `source` (or '') is what a factual doubt is checked against. */
export interface ProofreadTask {
  kind: 'proofread';
  text: string;
  source: string;
  /** The language the text is written in. */
  into: SummaryLocale;
}

export interface Issue {
  id: number;
  kind: ProofreadKind;
  /** Exactly as it stands in the text. */
  span: string;
  /** Where it stands: `text.slice(start, end) === span`. */
  start: number;
  end: number;
  /** What to put there; null when the reader is only told to look (an added number). */
  fix: string | null;
}

export interface Verified {
  issues: Issue[];
  /** Answers dropped because they could not be checked: a span not in the text, a bad kind, an invented number. */
  rejected: number;
}

const isKind = (value: unknown): value is ProofreadKind =>
  (PROOFREAD_KINDS as readonly unknown[]).includes(value);

/**
 * Checks what the model said against the text it was given. Order of the text, never overlapping,
 * the first place a span stands that no earlier issue has taken.
 */
export function verifyIssues(text: string, raw: unknown, source = ''): Verified {
  const list =
    typeof raw === 'object' && raw !== null && Array.isArray((raw as { issues?: unknown }).issues)
      ? ((raw as { issues: unknown[] }).issues as unknown[])
      : [];
  const spellingOnly = mustQuote(text).quoteOnly;
  const taken: Array<[number, number]> = [];
  const found: Omit<Issue, 'id'>[] = [];
  let rejected = 0;
  for (const item of list.slice(0, PROOFREAD_LIMITS.issues)) {
    const entry = (typeof item === 'object' && item !== null ? item : {}) as Record<
      string,
      unknown
    >;
    const { span, kind, fix } = entry;
    if (typeof span !== 'string' || span === '' || !isKind(kind) || typeof fix !== 'string') {
      rejected += 1;
      continue;
    }
    if (spellingOnly && kind !== 'spelling') {
      rejected += 1;
      continue;
    }
    // A fix that is the span, or that brings in a number neither the span nor the source has.
    if (fix === span || digitCheck(`${span}\n${source}`, fix).added.length > 0) {
      rejected += 1;
      continue;
    }
    let at = text.indexOf(span);
    while (at >= 0 && taken.some(([from, to]) => at < to && at + span.length > from)) {
      at = text.indexOf(span, at + 1);
    }
    if (at < 0) {
      rejected += 1;
      continue;
    }
    taken.push([at, at + span.length]);
    found.push({ kind, span, start: at, end: at + span.length, fix });
  }
  return { issues: numbered(found), rejected };
}

function numbered(found: Omit<Issue, 'id'>[]): Issue[] {
  return found
    .sort((a, b) => a.start - b.start)
    .map((issue, index) => ({ ...issue, id: index + 1 }));
}

/**
 * Numbers in a summary (or any derived text) that its source does not have: a factual doubt found
 * without a model. Each is the token as written, at the first place it stands.
 */
export function addedNumberDoubts(text: string, source: string): Omit<Issue, 'id'>[] {
  if (source.trim() === '') return [];
  const added = new Set(digitCheck(source, text).added);
  const doubts: Omit<Issue, 'id'>[] = [];
  for (const match of text.matchAll(/\d+/g)) {
    const normal = String(Number.parseInt(match[0].normalize('NFKC'), 10));
    if (!added.has(normal)) continue;
    added.delete(normal);
    doubts.push({
      kind: 'factual-doubt',
      span: match[0],
      start: match.index,
      end: match.index + match[0].length,
      fix: null,
    });
  }
  return doubts;
}

/** The model's issues and the number doubts together; a doubt inside a model issue is not repeated. */
export function mergeIssues(text: string, verified: Verified, source: string): Verified {
  const doubts = addedNumberDoubts(text, source).filter(
    (doubt) => !verified.issues.some((issue) => doubt.start < issue.end && doubt.end > issue.start),
  );
  const all = [...verified.issues.map(({ id: _id, ...rest }) => rest), ...doubts];
  return { issues: numbered(all), rejected: verified.rejected };
}

/** The text with the accepted fixes applied. A new string: the original is never changed. */
export function applyFixes(
  text: string,
  issues: readonly Issue[],
  accepted: ReadonlySet<number>,
): string {
  let out = text;
  for (const issue of [...issues].sort((a, b) => b.start - a.start)) {
    if (!accepted.has(issue.id) || issue.fix === null) continue;
    if (text.slice(issue.start, issue.end) !== issue.span) continue;
    out = out.slice(0, issue.start) + issue.fix + out.slice(issue.end);
  }
  return out;
}

// --- Emails --------------------------------------------------------------------------------

export const COMPOSE_PURPOSES = ['summary', 'feedback'] as const;
export type ComposePurpose = (typeof COMPOSE_PURPOSES)[number];

/**
 * A corporate email written from material. `material` is UNTRUSTED (a summary of someone's
 * document, or a list of review comments quoting it) and is only ever placed in the prompt as quoted
 * data. `recipient` and `notes` are the writer's own words. Shorter, translate and revise work on
 * the draft with the existing reply tasks.
 */
export interface ComposeTask {
  kind: 'compose-email';
  purpose: ComposePurpose;
  material: string;
  recipient: string;
  notes: string;
  into: SummaryLocale;
  tone: ReplyTone;
  /** For a review: the writer's overall view. Praise is never invented. */
  overall: 'good' | 'mixed';
  /** Passages the email must quote word for word (a review's spans); [] for a summary. */
  quotes: string[];
}

const str = (value: unknown, max: number) => typeof value === 'string' && value.length <= max;
const locale = (value: unknown) => (SUMMARY_LOCALES as readonly unknown[]).includes(value);

export function isProofreadTask(value: unknown): value is ProofreadTask {
  if (typeof value !== 'object' || value === null) return false;
  const task = value as Record<string, unknown>;
  return (
    task.kind === 'proofread' &&
    str(task.text, PROOFREAD_LIMITS.text) &&
    (task.text as string).trim() !== '' &&
    str(task.source, PROOFREAD_LIMITS.source) &&
    locale(task.into)
  );
}

export function isComposeTask(value: unknown): value is ComposeTask {
  if (typeof value !== 'object' || value === null) return false;
  const task = value as Record<string, unknown>;
  return (
    task.kind === 'compose-email' &&
    (COMPOSE_PURPOSES as readonly unknown[]).includes(task.purpose) &&
    str(task.material, PROOFREAD_LIMITS.material) &&
    (task.material as string).trim() !== '' &&
    str(task.recipient, PROOFREAD_LIMITS.recipient) &&
    str(task.notes, PROOFREAD_LIMITS.notes) &&
    locale(task.into) &&
    (REPLY_TONES as readonly unknown[]).includes(task.tone) &&
    (task.overall === 'good' || task.overall === 'mixed') &&
    Array.isArray(task.quotes) &&
    task.quotes.length <= PROOFREAD_LIMITS.issues &&
    task.quotes.every((quote) => str(quote, 400))
  );
}

/** One page's range in a document's text, for pointing at a page from an offset. */
export interface PageRange {
  page: number;
  start: number;
  end: number;
}

export function pageOfOffset(ranges: readonly PageRange[], offset: number): number | null {
  return ranges.find((range) => offset >= range.start && offset < range.end)?.page ?? null;
}

/**
 * The review comments as the material of a feedback email: one numbered line per issue, the span
 * quoted exactly, the fix (when there is one) and the page. The email must quote these spans.
 */
export function feedbackMaterial(
  issues: readonly Issue[],
  pages: readonly PageRange[],
  label: (kind: ProofreadKind) => string,
): { material: string; spans: string[] } {
  const lines = issues.map((issue) => {
    const page = pageOfOffset(pages, issue.start);
    return `${issue.id}. ${label(issue.kind)}${page === null ? '' : `, page ${page}`}: "${issue.span}"${
      issue.fix === null ? '' : ` -> "${issue.fix}"`
    }`;
  });
  return { material: lines.join('\n'), spans: issues.map((issue) => issue.span) };
}

/** Spans (and fixes) the email should quote and does not, word for word. */
export function missingSpans(email: string, spans: readonly string[]): string[] {
  return spans.filter((span) => !email.includes(span));
}
