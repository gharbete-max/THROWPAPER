import { jsonEqual } from '../builder/changes.js';
import { evaluateGuard, parseGuard, type GuardState } from '../builder/graph/guards.js';
import { optionsOf, takesList, type BuilderGraph, type Node } from '../builder/graph/schema.js';
import type { Answer, Tier } from '../builder/machine.js';
import type { AliasEntry } from './aliases.js';
import { clausesOf } from './clauses.js';
import { languageOf } from './lexicon.js';
import { listOf } from './list.js';
import { readQuantity } from './patterns.js';
import {
  Budget,
  BudgetSpent,
  MAX_INPUT,
  NUMBER_IN_PHRASE,
  THRESHOLD,
  WHOLE_NUMBER,
  aliasMatches,
  inputOf,
  ranked,
  readNode,
  t2,
} from './rungs.js';
import {
  ask,
  type Alternative,
  type Interpretation,
  type Reading,
  type Unused,
} from './reading.js';
import { vocabularyFor, type Vocabulary } from './vocabulary.js';

export {
  COMPARISON_BUDGET,
  MARGIN,
  MAX_INPUT,
  NUMBER_IN_PHRASE,
  T2_CEILING,
  THRESHOLD,
  WHOLE_NUMBER,
} from './rungs.js';
export type { Alternative, AskReason, Interpretation, Reading, Unused } from './reading.js';

/**
 * The ladder — free text read by rules, cheapest and surest first (`docs/plan/INTENT-LADDER.md`,
 * ADR 0019). `rungs.ts` reads one node (T0–T4, S3); this file decides the order, and reads the
 * group the node belongs to (S6):
 *
 * 1. **T0** — the whole input is one of the node's own answers, exactly.
 * 2. **T5** — a sentence that answers several questions of the group at once: "three buttons,
 *    pill shape, side by side". Each question gets its own reading, so each becomes its own step.
 * 3. **T6** — a list, typed or pasted: the options themselves, labels verbatim.
 * 4. **T1–T4** — the node's own answer, as S3 reads it.
 * 5. **T7** — nothing fits this question, but one of the group's clearly does: a guess, to be
 *    confirmed; less clearly, up to three of those questions offered beside the menu.
 * 6. **T8** — the node's own options, as a menu. What the person then picks, Loppa offers to
 *    remember (`aliases.ts`, learned aliases), and only then.
 *
 * Nothing below threshold is ever applied. Pure and total: every input gets an interpretation,
 * and the same input, aliases and state give the same one on every machine.
 */

/** T6: a pasted list may be longer than a phrase. */
export const MAX_LIST = 2_000;
/** T6's confidence: a list is read by structure, and shown as "I think". */
export const LIST_CONFIDENCE = 850;
/** T7: a guess is offered at this many per mille — its evidence and its place in the path. */
export const GUESS = 600;
/** T7: the runner-up must be at least this far below the guess. */
export const GUESS_MARGIN = 150;
/** T7's path prior: the question `next` would reach, and the others of the group ahead. */
export const PRIOR_NEXT = 200;
export const PRIOR_GROUP = 100;

export interface InterpretContext {
  readonly graph: BuilderGraph;
  readonly nodeId: string;
  /** The author's interface language, e.g. `sv-SE`. */
  readonly locale: string;
  /** The built-in aliases by default; the conversation passes the organisation's learned ones too. */
  readonly aliases?: readonly AliasEntry[];
  /**
   * The conversation's state as guards read it (`guardStateOf`): T6 and T7 offer another question
   * of the group only when the conversation could ask it now. Absent, every one is offered.
   */
  readonly state?: GuardState;
}

/** How a chip under the node words the reading (`INTENT-LADDER.md`, "The contract"). */
export function chipOf(tier: Tier): 'understood' | 'think' | 'asked' {
  if (tier === 'T0' || tier === 'T1' || tier === 'T2' || tier === 'T3') return 'understood';
  return tier === 'T8' ? 'asked' : 'think';
}

/** The answer a reading gives the machine, for the node it names; pass `reading.tier` as its tier. */
export function toAnswer(graph: BuilderGraph, reading: Reading): Answer {
  const node = graph.nodes.find((n) => n.id === reading.nodeId);
  if (node?.kind === 'quantity') {
    return Array.isArray(reading.value)
      ? { kind: 'list', labels: reading.value as string[] }
      : { kind: 'quantity', value: reading.value as number };
  }
  if (node?.kind === 'pick-many') return { kind: 'options', optionIds: [reading.optionId!] };
  return { kind: 'option', optionId: reading.optionId! };
}

// --- The group --------------------------------------------------------------------------------

/** A node free text can answer: one with options, or a number. */
const readable = (node: Node) =>
  node.kind === 'question' ||
  node.kind === 'pick-one' ||
  node.kind === 'pick-many' ||
  node.kind === 'quantity';

/** The nodes `next` leads to from this one: its own, every branch, every option's. */
function nextOf(node: Node): string[] {
  const targets = (next: unknown): string[] =>
    typeof next === 'string'
      ? [next]
      : Array.isArray(next)
        ? next.map((branch: { to: string }) => branch.to)
        : [];
  return [
    ...('next' in node ? targets(node.next) : []),
    ...optionsOf(node).flatMap((o) => targets(o.next)),
  ];
}

const AHEAD = new WeakMap<BuilderGraph, Map<string, readonly Node[]>>();

/**
 * The node and every node of its group the conversation can go on to from it by answering, in the
 * graph's order: what a sentence typed here may answer (T5) or be guessed to mean (T7). Never a
 * node behind it — answering one again from here would change an answer the person gave, unseen.
 */
export function aheadOf(graph: BuilderGraph, nodeId: string): readonly Node[] {
  let byNode = AHEAD.get(graph);
  if (!byNode) AHEAD.set(graph, (byNode = new Map()));
  const known = byNode.get(nodeId);
  if (known) return known;
  const start = graph.nodes.find((n) => n.id === nodeId);
  const reached = new Set<string>();
  const queue = start ? [start] : [];
  while (queue.length > 0) {
    const node = queue.shift()!;
    if (reached.has(node.id)) continue;
    reached.add(node.id);
    for (const id of nextOf(node)) {
      const next = graph.nodes.find((n) => n.id === id);
      if (next && next.group === start!.group && !reached.has(id)) queue.push(next);
    }
  }
  const ahead = graph.nodes.filter((n) => reached.has(n.id));
  byNode.set(nodeId, ahead);
  return ahead;
}

/** Whether the conversation could ask the node now; with no state given, it could. */
function live(node: Node, state: GuardState | undefined): boolean {
  return (
    state === undefined || node.when === undefined || evaluateGuard(parseGuard(node.when), state)
  );
}

// --- The order --------------------------------------------------------------------------------

/** Free text at a node, read. Pure and total: every input gets an interpretation. */
export function interpret(input: string, context: InterpretContext): Interpretation {
  const node = context.graph.nodes.find((n) => n.id === context.nodeId);
  const language = languageOf(context.locale);
  if (!node || !language || !readable(node)) return ask('not-readable', []);
  if (input.length > MAX_LIST) return ask('too-long', []);
  const vocabulary = vocabularyFor(context.graph, language, context.aliases);
  const budget = new Budget();
  try {
    return read(input, node, context, vocabulary, budget);
  } catch (error) {
    if (!(error instanceof BudgetSpent)) throw error;
    const words = vocabulary.nodes.get(node.id);
    return ask('budget', words ? ranked(node.id, words, new Map()).slice(0, 6) : []);
  }
}

function read(
  input: string,
  node: Node,
  context: InterpretContext,
  vocabulary: Vocabulary,
  budget: Budget,
): Interpretation {
  const phrase = input.length <= MAX_INPUT;
  const own = phrase ? readNode(input, node, vocabulary, budget) : ask('too-long', []);
  if (own.outcome === 'apply' && own.reading.tier === 'T0') return own;

  const several = phrase ? severalAnswers(input, node, context, vocabulary, budget) : null;
  if (several) return several;
  const list = aList(input, node, context, vocabulary, budget);
  if (list) return list;

  if (own.outcome !== 'ask' || own.reason !== 'nothing') return own;
  return elsewhere(input, node, context, vocabulary, budget);
}

// --- T5: several answers in one sentence ------------------------------------------------------

/** A reading of part of the input, placed back in the whole input. */
const shifted = (reading: Reading, by: number): Reading => ({
  ...reading,
  evidenceSpan: [reading.evidenceSpan[0] + by, reading.evidenceSpan[1] + by],
});

/**
 * T5 (`INTENT-LADDER.md`): the input cut into clauses, each read by T0–T4 against every question
 * of the group from here on. A question is answered only when every clause that answers it says
 * the same — all or nothing per question — and T5 applies when two or more are. A clause may
 * answer more than one ("three buttons": how many, and buttons at all), but never with the same
 * words twice.
 *
 * Two rules keep it from reading more than was said, each found by a phrase-table row:
 * - **A misspelling is read only for the question asked.** Another question is answered by T0–T2
 *   or T4, never T3: "keine Knöpfe" is no buttons, not also "eine" (one answer).
 * - **One word, one answer.** Readings whose evidence overlaps keep the surest (the graph's order
 *   between equals); "samlet i én bjælke" is the joined bar, not also where it sits.
 */
function severalAnswers(
  input: string,
  node: Node,
  context: InterpretContext,
  vocabulary: Vocabulary,
  budget: Budget,
): Interpretation | null {
  const questions = aheadOf(context.graph, node.id).filter(readable);
  const clauses = clausesOf(input, vocabulary.lexicon);
  const found = new Map<string, { reading: Reading; clause: number }[]>();
  clauses.forEach((clause, index) => {
    const text = input.slice(clause.start, clause.end);
    for (const question of questions) {
      const read = readNode(text, question, vocabulary, budget);
      if (read.outcome !== 'apply' || read.reading.confidence < THRESHOLD) continue;
      if (question !== node && read.reading.tier === 'T3') continue;
      const list = found.get(question.id) ?? [];
      list.push({ reading: shifted(read.reading, clause.start), clause: index });
      found.set(question.id, list);
    }
  });

  // All or nothing per question: every clause that answers it must say the same.
  const agreed: { question: Node; all: { reading: Reading; clause: number }[] }[] = [];
  const contradicted = new Set<number>();
  for (const question of questions) {
    const all = found.get(question.id);
    if (!all) continue;
    const first = all[0]!.reading;
    const agree = all.every(
      ({ reading }) => reading.optionId === first.optionId && jsonEqual(reading.value, first.value),
    );
    if (agree) agreed.push({ question, all });
    else for (const { clause } of all) contradicted.add(clause);
  }

  // One word, one answer: the surest first, then the graph's order.
  const order = context.graph.nodes;
  const surest = [...agreed].sort(
    (a, b) =>
      b.all[0]!.reading.confidence - a.all[0]!.reading.confidence ||
      order.indexOf(a.question) - order.indexOf(b.question),
  );
  const taken: (readonly [number, number])[] = [];
  const overlaps = (span: readonly [number, number]) =>
    taken.some(([start, end]) => span[0] < end && start < span[1]);
  const kept = new Set<Node>();
  for (const { question, all } of surest) {
    const spans = all.map(({ reading }) => reading.evidenceSpan);
    if (spans.some(overlaps)) continue;
    taken.push(...spans);
    kept.add(question);
  }

  const readings: Reading[] = [];
  const used = new Set<number>();
  for (const { question, all } of agreed) {
    if (!kept.has(question)) continue;
    for (const { clause } of all) used.add(clause);
    readings.push({ ...all[0]!.reading, tier: 'T5', alternatives: [] });
  }
  if (readings.length < 2) return null;
  const unused: Unused[] = clauses.flatMap((clause, index) =>
    used.has(index)
      ? []
      : [
          {
            span: [clause.start, clause.end] as const,
            why: contradicted.has(index) ? ('conflict' as const) : ('nothing' as const),
          },
        ],
  );
  return { outcome: 'fill', readings, unused };
}

// --- T6: a list is the options ----------------------------------------------------------------

/**
 * T6: a list read as the options of the question that takes them — this one ("How many
 * options?"), or the one ahead of it in the group, when the conversation could ask it now. The
 * count is the list's length, and a length the question does not allow is asked, never cut.
 *
 * A list with an item that answers one of the group's questions is not a list of options: "pill,
 * square" names two shapes, and the ladder does not choose between the two readings.
 */
function aList(
  input: string,
  node: Node,
  context: InterpretContext,
  vocabulary: Vocabulary,
  budget: Budget,
): Interpretation | null {
  const target = takesList(node)
    ? node
    : aheadOf(context.graph, node.id).find(
        (n) => n !== node && takesList(n) && n.slot !== undefined && live(n, context.state),
      );
  if (target?.kind !== 'quantity') return null;
  const list = listOf(input);
  if (!list) return null;
  const questions = aheadOf(context.graph, node.id).filter(readable);
  const answers = (item: string) =>
    item.length <= MAX_INPUT &&
    questions.some((question) => {
      const read = readNode(item, question, vocabulary, budget);
      return (
        read.outcome === 'apply' &&
        read.reading.confidence >= THRESHOLD &&
        (question === node || read.reading.tier !== 'T3') &&
        // A number inside an item ("Group 2", 星期二) is part of its words; only an item that is
        // a number is a count.
        (read.reading.tier !== 'T4' || read.reading.confidence === WHOLE_NUMBER)
      );
    });
  if (list.labels.some(answers)) return null;
  if (list.labels.length < target.min || list.labels.length > target.max) {
    return target === node ? ask('out-of-range', []) : null;
  }
  return {
    outcome: 'apply',
    reading: {
      nodeId: target.id,
      optionId: null,
      value: list.labels,
      confidence: LIST_CONFIDENCE,
      tier: 'T6',
      evidenceSpan: list.span,
      alternatives: [],
    },
  };
}

// --- T7: another question of the group --------------------------------------------------------

interface Candidate {
  readonly node: Node;
  readonly optionId: string | null;
  readonly value: number | null;
  /** Evidence plus the path prior. */
  readonly total: number;
  readonly span: readonly [number, number];
  /** Two of its options fit equally well: it can be offered, never guessed. */
  readonly split: boolean;
}

/**
 * T7 (`INTENT-LADDER.md`): nothing fits the question asked, so every question of the group from
 * here on that the conversation could ask now, and could answer ahead of its turn (it settles a
 * slot), is scored: the best T1, T2 or T3 score of its options — or T4's, for a number — plus a
 * path prior. Clearly ahead of the rest, it is guessed ("Did you mean …?"); otherwise the best
 * three are offered beside the menu. A sentence with a negator in it is not guessed about at all:
 * what it negates is a question for the node asked.
 */
function elsewhere(
  input: string,
  node: Node,
  context: InterpretContext,
  vocabulary: Vocabulary,
  budget: Budget,
): Interpretation {
  const words = vocabulary.nodes.get(node.id);
  const menu = words ? ranked(node.id, words, new Map()).slice(0, 6) : [];
  const typed = inputOf(input, vocabulary.lexicon);
  if (typed.tokens.length === 0 || typed.negators.length > 0) return ask('nothing', menu);

  const next = new Set(nextOf(node));
  const candidates: Candidate[] = [];
  for (const other of aheadOf(context.graph, node.id)) {
    if (other === node || !readable(other) || other.slot === undefined) continue;
    if (!live(other, context.state)) continue;
    const prior = next.has(other.id) ? PRIOR_NEXT : PRIOR_GROUP;
    if (other.kind === 'quantity') {
      const amount = readQuantity(input, vocabulary.lexicon);
      if ('refused' in amount || amount.value < other.min || amount.value > other.max) continue;
      candidates.push({
        node: other,
        optionId: null,
        value: amount.value,
        total: (amount.whole ? WHOLE_NUMBER : NUMBER_IN_PHRASE) + prior,
        span: [amount.start, amount.end],
        split: false,
      });
      continue;
    }
    const otherWords = vocabulary.nodes.get(other.id);
    if (!otherWords) continue;
    const scores = t2(typed, otherWords, vocabulary.weights);
    const matched = [
      ...aliasMatches(typed, otherWords, budget, false),
      ...aliasMatches(typed, otherWords, budget, true),
    ];
    const best = otherWords.options
      .map((option) => {
        const t2Score = scores.get(option.optionId);
        const hits = matched.filter((m) => m.optionId === option.optionId);
        const top = Math.max(t2Score?.score ?? 0, ...hits.map((m) => m.score));
        const span = hits.find((m) => m.score === top)?.span ?? t2Score?.span ?? null;
        return { optionId: option.optionId, score: top, span };
      })
      .filter((o) => o.score > 0)
      .sort((a, b) => b.score - a.score);
    const [first, second] = best;
    if (!first) continue;
    candidates.push({
      node: other,
      optionId: first.optionId,
      value: null,
      total: first.score + prior,
      span: first.span ?? [0, input.length],
      split: second !== undefined && second.score === first.score,
    });
  }
  // Best first; the graph's order between equals, so the ranking is the same on every machine.
  const order = context.graph.nodes;
  candidates.sort((a, b) => b.total - a.total || order.indexOf(a.node) - order.indexOf(b.node));

  const confidence = (c: Candidate) => Math.min(c.total, 1000);
  const offered: Alternative[] = candidates
    .slice(0, 3)
    .map((c) => ({ nodeId: c.node.id, optionId: c.optionId, confidence: confidence(c) }));
  const [top, runnerUp] = candidates;
  if (
    top &&
    !top.split &&
    top.total >= GUESS &&
    (runnerUp?.total ?? 0) <= top.total - GUESS_MARGIN
  ) {
    return {
      outcome: 'guess',
      reading: {
        nodeId: top.node.id,
        optionId: top.optionId,
        value: top.value,
        confidence: confidence(top),
        tier: 'T7',
        evidenceSpan: top.span,
        alternatives: offered.slice(1),
      },
    };
  }
  return ask('nothing', menu, offered);
}
