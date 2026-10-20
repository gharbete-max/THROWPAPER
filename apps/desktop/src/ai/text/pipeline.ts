import { mustQuote } from '@tp/shared/quoted';
import {
  MAP_CHUNK_TOKENS,
  ONE_CALL_TOKENS,
  OUTPUT_CAPS,
  SHOWN_CHARS,
  TRANSLATE_GROUP_TOKENS,
  chunkParagraphs,
  digitCheck,
  parseSelection,
  reduceCap,
  repeatsARun,
  quoteAsData,
  PROOFREAD_LIMITS,
  PROOFREAD_SCHEMA,
  SHORT_MATERIAL,
  mergeIssues,
  missingSpans,
  verifyIssues,
  type ComposeTask,
  type ProofreadTask,
  REPLY_LIMITS,
  replyFlags,
  summaryIn,
  translateInto,
  translationCap,
  type JobStep,
  type JobWarning,
  type ModelJob,
  type ReplyTask,
} from '@tp/shared/summary';
import type { TextTask } from '@tp/shared/ai';
import { JobError, type TextEngine } from './text-engine.js';
import {
  composeSystem,
  composeUser,
  proofreadSystem,
  spellingSystem,
  proofreadUser,
  draftReplyUser,
  neutralReplyUser,
  editReplyUser,
  replyEditSystem,
  replySystem,
  formUser,
  mapUser,
  pageUser,
  reduceUser,
  selectSystem,
  selectUser,
  summarySystem,
  translateSystem,
} from './prompts.js';

/**
 * What Loppa does around the model (spike S1, section 8; ADR 0023 section 4).
 *
 * - **Summary.** A text that fits one call is summarised in one. A longer one is cut into
 *   2,200-token pieces on paragraph boundaries, each piece is noted in at most four bullets (map),
 *   and the notes are combined into exactly one bullet per part (reduce) — the first reduce prompt
 *   lost most later parts. Notes too long for one reduce are grouped and noted again.
 * - **Translation.** Paragraph groups of at most 700 tokens, each shown as it finishes.
 * - **Quote, never reword.** Contracts, consents, declarations and clinical forms are refused here
 *   too (the pane already routes them to {@link select}): the model is given numbered passages and
 *   answers with numbers under a grammar; the pane quotes its own copy of the text.
 * - **Around every call.** A loop guard (an 8-token run repeated three times stops the call), an
 *   output cap, and at the end a comparison of the output's numbers with the source's.
 *
 * Nothing here knows which model is behind the {@link TextEngine}, and nothing here touches a network.
 */

/** About thirty printed pages. Beyond it a summary takes an hour on a laptop; say so instead. */
export const MAX_CHARS = 150_000;
/** Notes that exceed this are grouped and noted again before the reduce. */
export const NOTES_BUDGET_TOKENS = 2200;
const MAX_REDUCE_LEVELS = 4;

export interface Sink {
  step(step: JobStep, done: number, total: number): void;
  text(mode: 'replace' | 'append', text: string): void;
  selected(numbers: number[]): void;
}

export interface JobOutcome {
  warnings: JobWarning[];
}

interface Ask {
  system: string;
  user: string;
  maxTokens: number;
  choose?: number;
  schema?: { name: string; schema: object };
  onText?: (text: string) => void;
}

/** One call, guarded: cancel and the loop guard both abort it; only the second is not an error. */
async function ask(engine: TextEngine, signal: AbortSignal, request: Ask) {
  if (signal.aborted) throw new JobError('cancelled');
  const loop = new AbortController();
  const tokens: string[] = [];
  const text = await engine.generate({
    ...request,
    signal: AbortSignal.any([signal, loop.signal]),
    onTokens: (ids) => {
      for (const id of ids) {
        tokens.push(id);
        if (repeatsARun(tokens)) {
          loop.abort();
          return;
        }
      }
    },
  });
  if (signal.aborted) throw new JobError('cancelled');
  return { text: text.trim(), looped: loop.signal.aborted };
}

export async function runJob(
  engine: TextEngine,
  job: TextTask,
  sink: Sink,
  signal: AbortSignal,
): Promise<JobOutcome> {
  const warnings: JobWarning[] = [];
  if (isReply(job)) {
    await reply(engine, job, sink, signal, warnings);
    return { warnings };
  }
  if (job.kind === 'proofread') {
    await proofread(engine, job, sink, signal);
    return { warnings };
  }
  if (job.kind === 'compose-email') {
    await compose(engine, job, sink, signal, warnings);
    return { warnings };
  }
  if (job.kind === 'select') {
    await select(engine, job, sink, signal);
    return { warnings };
  }

  if (job.text.length > MAX_CHARS) throw new JobError('too-long');
  if (job.kind === 'summarise' ? summaryIn(job.into) === 'no' : translateInto(job.into) === 'no') {
    throw new JobError('language-refused');
  }
  // The pane routes these to `select`; this is the model's own door refusing as well.
  if (mustQuote(job.text).quoteOnly) throw new JobError('quote-only');

  if (job.kind === 'summarise') await summarise(engine, job, sink, signal, warnings);
  else await translate(engine, job, sink, signal, warnings);
  return { warnings };
}

type Summarise = Extract<ModelJob, { kind: 'summarise' }>;
type Translate = Extract<ModelJob, { kind: 'translate' }>;

function digits(warnings: JobWarning[], source: string, output: string, strict: boolean): void {
  const check = digitCheck(source, output);
  if (check.added.length > 0) warnings.push({ kind: 'numbers-added', numbers: check.added });
  if (strict && check.missing.length > 0) {
    warnings.push({ kind: 'numbers-missing', numbers: check.missing });
  }
}

async function summarise(
  engine: TextEngine,
  job: Summarise,
  sink: Sink,
  signal: AbortSignal,
  warnings: JobWarning[],
): Promise<void> {
  const count = (text: string) => engine.countTokens(text);
  const { text, into } = job;
  const system = summarySystem(into);

  const write = async (user: string, maxTokens: number): Promise<string> => {
    let shown = '';
    const result = await ask(engine, signal, {
      system,
      user,
      maxTokens,
      onText: (piece) => {
        shown += piece;
        sink.text('replace', shown);
      },
    });
    if (result.looped) warnings.push({ kind: 'repetition' });
    sink.text('replace', result.text);
    return result.text;
  };

  if (count(text) <= ONE_CALL_TOKENS) {
    sink.step('writing', 0, 1);
    const user = job.shape === 'form' ? formUser(into, text) : pageUser(into, text);
    const out = await write(user, job.shape === 'form' ? OUTPUT_CAPS.form : OUTPUT_CAPS.page);
    digits(warnings, text, out, false);
    sink.step('writing', 1, 1);
    return;
  }

  // Map: a few bullets for each piece.
  const note = async (piece: string): Promise<string> => {
    const result = await ask(engine, signal, {
      system,
      user: mapUser(into, piece),
      maxTokens: OUTPUT_CAPS.map,
    });
    if (result.looped) warnings.push({ kind: 'repetition' });
    return result.text;
  };

  const pieces = chunkParagraphs(text, MAP_CHUNK_TOKENS, count);
  let notes: string[] = [];
  for (const [index, piece] of pieces.entries()) {
    sink.step('reading', index, pieces.length);
    notes.push(await note(piece));
  }
  sink.step('reading', pieces.length, pieces.length);

  // Notes that would not fit next to the instructions are noted again, in groups.
  let level = 1;
  while (count(notes.join('\n')) > NOTES_BUDGET_TOKENS && level < MAX_REDUCE_LEVELS) {
    const lines = notes.flatMap((n) => n.split('\n')).filter((line) => line.trim() !== '');
    const groups = chunkParagraphs(lines.join('\n\n'), MAP_CHUNK_TOKENS, count);
    const next: string[] = [];
    for (const [index, group] of groups.entries()) {
      sink.step('combining', index, groups.length);
      next.push(await note(group));
    }
    notes = next;
    level += 1;
  }

  sink.step('writing', 0, 1);
  const out =
    notes.length === 1 ? notes[0]! : await write(reduceUser(into, notes), reduceCap(notes.length));
  if (notes.length === 1) sink.text('replace', out);
  sink.step('writing', 1, 1);
  digits(warnings, text, out, false);
}

async function translate(
  engine: TextEngine,
  job: Translate,
  sink: Sink,
  signal: AbortSignal,
  warnings: JobWarning[],
): Promise<void> {
  const count = (text: string) => engine.countTokens(text);
  const groups = chunkParagraphs(job.text, TRANSLATE_GROUP_TOKENS, count);
  const system = translateSystem(job.into);
  const done: string[] = [];
  const translated: string[] = [];
  for (const [index, group] of groups.entries()) {
    sink.step('translating', index, groups.length);
    const result = await ask(engine, signal, {
      system,
      user: group,
      maxTokens: translationCap(count(group)),
    });
    // A group that began to repeat itself is not shown: it is the failure the spike saw in
    // Icelandic, and what precedes it is not trustworthy either.
    if (result.looped) {
      warnings.push({ kind: 'repetition' });
      break;
    }
    done.push(group);
    sink.text('append', `${index > 0 ? '\n\n' : ''}${result.text}`);
    translated.push(result.text);
  }
  sink.step('translating', done.length, groups.length);
  if (translated.length > 0) digits(warnings, done.join('\n\n'), translated.join('\n\n'), true);
}

async function select(
  engine: TextEngine,
  job: Extract<ModelJob, { kind: 'select' }>,
  sink: Sink,
  signal: AbortSignal,
): Promise<void> {
  const { passages } = job;
  if (passages.join('').length > MAX_CHARS) throw new JobError('too-long');
  const system = selectSystem(job.language);
  const chosen = new Set<number>();

  // Windows of passages that fit the model's context; each is asked on its own.
  const windows: Array<{ from: number; lines: string[] }> = [];
  let current: { from: number; lines: string[] } = { from: 0, lines: [] };
  let used = 0;
  for (const [index, passage] of passages.entries()) {
    const cost = engine.countTokens(passage.slice(0, SHOWN_CHARS)) + 8;
    if (current.lines.length > 0 && used + cost > ONE_CALL_TOKENS) {
      windows.push(current);
      current = { from: index, lines: [] };
      used = 0;
    }
    current.lines.push(`[${current.lines.length + 1}] ${passage.slice(0, SHOWN_CHARS)}`);
    used += cost;
  }
  if (current.lines.length > 0) windows.push(current);

  for (const [index, window] of windows.entries()) {
    sink.step('reading', index, windows.length);
    const result = await ask(engine, signal, {
      system,
      user: selectUser(window.lines),
      maxTokens: OUTPUT_CAPS.select,
      choose: window.lines.length,
    });
    const numbers = parseSelection(result.text, window.lines.length);
    if (!numbers) throw new JobError('failed', 'the model did not answer with passage numbers');
    for (const n of numbers) chosen.add(window.from + n);
  }
  sink.step('reading', windows.length, windows.length);
  sink.selected([...chosen].sort((a, b) => a - b));
}

const isReply = (job: TextTask): job is ReplyTask => job.kind.endsWith('-reply');

/**
 * Proofreading: the text is cut like a summary's, each piece is asked for a list of issues under a
 * grammar, and everything the model says is verified against the text before it is shown (a span not
 * found word for word is dropped and counted). Numbers the source never had are found without the
 * model. The answer is one JSON text, `{issues, rejected}`, the whole of it each time.
 */
async function proofread(
  engine: TextEngine,
  job: ProofreadTask,
  sink: Sink,
  signal: AbortSignal,
): Promise<void> {
  if (job.text.length > PROOFREAD_LIMITS.text || job.source.length > PROOFREAD_LIMITS.source) {
    throw new JobError('too-long');
  }
  if (summaryIn(job.into) === 'no') throw new JobError('language-refused');
  const count = (text: string) => engine.countTokens(text);
  const text = quoteAsData(job.text);
  const source = quoteAsData(job.source);
  const pieces = chunkParagraphs(text, MAP_CHUNK_TOKENS, count);
  // The source is shown to the model only when it fits next to a piece; otherwise the number check
  // below is all the factual check there is.
  const withSource =
    source !== '' && count(source) + Math.max(...pieces.map(count), 0) <= ONE_CALL_TOKENS;
  // Two passes over each piece: the general one, then one that only looks for misspelt words (the
  // model misses a swapped letter when it is also asked about grammar and sense, spike on the real
  // model). What the second finds that the first already found is not counted twice.
  const system = proofreadSystem(job.into, withSource);
  const spelling = spellingSystem(job.into);
  const raw: unknown[] = [];
  const ask2 = async (prompt: string, user: string): Promise<Array<{ span?: unknown }>> => {
    const result = await ask(engine, signal, {
      system: prompt,
      user,
      maxTokens: 700,
      schema: { name: 'proofread', schema: PROOFREAD_SCHEMA },
    });
    try {
      const issues = (JSON.parse(result.text) as { issues?: unknown }).issues;
      return Array.isArray(issues) ? issues : [];
    } catch {
      // An answer that is not JSON has no issues in it; the pieces that were read still count.
      return [];
    }
  };
  for (const [index, piece] of pieces.entries()) {
    sink.step('reading', index * 2, pieces.length * 2);
    const general = await ask2(system, proofreadUser(piece, withSource ? source : null));
    raw.push(...general);
    sink.step('reading', index * 2 + 1, pieces.length * 2);
    const unmatched = [...general];
    for (const entry of await ask2(spelling, proofreadUser(piece, null))) {
      const same = unmatched.findIndex((found) => found.span === entry.span);
      if (same >= 0) unmatched.splice(same, 1);
      else raw.push(entry);
    }
  }
  sink.step('reading', pieces.length * 2, pieces.length * 2);
  const merged = mergeIssues(text, verifyIssues(text, { issues: raw }, source), source);
  sink.text('replace', JSON.stringify(merged));
}

const COMPOSE_CAP = 700;

/**
 * A corporate email from material (a summary, or review comments). The material is quoted data,
 * the model has no tools, and a material that trips the quote-only word lists gets a neutral note
 * and nothing of it (ADR 0012). Afterwards: numbers the writer never supplied, an attachment named,
 * the wrong language, and for a review, quotes the email left out.
 */
async function compose(
  engine: TextEngine,
  job: ComposeTask,
  sink: Sink,
  signal: AbortSignal,
  warnings: JobWarning[],
): Promise<void> {
  if (
    job.material.length > PROOFREAD_LIMITS.material ||
    job.notes.length > PROOFREAD_LIMITS.notes ||
    job.recipient.length > PROOFREAD_LIMITS.recipient
  ) {
    throw new JobError('too-long');
  }
  if (translateInto(job.into) === 'no') throw new JobError('language-refused');
  const material = quoteAsData(job.material);
  if (material === '') throw new JobError('failed', 'nothing to write about');
  const neutral = mustQuote([job.material, job.notes].join('\n')).quoteOnly;
  sink.step('writing', 0, 1);
  let shown = '';
  const result = await ask(engine, signal, {
    system: composeSystem(job.into, job.tone, neutral, job.purpose, job.overall),
    user: composeUser(material, quoteAsData(job.recipient), quoteAsData(job.notes), neutral),
    maxTokens: COMPOSE_CAP,
    onText: (piece) => {
      shown += piece;
      sink.text('replace', shown);
    },
  });
  sink.text('replace', result.text);
  sink.step('writing', 1, 1);
  if (result.looped) warnings.push({ kind: 'repetition' });
  // A neutral note quotes nothing, so there is nothing to check it against.
  const reference = neutral ? [''] : [job.material, job.notes];
  const flags = replyFlags(result.text, reference, job.into);
  if (flags.invented.length > 0) warnings.push({ kind: 'numbers-added', numbers: flags.invented });
  if (flags.attachment) warnings.push({ kind: 'attachment-mentioned' });
  if (flags.wrongLanguage) warnings.push({ kind: 'wrong-language' });
  // A summary is short enough for an email to keep its numbers: one that dropped a date is flagged
  // (the real model replaced a given date with a placeholder). A whole document may leave some out.
  if (!neutral && job.purpose === 'summary' && material.length <= SHORT_MATERIAL) {
    const missing = digitCheck(material, result.text).missing;
    if (missing.length > 0) warnings.push({ kind: 'numbers-missing', numbers: missing });
  }
  const left = neutral ? [] : missingSpans(result.text, job.quotes);
  if (left.length > 0) warnings.push({ kind: 'spans-missing', spans: left });
}

/** What a draft may take its numbers from: never the draft, always what the writer supplied. */
export const replyReference = (job: ReplyTask): string[] => [
  job.received,
  job.notes,
  job.kind === 'revise-reply' ? job.instruction : '',
];

const REPLY_CAPS = { draft: 500, shorten: 350, revise: 500 } as const;

/**
 * The email reply helper (docs/plan/AI-SYSTEM.md D6). One guarded call, shown as it is written,
 * then the checks of {@link replyFlags}: numbers the writer never supplied, an attachment named,
 * the wrong language. A message that trips the quote-only word lists gets a neutral
 * acknowledgement and nothing else, and its terms are never translated (ADR 0012). Nothing is sent
 * and nothing is kept: the model has no tools, and what it writes goes to the window only.
 */
async function reply(
  engine: TextEngine,
  job: ReplyTask,
  sink: Sink,
  signal: AbortSignal,
  warnings: JobWarning[],
): Promise<void> {
  const draft = job.kind === 'draft-reply' ? '' : job.draft;
  const instruction = job.kind === 'revise-reply' ? job.instruction : '';
  if (
    job.received.length > REPLY_LIMITS.received ||
    job.notes.length > REPLY_LIMITS.notes ||
    draft.length > REPLY_LIMITS.draft ||
    instruction.length > REPLY_LIMITS.instruction
  ) {
    throw new JobError('too-long');
  }
  if (translateInto(job.into) === 'no') throw new JobError('language-refused');
  const received = quoteAsData(job.received);
  const notes = quoteAsData(job.notes);
  if (job.kind === 'draft-reply' && received === '' && notes === '') {
    throw new JobError('failed', 'nothing to answer and nothing to say');
  }
  // Legal and clinical wording is not reinterpreted, restated or translated.
  const neutral = mustQuote([job.received, job.notes, draft].join('\n')).quoteOnly;
  if (neutral && job.kind === 'translate-reply') throw new JobError('quote-only');

  const request: Omit<Ask, 'onText'> =
    job.kind === 'draft-reply'
      ? {
          system: replySystem(job.into, job.tone, neutral),
          user: neutral ? neutralReplyUser() : draftReplyUser(received, notes),
          maxTokens: REPLY_CAPS.draft,
        }
      : {
          system: replyEditSystem(
            job.kind.replace('-reply', '') as 'shorten' | 'translate' | 'revise',
            job.into,
            job.tone,
            neutral,
          ),
          user: editReplyUser(
            quoteAsData(draft),
            job.kind === 'revise-reply' ? quoteAsData(instruction) : undefined,
          ),
          maxTokens:
            job.kind === 'shorten-reply'
              ? REPLY_CAPS.shorten
              : job.kind === 'translate-reply'
                ? translationCap(engine.countTokens(draft))
                : REPLY_CAPS.revise,
        };

  sink.step('writing', 0, 1);
  let shown = '';
  const result = await ask(engine, signal, {
    ...request,
    onText: (piece) => {
      shown += piece;
      sink.text('replace', shown);
    },
  });
  sink.text('replace', result.text);
  sink.step('writing', 1, 1);
  if (result.looped) warnings.push({ kind: 'repetition' });

  const flags = replyFlags(result.text, replyReference(job), job.into);
  if (flags.invented.length > 0) warnings.push({ kind: 'numbers-added', numbers: flags.invented });
  if (flags.attachment) warnings.push({ kind: 'attachment-mentioned' });
  if (flags.wrongLanguage) warnings.push({ kind: 'wrong-language' });
}
