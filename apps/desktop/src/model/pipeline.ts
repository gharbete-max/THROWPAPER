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
  summaryIn,
  translateInto,
  translationCap,
  type JobStep,
  type JobWarning,
  type ModelJob,
} from '@tp/shared/summary';
import { JobError, type Engine } from './engine.js';
import {
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
 * Nothing here knows which model is behind the {@link Engine}, and nothing here touches a network.
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
  onText?: (text: string) => void;
}

/** One call, guarded: cancel and the loop guard both abort it; only the second is not an error. */
async function ask(engine: Engine, signal: AbortSignal, request: Ask) {
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
  engine: Engine,
  job: ModelJob,
  sink: Sink,
  signal: AbortSignal,
): Promise<JobOutcome> {
  const warnings: JobWarning[] = [];
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
  engine: Engine,
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
  engine: Engine,
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
  engine: Engine,
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
